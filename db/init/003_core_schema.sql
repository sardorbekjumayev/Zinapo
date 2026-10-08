-- ===========================================================================
-- Zinapo — core data model
-- ===========================================================================
--
-- This file is BOTH the specification and the migration, so there is exactly
-- one definition of the core model and it cannot drift from the documentation.
-- `docs/schema.sql` is a symlink to this file: task.md refers to the doc path,
-- the Postgres entrypoint loads the migration path, and both are the same bytes.
--
-- Load order:
--   001_base_schema.sql   person, audit_log                    (sign-in slice)
--   002_auth.sql          person.telegram_user_id, auth_session (sign-in slice)
--   003_core_schema.sql   THIS FILE (= docs/schema.sql) — the core model
--   004_roles_and_ops.sql task.md § 5 — staff RBAC, educator profile,
--                         invites, cases, practice, olympiad ops, notifications
--   005_reference_data.sql regions and the starter taxonomy
--
-- Naming rules (kept by every later migration):
--   * singular table names            `child`, not `children`
--   * foreign keys end in `_id`       `child_id`
--   * every instant is `timestamptz`  never `timestamp`
--   * enums for closed sets, `text` + CHECK only for sets we expect to grow
--
-- ---------------------------------------------------------------------------
-- INVARIANTS
-- ---------------------------------------------------------------------------
-- These are the rules the product cannot work without. Each one is enforced
-- here — by a constraint, a partial index or a trigger — not by application
-- code alone. Where enforcement has to live in the query layer the invariant
-- says so explicitly and names the test that guards it.
--
-- INV-01  Roles are relationships, not person types. There is ONE `person`
--         table and it has no `type` / `role` / `is_parent` column. A tutor who
--         is also a parent is one person with two relationships. Enforced by
--         absence: adding such a column breaks `test/invariants.e2e-spec.ts`.
--
-- INV-02  A child is not a user. `child` has no phone, no password, no
--         telegram id and is never referenced by `auth_session`. Children never
--         authenticate and own nothing.
--
-- INV-03  Exactly one live owner per child.
--         `guardianship_one_owner` — partial unique index.
--
-- INV-04  A child always has an owner. Ownership transfer must revoke and
--         insert inside one transaction; the deferred constraint trigger
--         `child_owner_present` fires at COMMIT.
--
-- INV-05  Educator access always expires. `educator_link.valid_until` is
--         NOT NULL and strictly after `valid_from`.
--
-- INV-06  PINFL never leaves the service layer. `child` stores only a keyed
--         hash (`pinfl_hash`, for lookup) and an app-encrypted blob
--         (`pinfl_enc`, separate key). No view, no API and no log ever exposes
--         either, not partially, not to the owner, not to staff.
--
-- INV-07  Responses are append-only. `response_append_only` raises on UPDATE
--         and DELETE. Corrections are new rows; `revision_count` records that
--         the child changed their mind inside the session.
--
-- INV-08  Anchor items never appear in a practice form. Enforced twice: the
--         candidate-selection SQL excludes them (`practice.repository.ts`) and
--         `form_item_no_anchor_in_practice` raises if one slips through.
--
-- INV-09  A frozen item version is immutable. `item_version_frozen_guard` and
--         `item_option_frozen_guard` reject every write once `frozen_at` is
--         set. An edit means a new `item_version`.
--
-- INV-10  Every distractor carries a misconception code and a rationale.
--         `item_option_distractor_explained` — CHECK.
--
-- INV-11  Percentiles are ranges and only for grades 3–4. Grades 0–2 get
--         criterion-referenced skill states and no ranking.
--         `percentile_band_grade_3_4` / `skill_state_grade_0_2` — CHECKs.
--
-- INV-12  Derived values are stored per calibration run and never overwritten.
--         `calibration_run_id` is part of the primary key of every derived
--         table, and a `<table>_append_only` trigger rejects UPDATE and DELETE.
--
-- INV-13  At most one current calibration run per season and grade.
--         `calibration_run_one_current` — partial unique index.
--
-- INV-14  Wave windows for the same season and grade never overlap, and a wave
--         always points at a frozen monitoring form.
--         `wave_no_overlap` — EXCLUDE constraint; `wave_form_frozen` — trigger.
--
-- INV-15  Group membership grants nothing. `v_educator_visible_child` is
--         derived from `educator_link` alone and must never join
--         `group_member`. Every educator read of a child's data goes through
--         that view.
--
-- INV-16  Deletion is anonymisation. Identifiers are stripped, responses are
--         kept. `response` → `session` → `child` are ON DELETE RESTRICT, so a
--         physical delete is impossible while any response exists;
--         `anonymisation_request` is the only path.
-- ===========================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS btree_gist;   -- needed by wave_no_overlap


-- ---------------------------------------------------------------------------
-- 0. Shared helpers
-- ---------------------------------------------------------------------------

-- Generic "this row cannot be written" guard. The message names the invariant
-- so a failing insert in a log is self-explanatory.
CREATE FUNCTION zn_forbid_write() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% on % is forbidden (%)', TG_OP, TG_TABLE_NAME, TG_ARGV[0]
    USING ERRCODE = 'restrict_violation';
END;
$$;

CREATE FUNCTION zn_touch_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------------
-- 1. Geography and schools
-- ---------------------------------------------------------------------------
-- `region` is the cohort unit: a percentile band is always "within region ×
-- grade × season". Codes follow the official SOATO top level.

CREATE TABLE region (
    id       smallint PRIMARY KEY,
    code     text NOT NULL UNIQUE,
    name_uz  text NOT NULL,
    name_ru  text NOT NULL
);

CREATE TYPE school_kind AS ENUM ('general', 'presidential', 'specialised', 'private', 'other');

CREATE TABLE school (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    region_id  smallint NOT NULL REFERENCES region(id),
    kind       school_kind NOT NULL DEFAULT 'general',
    name       text NOT NULL,
    district   text,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX school_region ON school (region_id);


-- ---------------------------------------------------------------------------
-- 2. Child, enrolment, guardianship, consent
-- ---------------------------------------------------------------------------

-- INV-02: no phone, no credentials, no telegram id. A child is a subject.
-- INV-06: the PINFL is present only as a keyed hash and an encrypted blob.
--         `pinfl_hash` = HMAC-SHA256(pinfl, PINFL_HASH_SALT)  — lookup key
--         `pinfl_enc`  = AES-256-GCM(pinfl, PINFL_ENC_KEY)    — separate key,
--                        used only by the outcomes matcher, inside the service
CREATE TABLE child (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    pinfl_hash      bytea NOT NULL UNIQUE,
    pinfl_enc       bytea NOT NULL,
    family_name     text NOT NULL,
    given_name      text NOT NULL,
    patronymic      text,
    dob             date NOT NULL,
    created_by      uuid NOT NULL REFERENCES person(id),
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now(),
    -- INV-16: set by the anonymisation job. Identifiers above are blanked,
    -- responses are untouched.
    anonymised_at   timestamptz,
    CONSTRAINT child_pinfl_hash_len CHECK (octet_length(pinfl_hash) = 32),
    CONSTRAINT child_dob_plausible  CHECK (dob > date '2010-01-01' AND dob < now())
);
COMMENT ON COLUMN child.pinfl_hash IS
  'INV-06: HMAC of the PINFL. Never returned by any API. Lookup only.';
COMMENT ON COLUMN child.pinfl_enc IS
  'INV-06: app-encrypted PINFL, separate key. Read only by outcomes matching.';

CREATE TRIGGER child_touch BEFORE UPDATE ON child
  FOR EACH ROW EXECUTE FUNCTION zn_touch_updated_at();

-- Enrolment history. `school_region_id` is the SCHOOL's region, never the home
-- address — the cohort is built from where the child competes for a seat.
CREATE TABLE enrolment (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id         uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    school_year      smallint NOT NULL,          -- 2026 means 2026/27
    grade            smallint NOT NULL,
    school_id        uuid REFERENCES school(id),
    school_region_id smallint NOT NULL REFERENCES region(id),
    started_at       timestamptz NOT NULL DEFAULT now(),
    ended_at         timestamptz,
    CONSTRAINT enrolment_grade_range CHECK (grade BETWEEN 0 AND 4),
    CONSTRAINT enrolment_year_range  CHECK (school_year BETWEEN 2025 AND 2100)
);
CREATE INDEX enrolment_child ON enrolment (child_id, school_year DESC);
-- One live enrolment per child per school year.
CREATE UNIQUE INDEX enrolment_current ON enrolment (child_id, school_year)
  WHERE ended_at IS NULL;

CREATE TYPE guardian_role AS ENUM ('owner', 'co_guardian');

CREATE TABLE guardianship (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id   uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    person_id  uuid NOT NULL REFERENCES person(id),
    role       guardian_role NOT NULL,
    granted_by uuid REFERENCES person(id),
    granted_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);
-- INV-03: exactly one live owner.
CREATE UNIQUE INDEX guardianship_one_owner ON guardianship (child_id)
  WHERE role = 'owner' AND revoked_at IS NULL;
-- A person holds at most one live relationship to a given child.
CREATE UNIQUE INDEX guardianship_one_live ON guardianship (child_id, person_id)
  WHERE revoked_at IS NULL;
CREATE INDEX guardianship_person ON guardianship (person_id) WHERE revoked_at IS NULL;

-- INV-04: a child always has an owner. DEFERRABLE so that an ownership
-- transfer can revoke the old owner and insert the new one in any order inside
-- one transaction; the check runs at COMMIT.
CREATE FUNCTION child_owner_present() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  -- Attached to two tables, which name the child differently.
  IF TG_TABLE_NAME = 'child' THEN
    target := NEW.id;
  ELSE
    target := COALESCE(NEW.child_id, OLD.child_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM guardianship
     WHERE child_id = target AND role = 'owner' AND revoked_at IS NULL
  ) THEN
    RAISE EXCEPTION 'child % would be left without an owner (INV-04)', target
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NULL;
END;
$$;
CREATE CONSTRAINT TRIGGER child_owner_present
  AFTER INSERT OR UPDATE OR DELETE ON guardianship
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION child_owner_present();

-- The same check on `child` itself. Without it a child could be inserted with
-- no guardianship row at all: the trigger above only fires when a guardianship
-- changes, so nothing would ever look at an ownerless child.
CREATE CONSTRAINT TRIGGER child_owner_present_on_insert
  AFTER INSERT ON child
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION child_owner_present();

-- Three separate, independently revocable consents. Only the owner gives them.
CREATE TYPE consent_type AS ENUM ('data_processing', 'third_party_transfer', 'marketing');

CREATE TABLE consent (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id         uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    person_id        uuid NOT NULL REFERENCES person(id),   -- the owner at the time
    type             consent_type NOT NULL,
    document_version text NOT NULL,
    given_at         timestamptz NOT NULL DEFAULT now(),
    revoked_at       timestamptz
);
CREATE UNIQUE INDEX consent_one_live ON consent (child_id, type) WHERE revoked_at IS NULL;
CREATE INDEX consent_child ON consent (child_id);

CREATE TABLE anonymisation_request (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id     uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    requested_by uuid NOT NULL REFERENCES person(id),
    reason       text,
    requested_at timestamptz NOT NULL DEFAULT now(),
    executed_at  timestamptz,
    executed_by  uuid REFERENCES person(id)
);
CREATE UNIQUE INDEX anonymisation_one_open ON anonymisation_request (child_id)
  WHERE executed_at IS NULL;


-- ---------------------------------------------------------------------------
-- 3. Educator access
-- ---------------------------------------------------------------------------
-- `educator_profile` (the approval gate) lives in 004 because it is a task.md
-- § 5 addition. `educator_link` is core: it is the ONLY thing that authorises
-- an educator to read a child's data.

CREATE TYPE educator_link_status AS ENUM (
    'requested',   -- educator asked, owner has not answered
    'active',      -- owner approved
    'declined',    -- owner said no — blocks this pair for the season
    'revoked',     -- owner withdrew
    'suspended',   -- trust & safety froze it pending owner confirmation
    'expired'      -- valid_until passed; set by a job for reporting only
);

CREATE TABLE educator_link (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    educator_person_id  uuid NOT NULL REFERENCES person(id),
    child_id            uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    status              educator_link_status NOT NULL DEFAULT 'requested',
    -- INV-05: access always expires.
    valid_from          timestamptz NOT NULL DEFAULT now(),
    valid_until         timestamptz NOT NULL,
    requested_at        timestamptz NOT NULL DEFAULT now(),
    decided_by          uuid REFERENCES person(id),
    decided_at          timestamptz,
    revoked_at          timestamptz,
    suspended_at        timestamptz,
    suspended_reason    text,
    -- Set automatically when the educator is also a live guardian of the child.
    -- The only case where an educator may see a percentile (task.md § 3).
    is_own_child        boolean NOT NULL DEFAULT false,
    season_id           uuid,         -- FK added in § 6, after `season` exists
    CONSTRAINT educator_link_window CHECK (valid_until > valid_from)
);
COMMENT ON COLUMN educator_link.valid_until IS 'INV-05: NOT NULL, always expires.';
COMMENT ON COLUMN educator_link.is_own_child IS
  'task.md § 3: the educator''s own child — the one case where a percentile is visible.';

-- One live request per (educator, child) pair. A declined or revoked row stays
-- for the season so the block is auditable.
CREATE UNIQUE INDEX educator_link_one_live ON educator_link (educator_person_id, child_id)
  WHERE status IN ('requested', 'active', 'suspended');
CREATE INDEX educator_link_child ON educator_link (child_id);
CREATE INDEX educator_link_educator ON educator_link (educator_person_id, status);

-- INV-15: the authorisation view. Derived from `educator_link` ONLY — joining
-- `group_member` here would make group membership grant access. 004 replaces
-- this definition to also require `educator_profile.status = 'approved'`.
CREATE VIEW v_educator_visible_child AS
SELECT el.educator_person_id,
       el.child_id,
       el.id           AS educator_link_id,
       el.valid_until,
       el.is_own_child
  FROM educator_link el
 WHERE el.status = 'active'
   AND el.revoked_at IS NULL
   AND el.suspended_at IS NULL
   AND el.valid_from <= now()
   AND el.valid_until > now();
COMMENT ON VIEW v_educator_visible_child IS
  'INV-15: the single gate for every educator read. Never join group_member.';

-- Keeps `is_own_child` true whenever the educator is a live guardian.
CREATE FUNCTION educator_link_mark_own_child() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.is_own_child := EXISTS (
    SELECT 1 FROM guardianship g
     WHERE g.child_id = NEW.child_id
       AND g.person_id = NEW.educator_person_id
       AND g.revoked_at IS NULL
  );
  RETURN NEW;
END;
$$;
CREATE TRIGGER educator_link_own_child
  BEFORE INSERT OR UPDATE OF child_id, educator_person_id ON educator_link
  FOR EACH ROW EXECUTE FUNCTION educator_link_mark_own_child();

-- Bulk phone invites. The SMS carries `educator_profile.public_code`, so a
-- parent who registers from the invite gets the access toggle pre-filled.
CREATE TABLE educator_invite (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    educator_person_id uuid NOT NULL REFERENCES person(id),
    phone_e164         text NOT NULL,
    code               text NOT NULL UNIQUE,
    created_at         timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    last_reminded_at   timestamptz,
    accepted_by        uuid REFERENCES person(id),
    accepted_at        timestamptz,
    cancelled_at       timestamptz,
    CONSTRAINT educator_invite_phone CHECK (phone_e164 ~ '^\+998[0-9]{9}$')
);
CREATE UNIQUE INDEX educator_invite_one_live ON educator_invite (educator_person_id, phone_e164)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;

-- Every PINFL + surname match-check, successful or not. Rate limits are
-- enforced in Redis; this table is the audit trail and the fraud signal
-- ("PINFL check bursts", task.md § 8.5).
-- INV-06: the probe is stored hashed, exactly like child.pinfl_hash.
CREATE TABLE pinfl_check_log (
    id                 bigserial PRIMARY KEY,
    educator_person_id uuid NOT NULL REFERENCES person(id),
    pinfl_hash         bytea NOT NULL,
    family_name_probe  text NOT NULL,
    matched            boolean NOT NULL,
    ip                 inet,
    created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX pinfl_check_log_educator ON pinfl_check_log (educator_person_id, created_at DESC);

-- Groups organise linked children for the educator's own convenience.
-- INV-15: membership grants nothing.
CREATE TABLE teaching_group (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    educator_person_id uuid NOT NULL REFERENCES person(id),
    name               text NOT NULL,
    grade              smallint,
    note               text,
    created_at         timestamptz NOT NULL DEFAULT now(),
    archived_at        timestamptz,
    CONSTRAINT teaching_group_grade CHECK (grade IS NULL OR grade BETWEEN 0 AND 4)
);
CREATE INDEX teaching_group_educator ON teaching_group (educator_person_id) WHERE archived_at IS NULL;

CREATE TABLE group_member (
    group_id  uuid NOT NULL REFERENCES teaching_group(id) ON DELETE CASCADE,
    child_id  uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    added_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (group_id, child_id)
);
COMMENT ON TABLE group_member IS
  'INV-15: organisational only. Never referenced by any authorisation query.';


-- ---------------------------------------------------------------------------
-- 4. Taxonomy
-- ---------------------------------------------------------------------------
-- Three clusters per task.md § 12 M3. Skills are the grade 0–2 unit (they get
-- criterion-referenced states, never a rank). Misconceptions are the currency
-- of the educator view and the practice builder.

CREATE TYPE topic_cluster AS ENUM ('numeracy', 'reasoning', 'language');

CREATE TABLE topic (
    code      text PRIMARY KEY,
    cluster   topic_cluster NOT NULL,
    grade_min smallint NOT NULL,
    grade_max smallint NOT NULL,
    name_uz   text NOT NULL,
    name_ru   text NOT NULL,
    sort      smallint NOT NULL DEFAULT 0,
    CONSTRAINT topic_grades CHECK (grade_min BETWEEN 0 AND 4
                               AND grade_max BETWEEN grade_min AND 4)
);

CREATE TABLE skill (
    code       text PRIMARY KEY,
    topic_code text NOT NULL REFERENCES topic(code),
    grade      smallint NOT NULL,
    name_uz    text NOT NULL,
    name_ru    text NOT NULL,
    -- task.md § 1.9: skills are the grade 0–2 instrument.
    CONSTRAINT skill_grade_0_2 CHECK (grade BETWEEN 0 AND 2)
);
CREATE INDEX skill_topic ON skill (topic_code, grade);

CREATE TABLE misconception (
    code        text PRIMARY KEY,
    topic_code  text NOT NULL REFERENCES topic(code),
    name_uz     text NOT NULL,
    name_ru     text NOT NULL,
    -- What the child is actually doing wrong, in the parent's language.
    explain_uz  text NOT NULL,
    explain_ru  text NOT NULL,
    retired_at  timestamptz
);
CREATE INDEX misconception_topic ON misconception (topic_code);


-- ---------------------------------------------------------------------------
-- 5. Item bank
-- ---------------------------------------------------------------------------

CREATE TYPE item_status AS ENUM ('draft', 'in_review', 'rejected', 'approved', 'retired');
CREATE TYPE stem_format AS ENUM ('text', 'image', 'image_audio');
CREATE TYPE anchor_kind AS ENUM ('horizontal', 'vertical');

CREATE TABLE item (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    author_person_id uuid NOT NULL REFERENCES person(id),
    topic_code       text NOT NULL REFERENCES topic(code),
    skill_code       text REFERENCES skill(code),
    grade            smallint NOT NULL,
    construct        text NOT NULL,          -- what the item measures, one line
    status           item_status NOT NULL DEFAULT 'draft',
    -- INV-08: anchors carry the scale between waves and grades. They must never
    -- reach a practice form.
    is_anchor        boolean NOT NULL DEFAULT false,
    anchor_kind      anchor_kind,
    anchor_link_grade smallint,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    -- Author payment is per ACCEPTED item (task.md § 2.1).
    accepted_at      timestamptz,
    retired_at       timestamptz,
    CONSTRAINT item_grade_range CHECK (grade BETWEEN 0 AND 4),
    CONSTRAINT item_anchor_shape CHECK (
      (NOT is_anchor AND anchor_kind IS NULL AND anchor_link_grade IS NULL)
      OR (is_anchor AND anchor_kind = 'horizontal' AND anchor_link_grade IS NULL)
      OR (is_anchor AND anchor_kind = 'vertical'   AND anchor_link_grade BETWEEN 0 AND 4)
    ),
    -- A grade 0–2 item measures a skill; a grade 3–4 item does not have to.
    CONSTRAINT item_skill_for_low_grades CHECK (grade > 2 OR skill_code IS NOT NULL)
);
CREATE INDEX item_author ON item (author_person_id, status);
CREATE INDEX item_pool   ON item (grade, topic_code, status) WHERE retired_at IS NULL;
CREATE INDEX item_anchor ON item (grade) WHERE is_anchor AND retired_at IS NULL;

CREATE TRIGGER item_touch BEFORE UPDATE ON item
  FOR EACH ROW EXECUTE FUNCTION zn_touch_updated_at();

-- INV-09: a version is a snapshot. Freezing is one-way; an edit is a new row.
CREATE TABLE item_version (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id       uuid NOT NULL REFERENCES item(id) ON DELETE RESTRICT,
    version       smallint NOT NULL,
    stem_format   stem_format NOT NULL DEFAULT 'text',
    stem_uz       text NOT NULL,
    stem_ru       text NOT NULL,
    image_ref     text,                    -- object-storage key, in-country
    audio_ref_uz  text,
    audio_ref_ru  text,
    expected_p    numeric(4,3),            -- author's guess, compared after calibration
    created_by    uuid NOT NULL REFERENCES person(id),
    created_at    timestamptz NOT NULL DEFAULT now(),
    frozen_at     timestamptz,
    UNIQUE (item_id, version),
    CONSTRAINT item_version_expected_p CHECK (expected_p IS NULL OR expected_p BETWEEN 0 AND 1),
    CONSTRAINT item_version_media CHECK (
      (stem_format = 'text')
      OR (stem_format = 'image'       AND image_ref IS NOT NULL)
      -- task.md § 8.3: grades 0–1 need visual + read-aloud audio in both locales.
      OR (stem_format = 'image_audio' AND image_ref IS NOT NULL
          AND audio_ref_uz IS NOT NULL AND audio_ref_ru IS NOT NULL)
    )
);
CREATE INDEX item_version_item ON item_version (item_id, version DESC);

CREATE FUNCTION item_version_frozen_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.frozen_at IS NOT NULL THEN
    RAISE EXCEPTION 'item_version % is frozen; create a new version (INV-09)', OLD.id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER item_version_frozen BEFORE UPDATE OR DELETE ON item_version
  FOR EACH ROW EXECUTE FUNCTION item_version_frozen_guard();

-- INV-10: a distractor without a misconception code and a rationale is not an
-- item, it is noise. The key needs neither.
CREATE TABLE item_option (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_version_id    uuid NOT NULL REFERENCES item_version(id) ON DELETE RESTRICT,
    position           smallint NOT NULL,
    label_uz           text NOT NULL,
    label_ru           text NOT NULL,
    image_ref          text,
    is_key             boolean NOT NULL DEFAULT false,
    misconception_code text REFERENCES misconception(code),
    rationale          text,
    UNIQUE (item_version_id, position),
    CONSTRAINT item_option_distractor_explained CHECK (
      is_key OR (misconception_code IS NOT NULL AND length(trim(rationale)) > 0)
    ),
    CONSTRAINT item_option_key_unexplained CHECK (
      NOT is_key OR misconception_code IS NULL
    )
);
-- Exactly one key per version.
CREATE UNIQUE INDEX item_option_one_key ON item_option (item_version_id) WHERE is_key;
CREATE INDEX item_option_misconception ON item_option (misconception_code)
  WHERE misconception_code IS NOT NULL;

CREATE FUNCTION item_option_frozen_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.item_version_id, OLD.item_version_id);
BEGIN
  IF EXISTS (SELECT 1 FROM item_version WHERE id = target AND frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'item_version % is frozen; its options cannot change (INV-09)', target
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER item_option_frozen BEFORE INSERT OR UPDATE OR DELETE ON item_option
  FOR EACH ROW EXECUTE FUNCTION item_option_frozen_guard();

-- Two-hand review (task.md § 8.5). The reviewer solves blind, then the key is
-- revealed. Disagreement auto-rejects; nobody reviews their own item.
CREATE TYPE review_verdict AS ENUM ('accept', 'revise', 'reject', 'auto_reject');

CREATE TABLE item_review (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_version_id     uuid NOT NULL REFERENCES item_version(id) ON DELETE RESTRICT,
    reviewer_person_id  uuid NOT NULL REFERENCES person(id),
    assigned_at         timestamptz NOT NULL DEFAULT now(),
    -- Phase 1: the blind solve. Stored before the key is shown.
    blind_option_id     uuid REFERENCES item_option(id),
    blind_submitted_at  timestamptz,
    blind_was_correct   boolean,
    -- Phase 2: the critique.
    verdict             review_verdict,
    note                text,
    decided_at          timestamptz,
    CONSTRAINT item_review_note_required CHECK (
      verdict IS NULL OR verdict = 'accept' OR verdict = 'auto_reject'
      OR length(trim(note)) > 0
    ),
    CONSTRAINT item_review_order CHECK (decided_at IS NULL OR blind_submitted_at IS NOT NULL)
);
CREATE UNIQUE INDEX item_review_one_per_reviewer
  ON item_review (item_version_id, reviewer_person_id);
CREATE INDEX item_review_queue ON item_review (reviewer_person_id)
  WHERE decided_at IS NULL;

-- No self-review (task.md § 8.5).
CREATE FUNCTION item_review_not_own() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM item_version iv JOIN item i ON i.id = iv.item_id
     WHERE iv.id = NEW.item_version_id
       AND (i.author_person_id = NEW.reviewer_person_id
            OR iv.created_by   = NEW.reviewer_person_id)
  ) THEN
    RAISE EXCEPTION 'a reviewer cannot review their own item'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER item_review_no_self BEFORE INSERT ON item_review
  FOR EACH ROW EXECUTE FUNCTION item_review_not_own();


-- ---------------------------------------------------------------------------
-- 6. Seasons, waves and forms
-- ---------------------------------------------------------------------------

CREATE TABLE season (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    code      text NOT NULL UNIQUE,     -- '2026/27'
    name_uz   text NOT NULL,
    name_ru   text NOT NULL,
    starts_on date NOT NULL,
    ends_on   date NOT NULL,
    is_current boolean NOT NULL DEFAULT false,
    CONSTRAINT season_window CHECK (ends_on > starts_on)
);
CREATE UNIQUE INDEX season_one_current ON season ((true)) WHERE is_current;

-- educator_link.season_id can only be wired now that `season` exists.
ALTER TABLE educator_link
  ADD CONSTRAINT educator_link_season_fk FOREIGN KEY (season_id) REFERENCES season(id);

CREATE TYPE form_mode AS ENUM ('monitoring', 'practice', 'olympiad');

CREATE TABLE form (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    mode        form_mode NOT NULL,
    season_id   uuid REFERENCES season(id),
    grade       smallint NOT NULL,
    label       text NOT NULL,
    time_limit_sec int,
    created_by  uuid NOT NULL REFERENCES person(id),
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- Freezing a form is irreversible (task.md § 8.5).
    frozen_at   timestamptz,
    CONSTRAINT form_grade_range CHECK (grade BETWEEN 0 AND 4)
);
CREATE INDEX form_pool ON form (mode, grade, season_id);

CREATE TYPE slot_role AS ENUM ('scored', 'anchor', 'pretest');

CREATE TABLE form_item (
    form_id         uuid NOT NULL REFERENCES form(id) ON DELETE CASCADE,
    position        smallint NOT NULL,
    item_version_id uuid NOT NULL REFERENCES item_version(id) ON DELETE RESTRICT,
    slot_role       slot_role NOT NULL DEFAULT 'scored',
    -- Pretest items ride along unscored so they can be calibrated.
    is_scored       boolean NOT NULL DEFAULT true,
    -- For practice: which misconception or topic this slot came from.
    source_code     text,
    PRIMARY KEY (form_id, position),
    UNIQUE (form_id, item_version_id),
    CONSTRAINT form_item_pretest_unscored CHECK (slot_role <> 'pretest' OR NOT is_scored),
    CONSTRAINT form_item_anchor_scored    CHECK (slot_role <> 'anchor'  OR is_scored)
);
CREATE INDEX form_item_version ON form_item (item_version_id);

-- INV-08, second line of defence. The primary one is the candidate-selection
-- SQL in the practice repository; this trigger makes a mistake there loud.
CREATE FUNCTION form_item_no_anchor_in_practice() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  m form_mode;
  anchored boolean;
BEGIN
  SELECT mode INTO m FROM form WHERE id = NEW.form_id;
  SELECT i.is_anchor INTO anchored
    FROM item_version iv JOIN item i ON i.id = iv.item_id
   WHERE iv.id = NEW.item_version_id;

  IF m = 'practice' AND anchored THEN
    RAISE EXCEPTION 'anchor item cannot enter a practice form (INV-08)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF NEW.slot_role = 'anchor' AND NOT anchored THEN
    RAISE EXCEPTION 'anchor slot filled with a non-anchor item'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER form_item_anchor_rules BEFORE INSERT OR UPDATE ON form_item
  FOR EACH ROW EXECUTE FUNCTION form_item_no_anchor_in_practice();

-- A frozen form cannot gain or lose items.
CREATE FUNCTION form_frozen_guard() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid := COALESCE(NEW.form_id, OLD.form_id);
BEGIN
  IF EXISTS (SELECT 1 FROM form WHERE id = target AND frozen_at IS NOT NULL) THEN
    RAISE EXCEPTION 'form % is frozen', target USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;
CREATE TRIGGER form_item_frozen BEFORE INSERT OR UPDATE OR DELETE ON form_item
  FOR EACH ROW EXECUTE FUNCTION form_frozen_guard();

-- 8 waves per season per grade, each with its own window (task.md § 8.5).
CREATE TABLE wave (
    id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id uuid NOT NULL REFERENCES season(id),
    grade     smallint NOT NULL,
    ordinal   smallint NOT NULL,
    form_id   uuid REFERENCES form(id),
    opens_at  timestamptz NOT NULL,
    closes_at timestamptz NOT NULL,
    -- Set by the wave-close job; the calibration run follows.
    closed_at timestamptz,
    UNIQUE (season_id, grade, ordinal),
    CONSTRAINT wave_grade_range CHECK (grade BETWEEN 0 AND 4),
    CONSTRAINT wave_ordinal_range CHECK (ordinal BETWEEN 1 AND 8),
    CONSTRAINT wave_window CHECK (closes_at > opens_at),
    -- INV-14: no two windows for the same season and grade overlap.
    CONSTRAINT wave_no_overlap EXCLUDE USING gist (
      season_id WITH =, grade WITH =, tstzrange(opens_at, closes_at) WITH &&
    )
);
CREATE INDEX wave_open ON wave (grade, opens_at, closes_at);

-- INV-14: a wave can only go live behind a frozen monitoring form.
CREATE FUNCTION wave_form_frozen() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  f record;
BEGIN
  IF NEW.form_id IS NULL THEN RETURN NEW; END IF;
  SELECT mode, grade, frozen_at INTO f FROM form WHERE id = NEW.form_id;
  IF f.mode <> 'monitoring' THEN
    RAISE EXCEPTION 'a wave needs a monitoring form, got %', f.mode
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF f.grade <> NEW.grade THEN
    RAISE EXCEPTION 'wave grade % does not match form grade %', NEW.grade, f.grade
      USING ERRCODE = 'restrict_violation';
  END IF;
  IF f.frozen_at IS NULL THEN
    RAISE EXCEPTION 'form % must be frozen before a wave points at it (INV-14)', NEW.form_id
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER wave_needs_frozen_form BEFORE INSERT OR UPDATE OF form_id ON wave
  FOR EACH ROW EXECUTE FUNCTION wave_form_frozen();


-- ---------------------------------------------------------------------------
-- 7. Sessions and responses — the raw layer
-- ---------------------------------------------------------------------------
-- This is the asset. Item-level history: which item, which answer, which date,
-- which wave. A score is never the source of truth.

CREATE TYPE session_mode AS ENUM ('monitoring', 'practice', 'olympiad');
CREATE TYPE session_status AS ENUM ('started', 'submitted', 'expired', 'voided');
CREATE TYPE launch_context AS ENUM ('home', 'educator_office', 'proctored_final');
CREATE TYPE sync_source AS ENUM ('online', 'offline_sync');

CREATE TABLE session (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id           uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    mode               session_mode NOT NULL,
    form_id            uuid NOT NULL REFERENCES form(id),
    wave_id            uuid REFERENCES wave(id),
    -- practice_assignment lives in 004; the FK is added there.
    assignment_id      uuid,
    olympiad_entry_id  uuid,                 -- FK added in § 9
    launched_by        uuid NOT NULL REFERENCES person(id),
    launch_context     launch_context NOT NULL,
    -- Snapshots: the cohort must not move when a child changes school.
    grade_snapshot     smallint NOT NULL,
    region_snapshot    smallint NOT NULL REFERENCES region(id),
    school_snapshot    uuid REFERENCES school(id),
    status             session_status NOT NULL DEFAULT 'started',
    started_at         timestamptz NOT NULL DEFAULT now(),
    submitted_at       timestamptz,
    device             text,
    os                 text,
    client_version     text,
    sync_source        sync_source NOT NULL DEFAULT 'online',
    CONSTRAINT session_grade_range CHECK (grade_snapshot BETWEEN 0 AND 4),
    CONSTRAINT session_wave_for_monitoring CHECK (mode <> 'monitoring' OR wave_id IS NOT NULL),
    CONSTRAINT session_submitted_shape CHECK (
      (status = 'submitted') = (submitted_at IS NOT NULL)
    )
);
CREATE INDEX session_child ON session (child_id, started_at DESC);
CREATE INDEX session_wave  ON session (wave_id) WHERE wave_id IS NOT NULL;
-- One monitoring session per child per wave.
CREATE UNIQUE INDEX session_one_per_wave ON session (child_id, wave_id)
  WHERE mode = 'monitoring' AND status <> 'voided';

-- INV-07: append-only. Idempotent on (session_id, item_version_id) so a
-- retrying offline client can replay its buffer safely.
CREATE TABLE response (
    id                 bigserial PRIMARY KEY,
    session_id         uuid NOT NULL REFERENCES session(id) ON DELETE RESTRICT,
    item_version_id    uuid NOT NULL REFERENCES item_version(id) ON DELETE RESTRICT,
    chosen_option_id   uuid REFERENCES item_option(id),   -- NULL = skipped
    -- Correctness is derived, but stored here because the key can be retired
    -- and a response must stay interpretable forever.
    is_correct         boolean,
    response_ms        int,
    revision_count     smallint NOT NULL DEFAULT 0,
    flagged            boolean NOT NULL DEFAULT false,
    client_recorded_at timestamptz NOT NULL,
    created_at         timestamptz NOT NULL DEFAULT now(),
    UNIQUE (session_id, item_version_id),
    CONSTRAINT response_ms_sane CHECK (response_ms IS NULL OR response_ms BETWEEN 0 AND 3600000)
);
CREATE INDEX response_item ON response (item_version_id);
CREATE INDEX response_session ON response (session_id);

CREATE TRIGGER response_append_only BEFORE UPDATE OR DELETE ON response
  FOR EACH ROW EXECUTE FUNCTION zn_forbid_write('INV-07');


-- ---------------------------------------------------------------------------
-- 8. Measurement — the derived layer
-- ---------------------------------------------------------------------------
-- Written only by background jobs, always keyed by `calibration_run_id`,
-- never overwritten (INV-12). Switching `is_current` changes what every
-- report reads, atomically.

CREATE TYPE calibration_method AS ENUM ('raw_band_v0', 'rasch_anchor_equating_v1');

CREATE TABLE calibration_run (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    method      calibration_method NOT NULL,
    season_id   uuid NOT NULL REFERENCES season(id),
    grade       smallint NOT NULL,
    wave_id     uuid REFERENCES wave(id),
    params      jsonb NOT NULL DEFAULT '{}'::jsonb,
    triggered_by uuid REFERENCES person(id),
    started_at  timestamptz NOT NULL DEFAULT now(),
    finished_at timestamptz,
    is_current  boolean NOT NULL DEFAULT false,
    note        text,
    CONSTRAINT calibration_run_grade CHECK (grade BETWEEN 0 AND 4)
);
-- INV-13: one current run per season and grade.
CREATE UNIQUE INDEX calibration_run_one_current ON calibration_run (season_id, grade)
  WHERE is_current;
CREATE INDEX calibration_run_wave ON calibration_run (wave_id);

CREATE TABLE scale_score (
    calibration_run_id uuid NOT NULL REFERENCES calibration_run(id) ON DELETE RESTRICT,
    session_id         uuid NOT NULL REFERENCES session(id) ON DELETE RESTRICT,
    raw_score          smallint NOT NULL,
    theta              numeric(6,3),
    se                 numeric(6,3),
    PRIMARY KEY (calibration_run_id, session_id)
);
CREATE TRIGGER scale_score_append_only BEFORE UPDATE OR DELETE ON scale_score
  FOR EACH ROW EXECUTE FUNCTION zn_forbid_write('INV-12');

-- INV-11: a band is a RANGE and only exists for grades 3–4. `cohort_n < 30`
-- means no band is shown at all — the row still records why.
CREATE TABLE percentile_band (
    calibration_run_id uuid NOT NULL REFERENCES calibration_run(id) ON DELETE RESTRICT,
    child_id           uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    wave_id            uuid NOT NULL REFERENCES wave(id),
    grade              smallint NOT NULL,
    region_id          smallint NOT NULL REFERENCES region(id),
    pct_low            smallint,
    pct_high           smallint,
    cohort_n           int NOT NULL,
    PRIMARY KEY (calibration_run_id, child_id, wave_id),
    CONSTRAINT percentile_band_grade_3_4 CHECK (grade BETWEEN 3 AND 4),
    CONSTRAINT percentile_band_is_a_range CHECK (
      (pct_low IS NULL AND pct_high IS NULL)
      OR (pct_low BETWEEN 1 AND 100 AND pct_high BETWEEN pct_low AND 100)
    ),
    -- Below the cohort minimum there is no band, only the explanation.
    CONSTRAINT percentile_band_cohort_minimum CHECK (
      cohort_n >= 30 OR (pct_low IS NULL AND pct_high IS NULL)
    )
);
CREATE INDEX percentile_band_child ON percentile_band (child_id, wave_id);
CREATE TRIGGER percentile_band_append_only BEFORE UPDATE OR DELETE ON percentile_band
  FOR EACH ROW EXECUTE FUNCTION zn_forbid_write('INV-12');

-- INV-11: grades 0–2 get states, never a rank and never a forecast.
CREATE TYPE skill_state_value AS ENUM ('not_yet', 'emerging', 'secure');

CREATE TABLE skill_state (
    calibration_run_id uuid NOT NULL REFERENCES calibration_run(id) ON DELETE RESTRICT,
    child_id           uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    wave_id            uuid NOT NULL REFERENCES wave(id),
    skill_code         text NOT NULL REFERENCES skill(code),
    grade              smallint NOT NULL,
    state              skill_state_value NOT NULL,
    correct_count      smallint NOT NULL DEFAULT 0,
    seen_count         smallint NOT NULL DEFAULT 0,
    PRIMARY KEY (calibration_run_id, child_id, wave_id, skill_code),
    CONSTRAINT skill_state_grade_0_2 CHECK (grade BETWEEN 0 AND 2)
);
CREATE INDEX skill_state_child ON skill_state (child_id, wave_id);
CREATE TRIGGER skill_state_append_only BEFORE UPDATE OR DELETE ON skill_state
  FOR EACH ROW EXECUTE FUNCTION zn_forbid_write('INV-12');

-- Item statistics are per run: p, point-biserial, distractor share, DIF uz/ru.
CREATE TABLE item_statistic (
    calibration_run_id uuid NOT NULL REFERENCES calibration_run(id) ON DELETE RESTRICT,
    item_version_id    uuid NOT NULL REFERENCES item_version(id) ON DELETE RESTRICT,
    n                  int NOT NULL,
    p                  numeric(4,3),
    point_biserial     numeric(4,3),
    distractor_share   jsonb NOT NULL DEFAULT '{}'::jsonb,
    dif_uz_ru          numeric(5,3),
    difficulty_b       numeric(6,3),
    PRIMARY KEY (calibration_run_id, item_version_id)
);
CREATE TRIGGER item_statistic_append_only BEFORE UPDATE OR DELETE ON item_statistic
  FOR EACH ROW EXECUTE FUNCTION zn_forbid_write('INV-12');

-- The in-person final corrects monitoring, never the reverse (task.md § 9).
CREATE TABLE inflation_adjustment (
    calibration_run_id uuid NOT NULL REFERENCES calibration_run(id) ON DELETE RESTRICT,
    region_id          smallint NOT NULL REFERENCES region(id),
    grade              smallint NOT NULL,
    delta_theta        numeric(6,3) NOT NULL,
    n_final            int NOT NULL,
    PRIMARY KEY (calibration_run_id, region_id, grade),
    CONSTRAINT inflation_adjustment_grade CHECK (grade BETWEEN 0 AND 4)
);
CREATE TRIGGER inflation_adjustment_append_only BEFORE UPDATE OR DELETE ON inflation_adjustment
  FOR EACH ROW EXECUTE FUNCTION zn_forbid_write('INV-12');


-- ---------------------------------------------------------------------------
-- 9. Olympiad
-- ---------------------------------------------------------------------------

CREATE TYPE olympiad_stage_kind AS ENUM ('autumn_online', 'mini_final', 'spring_online', 'spring_final');

CREATE TABLE olympiad (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    season_id  uuid NOT NULL REFERENCES season(id),
    slug       text NOT NULL UNIQUE,     -- /o/[slug]
    title_uz   text NOT NULL,
    title_ru   text NOT NULL,
    grade_min  smallint NOT NULL,
    grade_max  smallint NOT NULL,
    -- task.md § 8.5: grades 0–2 are a diagnostic marathon with no places.
    is_ranked  boolean NOT NULL DEFAULT true,
    certificate_top_pct smallint NOT NULL DEFAULT 15,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT olympiad_grades CHECK (grade_min BETWEEN 0 AND 4
                                  AND grade_max BETWEEN grade_min AND 4),
    CONSTRAINT olympiad_rank_not_for_young CHECK (NOT is_ranked OR grade_min >= 3)
);

CREATE TABLE olympiad_stage (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    olympiad_id  uuid NOT NULL REFERENCES olympiad(id) ON DELETE CASCADE,
    kind         olympiad_stage_kind NOT NULL,
    form_id      uuid REFERENCES form(id),
    opens_at     timestamptz NOT NULL,
    closes_at    timestamptz NOT NULL,
    registration_closes_at timestamptz,
    UNIQUE (olympiad_id, kind),
    CONSTRAINT olympiad_stage_window CHECK (closes_at > opens_at)
);

CREATE TABLE olympiad_entry (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    olympiad_id   uuid NOT NULL REFERENCES olympiad(id) ON DELETE RESTRICT,
    stage_id      uuid NOT NULL REFERENCES olympiad_stage(id) ON DELETE RESTRICT,
    child_id      uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
    registered_by uuid NOT NULL REFERENCES person(id),
    registered_at timestamptz NOT NULL DEFAULT now(),
    -- Deep-link source attribution: /o/[slug]?src=
    source        text,
    -- "≥ 3 monitoring waves = direct entry to the spring final".
    ticket_from_waves smallint,
    region_id     smallint REFERENCES region(id),
    result_score  smallint,
    result_rank   int,
    certificate_issued_at timestamptz,
    UNIQUE (stage_id, child_id)
);
CREATE INDEX olympiad_entry_child ON olympiad_entry (child_id);
CREATE INDEX olympiad_entry_rank  ON olympiad_entry (stage_id, region_id, result_rank);

ALTER TABLE session
  ADD CONSTRAINT session_olympiad_entry_fk
  FOREIGN KEY (olympiad_entry_id) REFERENCES olympiad_entry(id);

-- task.md § 9: online olympiad data never enters the scale.
CREATE FUNCTION session_olympiad_not_scored() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.mode = 'olympiad' AND NEW.wave_id IS NOT NULL THEN
    RAISE EXCEPTION 'an olympiad session must not be attached to a monitoring wave'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER session_olympiad_scale BEFORE INSERT OR UPDATE ON session
  FOR EACH ROW EXECUTE FUNCTION session_olympiad_not_scored();


-- ---------------------------------------------------------------------------
-- 10. Trust & safety, outcomes
-- ---------------------------------------------------------------------------

CREATE TABLE registration_flag (
    id                bigserial PRIMARY KEY,
    rule_code         text NOT NULL,     -- 'many_owners_one_device', 'surname_mismatch_group', …
    subject_person_id uuid REFERENCES person(id),
    subject_child_id  uuid REFERENCES child(id) ON DELETE RESTRICT,
    severity          smallint NOT NULL DEFAULT 1,
    evidence          jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at        timestamptz NOT NULL DEFAULT now(),
    resolved_at       timestamptz,
    resolved_by       uuid REFERENCES person(id),
    resolution        text,
    CONSTRAINT registration_flag_subject CHECK (
      subject_person_id IS NOT NULL OR subject_child_id IS NOT NULL
    )
);
CREATE INDEX registration_flag_open ON registration_flag (rule_code, created_at DESC)
  WHERE resolved_at IS NULL;

-- Imported in July from the official admission lists. Matching happens inside
-- the service by PINFL hash; INV-06 means the UI never sees a PINFL.
CREATE TABLE admission_outcome (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    child_id    uuid REFERENCES child(id) ON DELETE RESTRICT,
    admit_year  smallint NOT NULL,
    school_id   uuid REFERENCES school(id),
    admitted    boolean NOT NULL,
    -- The raw row minus the PINFL. The PINFL is never persisted here.
    source_row  jsonb NOT NULL DEFAULT '{}'::jsonb,
    imported_at timestamptz NOT NULL DEFAULT now(),
    matched_at  timestamptz,
    UNIQUE (child_id, admit_year)
);


-- ---------------------------------------------------------------------------
-- 11. Audit
-- ---------------------------------------------------------------------------
-- `audit_log` is created by 001. task.md § 1.15: everything that changes
-- access, consent, ownership, items or flags writes a row. Logs carry no PINFL,
-- no codes and no tokens.

COMMENT ON TABLE audit_log IS
  'task.md § 1.15. Never contains a PINFL, an OTP or a token.';

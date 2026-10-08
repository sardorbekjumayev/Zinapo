-- ===========================================================================
-- task.md § 5 — data model additions on top of docs/schema.sql
-- ===========================================================================
-- Staff RBAC, the educator approval gate, guardian invites, the trust & safety
-- case queue, practice assignments, olympiad operations and notifications.
--
-- Loaded after 003 (= docs/schema.sql), so `person`, `child`, `region`,
-- `school`, `form`, `teaching_group`, `misconception`, `olympiad` and
-- `registration_flag` all exist by now.
-- ===========================================================================

-- From sign-in; 002_auth.sql already applied these on a fresh volume. Repeated
-- here with IF NOT EXISTS so the file is safe to run against an older database.
ALTER TABLE person ADD COLUMN IF NOT EXISTS telegram_user_id bigint;
CREATE UNIQUE INDEX IF NOT EXISTS person_telegram_unique ON person (telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;


-- ---------------------------------------------------------------------------
-- Staff RBAC
-- ---------------------------------------------------------------------------
-- INV-01: this does NOT make a person "a staff member". It is one more
-- relationship. Permissions themselves are a constant map in code
-- (`STAFF_PERMISSIONS` in src/authz/staff-permissions.ts); the database stores
-- only who holds which role.

CREATE TYPE staff_role AS ENUM ('item_author','item_reviewer','bank_editor','season_manager',
                                'olympiad_operator','proctor','trust_safety','support',
                                'outcomes_operator','super_admin');

CREATE TABLE staff_role_assignment (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  person_id  uuid NOT NULL REFERENCES person(id),
  role       staff_role NOT NULL,
  granted_by uuid REFERENCES person(id),
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz
);
CREATE UNIQUE INDEX staff_role_live ON staff_role_assignment (person_id, role)
  WHERE revoked_at IS NULL;
CREATE INDEX staff_role_person ON staff_role_assignment (person_id) WHERE revoked_at IS NULL;


-- ---------------------------------------------------------------------------
-- Educator profile — the approval gate
-- ---------------------------------------------------------------------------
-- The first ~100 educators are hand-picked and pre-approved by staff.

CREATE TYPE educator_status AS ENUM ('applied','approved','rejected','suspended');
CREATE TYPE educator_kind   AS ENUM ('tutor','school_teacher','learning_centre');

CREATE TABLE educator_profile (
  person_id   uuid PRIMARY KEY REFERENCES person(id),
  kind        educator_kind NOT NULL,
  status      educator_status NOT NULL DEFAULT 'applied',
  -- Printed on invites and used for bonus attribution, e.g. 'AZR-4821'.
  public_code text UNIQUE NOT NULL,
  region_id   smallint REFERENCES region(id),
  school_id   uuid REFERENCES school(id),
  subjects    text[],
  applied_at  timestamptz NOT NULL DEFAULT now(),
  decided_by  uuid REFERENCES person(id),
  decided_at  timestamptz,
  note        text
);
CREATE INDEX educator_profile_status ON educator_profile (status);

-- INV-15 / task.md § 4: now that the approval gate exists, the authorisation
-- view also requires an approved educator. Still derived from `educator_link`
-- alone — `group_member` is never joined here.
CREATE OR REPLACE VIEW v_educator_visible_child AS
SELECT el.educator_person_id,
       el.child_id,
       el.id           AS educator_link_id,
       el.valid_until,
       el.is_own_child
  FROM educator_link el
  JOIN educator_profile ep ON ep.person_id = el.educator_person_id
 WHERE ep.status = 'approved'
   AND el.status = 'active'
   AND el.revoked_at IS NULL
   AND el.suspended_at IS NULL
   AND el.valid_from <= now()
   AND el.valid_until > now();


-- ---------------------------------------------------------------------------
-- Co-guardian invitations and ownership transfer
-- ---------------------------------------------------------------------------
-- An ownership transfer is an invite the co-guardian must accept; INV-03/INV-04
-- mean the swap happens in one transaction.

CREATE TABLE guardian_invite (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  child_id    uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
  invited_by  uuid NOT NULL REFERENCES person(id),
  phone_e164  text NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('co_guardian','ownership_transfer')),
  code        text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  accepted_by uuid REFERENCES person(id),
  accepted_at timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT guardian_invite_phone CHECK (phone_e164 ~ '^\+998[0-9]{9}$')
);
CREATE UNIQUE INDEX guardian_invite_one_live ON guardian_invite (child_id, phone_e164, kind)
  WHERE accepted_at IS NULL AND cancelled_at IS NULL;
CREATE INDEX guardian_invite_child ON guardian_invite (child_id);


-- ---------------------------------------------------------------------------
-- Disputes and manual review — one queue for trust & safety
-- ---------------------------------------------------------------------------

CREATE TYPE case_kind   AS ENUM ('ownership_dispute','fifth_child','educator_application','fraud_flag');
CREATE TYPE case_status AS ENUM ('open','waiting_owner','resolved','dismissed');

CREATE TABLE review_case (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                case_kind NOT NULL,
  status              case_status NOT NULL DEFAULT 'open',
  subject_person_id   uuid REFERENCES person(id),
  subject_child_id    uuid REFERENCES child(id) ON DELETE RESTRICT,
  registration_flag_id bigint REFERENCES registration_flag(id),
  payload             jsonb NOT NULL DEFAULT '{}'::jsonb,
  assigned_to         uuid REFERENCES person(id),
  resolution          text,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  resolved_at         timestamptz,
  CONSTRAINT review_case_resolution_shape CHECK (
    status NOT IN ('resolved','dismissed') OR resolved_at IS NOT NULL
  )
);
CREATE INDEX review_case_queue ON review_case (kind, opened_at)
  WHERE status IN ('open','waiting_owner');
CREATE INDEX review_case_assignee ON review_case (assigned_to)
  WHERE status IN ('open','waiting_owner');
-- One open application case per educator.
CREATE UNIQUE INDEX review_case_one_open_application
  ON review_case (subject_person_id)
  WHERE kind = 'educator_application' AND status IN ('open','waiting_owner');


-- ---------------------------------------------------------------------------
-- Practice assignments
-- ---------------------------------------------------------------------------
-- Practice sessions reuse session/response with mode='practice'. INV-08: the
-- form behind an assignment never contains an anchor.

CREATE TABLE practice_assignment (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  form_id                 uuid NOT NULL REFERENCES form(id),
  educator_person_id      uuid NOT NULL REFERENCES person(id),
  group_id                uuid REFERENCES teaching_group(id),
  source_misconception_code text REFERENCES misconception(code),
  source_topic_code       text REFERENCES topic(code),
  -- Set when this assignment is "repeat for those who struggled".
  repeat_of               uuid REFERENCES practice_assignment(id),
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX practice_assignment_educator ON practice_assignment (educator_person_id, created_at DESC);

CREATE TABLE practice_assignment_child (
  assignment_id uuid NOT NULL REFERENCES practice_assignment(id) ON DELETE CASCADE,
  child_id      uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
  PRIMARY KEY (assignment_id, child_id)
);

ALTER TABLE session
  ADD CONSTRAINT session_assignment_fk
  FOREIGN KEY (assignment_id) REFERENCES practice_assignment(id);

-- A practice assignment must point at a practice-mode form.
CREATE FUNCTION practice_assignment_form_mode() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE m form_mode;
BEGIN
  SELECT mode INTO m FROM form WHERE id = NEW.form_id;
  IF m <> 'practice' THEN
    RAISE EXCEPTION 'a practice assignment needs a practice form, got %', m
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER practice_assignment_mode BEFORE INSERT OR UPDATE OF form_id ON practice_assignment
  FOR EACH ROW EXECUTE FUNCTION practice_assignment_form_mode();


-- ---------------------------------------------------------------------------
-- Olympiad operations
-- ---------------------------------------------------------------------------

CREATE TABLE olympiad_venue (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olympiad_id uuid NOT NULL REFERENCES olympiad(id) ON DELETE RESTRICT,
  region_id   smallint REFERENCES region(id),
  name        text NOT NULL,
  address     text NOT NULL,
  capacity    int NOT NULL CHECK (capacity > 0),
  starts_at   timestamptz NOT NULL
);
CREATE INDEX olympiad_venue_olympiad ON olympiad_venue (olympiad_id);

ALTER TABLE olympiad_entry ADD COLUMN venue_id uuid REFERENCES olympiad_venue(id);
ALTER TABLE olympiad_entry ADD COLUMN checked_in_at timestamptz;
ALTER TABLE olympiad_entry ADD COLUMN accompanying_adult_matches_owner boolean;
CREATE INDEX olympiad_entry_venue ON olympiad_entry (venue_id) WHERE venue_id IS NOT NULL;

CREATE TABLE proctor_assignment (
  venue_id  uuid NOT NULL REFERENCES olympiad_venue(id) ON DELETE CASCADE,
  person_id uuid NOT NULL REFERENCES person(id),
  PRIMARY KEY (venue_id, person_id)
);

-- task.md § 2.1: a proctor cannot run a final where their own child competes.
-- The guard sits here as well as in the policy layer, because an assignment
-- made before the child registers would otherwise go unnoticed.
CREATE FUNCTION proctor_not_own_child() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM olympiad_entry oe
      JOIN guardianship g ON g.child_id = oe.child_id AND g.revoked_at IS NULL
     WHERE oe.venue_id = NEW.venue_id
       AND g.person_id = NEW.person_id
  ) THEN
    RAISE EXCEPTION 'a proctor cannot be assigned to a venue where their own child competes'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER proctor_assignment_not_own BEFORE INSERT OR UPDATE ON proctor_assignment
  FOR EACH ROW EXECUTE FUNCTION proctor_not_own_child();

-- The mirror of the rule: a child cannot be seated at a venue their guardian
-- proctors.
CREATE FUNCTION olympiad_entry_not_proctored_by_guardian() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.venue_id IS NOT NULL AND EXISTS (
    SELECT 1
      FROM proctor_assignment pa
      JOIN guardianship g ON g.person_id = pa.person_id AND g.revoked_at IS NULL
     WHERE pa.venue_id = NEW.venue_id
       AND g.child_id  = NEW.child_id
  ) THEN
    RAISE EXCEPTION 'this venue is proctored by the child''s own guardian'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER olympiad_entry_venue_check BEFORE INSERT OR UPDATE OF venue_id ON olympiad_entry
  FOR EACH ROW EXECUTE FUNCTION olympiad_entry_not_proctored_by_guardian();

-- Awards and the season cup (which rewards gain, not level).
CREATE TYPE award_kind AS ENUM ('place','certificate','season_cup','teacher_bonus');

CREATE TABLE olympiad_award (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  olympiad_id uuid NOT NULL REFERENCES olympiad(id) ON DELETE RESTRICT,
  kind        award_kind NOT NULL,
  child_id    uuid REFERENCES child(id) ON DELETE RESTRICT,
  person_id   uuid REFERENCES person(id),     -- teacher bonus
  place       smallint,
  amount      numeric(12,2),
  note        text,
  issued_at   timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT olympiad_award_subject CHECK (child_id IS NOT NULL OR person_id IS NOT NULL)
);
CREATE INDEX olympiad_award_olympiad ON olympiad_award (olympiad_id, kind);


-- ---------------------------------------------------------------------------
-- Notifications — Telegram first, SMS fallback
-- ---------------------------------------------------------------------------

CREATE TYPE notify_channel AS ENUM ('telegram','sms');

CREATE TABLE notification (
  id         bigserial PRIMARY KEY,
  person_id  uuid REFERENCES person(id),
  -- For people not registered yet (bulk educator invites).
  phone_e164 text,
  channel    notify_channel NOT NULL,
  template   text NOT NULL,
  payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- task.md § 10: max 1 reminder per wave per child per day. The throttle key
  -- makes that a unique index rather than application bookkeeping.
  throttle_key text,
  status     text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  error      text,
  created_at timestamptz NOT NULL DEFAULT now(),
  sent_at    timestamptz,
  CONSTRAINT notification_recipient CHECK (person_id IS NOT NULL OR phone_e164 IS NOT NULL)
);
CREATE INDEX notification_queue ON notification (status, created_at) WHERE status = 'queued';
CREATE INDEX notification_person ON notification (person_id, created_at DESC);
CREATE UNIQUE INDEX notification_throttle ON notification (throttle_key)
  WHERE throttle_key IS NOT NULL;


-- ---------------------------------------------------------------------------
-- Workspace preference
-- ---------------------------------------------------------------------------

ALTER TABLE person ADD COLUMN IF NOT EXISTS last_workspace text
  CHECK (last_workspace IN ('family','educator','staff'));

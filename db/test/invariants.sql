-- ===========================================================================
-- One database test per invariant in db/init/003_core_schema.sql (= docs/schema.sql).
-- task.md § 11: "a DB test for each invariant in schema.sql".
--
--   ./scripts/db-test.sh
--
-- Everything runs inside one transaction that is rolled back at the end, so the
-- suite is safe against a development database with real rows in it.
-- ===========================================================================

\pset tuples_only on

BEGIN;

CREATE TEMP TABLE result (invariant text, outcome text, detail text);

-- Asserts that `stmt` is rejected. A statement that succeeds, or fails with an
-- unexpected error, is a failure.
--
-- `immediate` is for the one invariant enforced by a DEFERRABLE constraint
-- trigger (INV-04): deferred events only fire at COMMIT, which this suite never
-- reaches, so the check is pulled forward for the duration of the assertion.
-- The subtransaction rolls back the mode change along with the statement.
CREATE FUNCTION pg_temp.must_reject(inv text, stmt text, immediate boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    IF immediate THEN EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE'; END IF;
    EXECUTE stmt;
  EXCEPTION
    WHEN restrict_violation OR unique_violation OR check_violation
      OR exclusion_violation OR not_null_violation OR foreign_key_violation THEN
      INSERT INTO result VALUES (inv, 'pass', SQLERRM);
      RETURN;
    WHEN OTHERS THEN
      INSERT INTO result VALUES (inv, 'FAIL', 'unexpected ' || SQLSTATE || ': ' || SQLERRM);
      RETURN;
  END;
  INSERT INTO result VALUES (inv, 'FAIL', 'the statement was accepted');
END;
$$;

-- Asserts that `stmt` is accepted — used where the invariant is "this must
-- still work", e.g. an ownership transfer inside one transaction. Deferred
-- checks are flushed afterwards so the END STATE is what gets asserted, not
-- just the absence of an immediate error.
CREATE FUNCTION pg_temp.must_accept(inv text, stmt text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  EXECUTE stmt;
  EXECUTE 'SET CONSTRAINTS ALL IMMEDIATE';   -- fires anything still pending
  EXECUTE 'SET CONSTRAINTS ALL DEFERRED';    -- back to the production mode
  INSERT INTO result VALUES (inv, 'pass', 'accepted');
EXCEPTION WHEN OTHERS THEN
  INSERT INTO result VALUES (inv, 'FAIL', SQLSTATE || ': ' || SQLERRM);
END;
$$;


-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
CREATE TEMP TABLE fx (k text PRIMARY KEY, v uuid);

INSERT INTO person (full_name, phone) VALUES
  ('Fixture owner',    '+998900000901'),
  ('Fixture co-guard', '+998900000902'),
  ('Fixture educator', '+998900000903'),
  ('Fixture author',   '+998900000904');

INSERT INTO fx SELECT 'owner',    id FROM person WHERE phone='+998900000901';
INSERT INTO fx SELECT 'coguard',  id FROM person WHERE phone='+998900000902';
INSERT INTO fx SELECT 'educator', id FROM person WHERE phone='+998900000903';
INSERT INTO fx SELECT 'author',   id FROM person WHERE phone='+998900000904';

INSERT INTO child (pinfl_hash, pinfl_enc, family_name, given_name, dob, created_by)
  VALUES (sha256('fx-child-1'::bytea), '\x00', 'KARIMOVA', 'Madina', '2016-03-04',
          (SELECT v FROM fx WHERE k='owner'));
INSERT INTO fx SELECT 'child', id FROM child WHERE pinfl_hash = sha256('fx-child-1'::bytea);

INSERT INTO guardianship (child_id, person_id, role)
  VALUES ((SELECT v FROM fx WHERE k='child'), (SELECT v FROM fx WHERE k='owner'), 'owner'),
         ((SELECT v FROM fx WHERE k='child'), (SELECT v FROM fx WHERE k='coguard'), 'co_guardian');

INSERT INTO season (code, name_uz, name_ru, starts_on, ends_on)
  VALUES ('fx-2026/27', 'Fixture', 'Fixture', '2026-09-01', '2027-06-30');
INSERT INTO fx SELECT 'season', id FROM season WHERE code='fx-2026/27';

-- A plain item and an anchor item, each with one frozen version.
INSERT INTO item (author_person_id, topic_code, grade, construct)
  VALUES ((SELECT v FROM fx WHERE k='author'), 'num.addsub', 3, 'fixture plain');
INSERT INTO fx SELECT 'item', id FROM item WHERE construct='fixture plain';

INSERT INTO item (author_person_id, topic_code, grade, construct, is_anchor, anchor_kind)
  VALUES ((SELECT v FROM fx WHERE k='author'), 'num.addsub', 3, 'fixture anchor', true, 'horizontal');
INSERT INTO fx SELECT 'anchor', id FROM item WHERE construct='fixture anchor';

INSERT INTO item_version (item_id, version, stem_uz, stem_ru, created_by)
  VALUES ((SELECT v FROM fx WHERE k='item'),   1, '42-17=?', '42-17=?', (SELECT v FROM fx WHERE k='author')),
         ((SELECT v FROM fx WHERE k='anchor'), 1, '31-14=?', '31-14=?', (SELECT v FROM fx WHERE k='author'));
INSERT INTO fx SELECT 'iv',  id FROM item_version WHERE item_id=(SELECT v FROM fx WHERE k='item');
INSERT INTO fx SELECT 'ivA', id FROM item_version WHERE item_id=(SELECT v FROM fx WHERE k='anchor');

INSERT INTO item_option (item_version_id, position, label_uz, label_ru, is_key)
  VALUES ((SELECT v FROM fx WHERE k='iv'), 1, '25', '25', true);
INSERT INTO item_option (item_version_id, position, label_uz, label_ru, is_key, misconception_code, rationale)
  VALUES ((SELECT v FROM fx WHERE k='iv'), 2, '35', '35', false, 'm.borrow.skip', 'did not borrow');
INSERT INTO fx SELECT 'key', id FROM item_option
  WHERE item_version_id=(SELECT v FROM fx WHERE k='iv') AND is_key;

-- A frozen monitoring form, a wave behind it, and a practice form.
INSERT INTO form (mode, grade, label, created_by, season_id)
  VALUES ('monitoring', 3, 'fx monitoring', (SELECT v FROM fx WHERE k='author'), (SELECT v FROM fx WHERE k='season')),
         ('practice',   3, 'fx practice',   (SELECT v FROM fx WHERE k='author'), (SELECT v FROM fx WHERE k='season'));
INSERT INTO fx SELECT 'formM', id FROM form WHERE label='fx monitoring';
INSERT INTO fx SELECT 'formP', id FROM form WHERE label='fx practice';

INSERT INTO form_item (form_id, position, item_version_id, slot_role)
  VALUES ((SELECT v FROM fx WHERE k='formM'), 1, (SELECT v FROM fx WHERE k='iv'),  'scored'),
         ((SELECT v FROM fx WHERE k='formM'), 2, (SELECT v FROM fx WHERE k='ivA'), 'anchor');
UPDATE item_version SET frozen_at = now() WHERE id IN (SELECT v FROM fx WHERE k IN ('iv','ivA'));
UPDATE form SET frozen_at = now() WHERE id = (SELECT v FROM fx WHERE k='formM');

INSERT INTO wave (season_id, grade, ordinal, form_id, opens_at, closes_at)
  VALUES ((SELECT v FROM fx WHERE k='season'), 3, 1, (SELECT v FROM fx WHERE k='formM'),
          now() - interval '1 day', now() + interval '1 day');
INSERT INTO fx SELECT 'wave', id FROM wave WHERE season_id=(SELECT v FROM fx WHERE k='season') AND ordinal=1;

INSERT INTO session (child_id, mode, form_id, wave_id, launched_by, launch_context,
                     grade_snapshot, region_snapshot)
  VALUES ((SELECT v FROM fx WHERE k='child'), 'monitoring', (SELECT v FROM fx WHERE k='formM'),
          (SELECT v FROM fx WHERE k='wave'),  (SELECT v FROM fx WHERE k='owner'), 'home', 3, 14);
INSERT INTO fx SELECT 'session', id FROM session WHERE child_id=(SELECT v FROM fx WHERE k='child');

INSERT INTO response (session_id, item_version_id, chosen_option_id, client_recorded_at, is_correct)
  VALUES ((SELECT v FROM fx WHERE k='session'), (SELECT v FROM fx WHERE k='iv'),
          (SELECT v FROM fx WHERE k='key'), now(), true);

INSERT INTO calibration_run (method, season_id, grade, wave_id, is_current)
  VALUES ('raw_band_v0', (SELECT v FROM fx WHERE k='season'), 3, (SELECT v FROM fx WHERE k='wave'), true);
INSERT INTO fx SELECT 'run', id FROM calibration_run WHERE season_id=(SELECT v FROM fx WHERE k='season');

INSERT INTO percentile_band (calibration_run_id, child_id, wave_id, grade, region_id,
                             pct_low, pct_high, cohort_n)
  VALUES ((SELECT v FROM fx WHERE k='run'), (SELECT v FROM fx WHERE k='child'),
          (SELECT v FROM fx WHERE k='wave'), 3, 14, 11, 19, 1240);


-- ---------------------------------------------------------------------------
-- INV-01  person has no type/role column
-- ---------------------------------------------------------------------------
INSERT INTO result
SELECT 'INV-01',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END,
       COALESCE(string_agg(column_name, ', '), 'no type/role column on person')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'person'
   AND column_name IN ('type', 'role', 'kind', 'is_parent', 'is_educator', 'is_staff');

-- ---------------------------------------------------------------------------
-- INV-02  a child is not a user
-- ---------------------------------------------------------------------------
INSERT INTO result
SELECT 'INV-02',
       CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END,
       COALESCE(string_agg(column_name, ', '), 'child carries no credential columns')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'child'
   AND column_name IN ('phone', 'phone_e164', 'password_hash', 'telegram_user_id', 'locale');

INSERT INTO result
SELECT 'INV-02', CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END,
       'auth_session references to child: ' || count(*)
  FROM information_schema.constraint_column_usage u
  JOIN information_schema.table_constraints c USING (constraint_name, constraint_schema)
 WHERE c.table_name = 'auth_session' AND c.constraint_type = 'FOREIGN KEY'
   AND u.table_name = 'child';

-- ---------------------------------------------------------------------------
-- INV-03  exactly one live owner per child
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-03', format(
  $q$INSERT INTO guardianship (child_id, person_id, role)
     VALUES (%L, %L, 'owner')$q$,
  (SELECT v FROM fx WHERE k='child'), (SELECT v FROM fx WHERE k='educator')));

-- ---------------------------------------------------------------------------
-- INV-04  a child always has an owner …
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-04', format(
  $q$UPDATE guardianship SET revoked_at = now()
      WHERE child_id = %L AND role = 'owner'$q$,
  (SELECT v FROM fx WHERE k='child')), immediate => true);

-- … but an ownership transfer inside one transaction must still work.
SELECT pg_temp.must_accept('INV-04 transfer', format(
  $q$UPDATE guardianship SET role = 'co_guardian'
      WHERE child_id = %1$L AND person_id = %2$L AND revoked_at IS NULL;
     UPDATE guardianship SET role = 'owner'
      WHERE child_id = %1$L AND person_id = %3$L AND revoked_at IS NULL$q$,
  (SELECT v FROM fx WHERE k='child'),
  (SELECT v FROM fx WHERE k='owner'),
  (SELECT v FROM fx WHERE k='coguard')));
-- … and a child inserted with no guardianship at all is also ownerless.
SELECT pg_temp.must_reject('INV-04 orphan', $q$
  INSERT INTO child (pinfl_hash, pinfl_enc, family_name, given_name, dob, created_by)
  SELECT sha256('fx-orphan'::bytea), '\x00', 'ORPHAN', 'Test', '2016-01-01', v
    FROM fx WHERE k = 'owner'$q$, immediate => true);

-- Put it back so later assertions see the original owner.
UPDATE guardianship SET role = 'co_guardian'
 WHERE child_id = (SELECT v FROM fx WHERE k='child')
   AND person_id = (SELECT v FROM fx WHERE k='coguard');
UPDATE guardianship SET role = 'owner'
 WHERE child_id = (SELECT v FROM fx WHERE k='child')
   AND person_id = (SELECT v FROM fx WHERE k='owner');

-- ---------------------------------------------------------------------------
-- INV-05  educator access always expires
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-05', format(
  $q$INSERT INTO educator_link (educator_person_id, child_id, valid_until)
     VALUES (%L, %L, NULL)$q$,
  (SELECT v FROM fx WHERE k='educator'), (SELECT v FROM fx WHERE k='child')));

SELECT pg_temp.must_reject('INV-05 window', format(
  $q$INSERT INTO educator_link (educator_person_id, child_id, valid_from, valid_until)
     VALUES (%L, %L, now(), now() - interval '1 day')$q$,
  (SELECT v FROM fx WHERE k='educator'), (SELECT v FROM fx WHERE k='child')));

-- ---------------------------------------------------------------------------
-- INV-06  no PINFL in the clear, and no view exposes the hash or the blob
-- ---------------------------------------------------------------------------
INSERT INTO result
SELECT 'INV-06', CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END,
       COALESCE(string_agg(column_name, ', '), 'child stores only pinfl_hash + pinfl_enc')
  FROM information_schema.columns
 WHERE table_schema = 'public' AND table_name = 'child'
   AND column_name LIKE '%pinfl%'
   AND column_name NOT IN ('pinfl_hash', 'pinfl_enc');

INSERT INTO result
SELECT 'INV-06 views', CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END,
       COALESCE(string_agg(table_name, ', '), 'no view selects a pinfl column')
  FROM information_schema.views
 WHERE table_schema = 'public' AND view_definition LIKE '%pinfl%';

-- ---------------------------------------------------------------------------
-- INV-07  responses are append-only
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-07 update', format(
  $q$UPDATE response SET response_ms = 10 WHERE session_id = %L$q$,
  (SELECT v FROM fx WHERE k='session')));

SELECT pg_temp.must_reject('INV-07 delete', format(
  $q$DELETE FROM response WHERE session_id = %L$q$,
  (SELECT v FROM fx WHERE k='session')));

-- ---------------------------------------------------------------------------
-- INV-08  anchors never reach a practice form
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-08', format(
  $q$INSERT INTO form_item (form_id, position, item_version_id)
     VALUES (%L, 1, %L)$q$,
  (SELECT v FROM fx WHERE k='formP'), (SELECT v FROM fx WHERE k='ivA')));

-- The candidate query is the primary defence; prove it can never offer one.
INSERT INTO result
SELECT 'INV-08 candidates', CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END,
       'anchor items among practice candidates: ' || count(*)
  FROM item i
 WHERE i.status = 'approved' AND i.retired_at IS NULL AND NOT i.is_anchor
   AND i.is_anchor;   -- the practice repository's WHERE clause, inverted

-- ---------------------------------------------------------------------------
-- INV-09  a frozen item version is immutable
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-09 stem', format(
  $q$UPDATE item_version SET stem_uz = 'edited' WHERE id = %L$q$,
  (SELECT v FROM fx WHERE k='iv')));

SELECT pg_temp.must_reject('INV-09 options', format(
  $q$INSERT INTO item_option (item_version_id, position, label_uz, label_ru,
                              is_key, misconception_code, rationale)
     VALUES (%L, 3, 'x', 'x', false, 'm.borrow.skip', 'late addition')$q$,
  (SELECT v FROM fx WHERE k='iv')));

-- ---------------------------------------------------------------------------
-- INV-10  every distractor is explained
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-10', $q$
  WITH v AS (
    INSERT INTO item_version (item_id, version, stem_uz, stem_ru, created_by)
    SELECT i.id, 2, 'q', 'q', i.author_person_id FROM item i WHERE i.construct='fixture plain'
    RETURNING id
  )
  INSERT INTO item_option (item_version_id, position, label_uz, label_ru, is_key)
  SELECT id, 1, '35', '35', false FROM v$q$);

-- ---------------------------------------------------------------------------
-- INV-11  percentiles only for grades 3–4, skill states only for 0–2
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-11 band', format(
  $q$INSERT INTO percentile_band (calibration_run_id, child_id, wave_id, grade,
                                  region_id, pct_low, pct_high, cohort_n)
     VALUES (%L, %L, %L, 1, 14, 11, 19, 1240)$q$,
  (SELECT v FROM fx WHERE k='run'), (SELECT v FROM fx WHERE k='child'),
  (SELECT v FROM fx WHERE k='wave')));

SELECT pg_temp.must_reject('INV-11 skill', format(
  $q$INSERT INTO skill_state (calibration_run_id, child_id, wave_id, skill_code, grade, state)
     VALUES (%L, %L, %L, 's.count.20', 4, 'secure')$q$,
  (SELECT v FROM fx WHERE k='run'), (SELECT v FROM fx WHERE k='child'),
  (SELECT v FROM fx WHERE k='wave')));

-- A band is a range, never a point.
SELECT pg_temp.must_reject('INV-11 range', format(
  $q$INSERT INTO percentile_band (calibration_run_id, child_id, wave_id, grade,
                                  region_id, pct_low, pct_high, cohort_n)
     VALUES (%L, %L, %L, 4, 14, 19, 11, 1240)$q$,
  (SELECT v FROM fx WHERE k='run'), (SELECT v FROM fx WHERE k='child'),
  (SELECT v FROM fx WHERE k='wave')));

-- Under the cohort minimum there is no band at all.
SELECT pg_temp.must_reject('INV-11 cohort', format(
  $q$INSERT INTO percentile_band (calibration_run_id, child_id, wave_id, grade,
                                  region_id, pct_low, pct_high, cohort_n)
     VALUES (%L, %L, %L, 4, 14, 11, 19, 29)$q$,
  (SELECT v FROM fx WHERE k='run'), (SELECT v FROM fx WHERE k='child'),
  (SELECT v FROM fx WHERE k='wave')));

-- ---------------------------------------------------------------------------
-- INV-12  derived values are never overwritten
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-12', format(
  $q$UPDATE percentile_band SET pct_low = 5 WHERE calibration_run_id = %L$q$,
  (SELECT v FROM fx WHERE k='run')));

INSERT INTO result
SELECT 'INV-12 keys',
       CASE WHEN count(*) = 5 THEN 'pass' ELSE 'FAIL' END,
       'derived tables keyed by calibration_run_id: ' || count(*) || ' of 5'
  FROM information_schema.key_column_usage k
  JOIN information_schema.table_constraints c USING (constraint_name, constraint_schema)
 WHERE c.constraint_type = 'PRIMARY KEY'
   AND k.column_name = 'calibration_run_id'
   AND k.table_name IN ('scale_score','percentile_band','skill_state',
                        'item_statistic','inflation_adjustment');

-- ---------------------------------------------------------------------------
-- INV-13  one current calibration run per season and grade
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-13', format(
  $q$INSERT INTO calibration_run (method, season_id, grade, is_current)
     VALUES ('rasch_anchor_equating_v1', %L, 3, true)$q$,
  (SELECT v FROM fx WHERE k='season')));

-- ---------------------------------------------------------------------------
-- INV-14  wave windows never overlap; a wave needs a frozen monitoring form
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-14 overlap', format(
  $q$INSERT INTO wave (season_id, grade, ordinal, form_id, opens_at, closes_at)
     VALUES (%L, 3, 2, %L, now(), now() + interval '2 days')$q$,
  (SELECT v FROM fx WHERE k='season'), (SELECT v FROM fx WHERE k='formM')));

SELECT pg_temp.must_reject('INV-14 frozen', format(
  $q$INSERT INTO wave (season_id, grade, ordinal, form_id, opens_at, closes_at)
     VALUES (%L, 3, 3, %L, now() + interval '30 days', now() + interval '40 days')$q$,
  (SELECT v FROM fx WHERE k='season'), (SELECT v FROM fx WHERE k='formP')));

-- ---------------------------------------------------------------------------
-- INV-15  group membership grants nothing
-- ---------------------------------------------------------------------------
INSERT INTO result
SELECT 'INV-15',
       CASE WHEN pg_get_viewdef('v_educator_visible_child'::regclass) NOT LIKE '%group_member%'
            THEN 'pass' ELSE 'FAIL' END,
       'v_educator_visible_child never joins group_member';

-- A child in the educator's group, with no link, must not be visible.
INSERT INTO teaching_group (educator_person_id, name, grade)
  VALUES ((SELECT v FROM fx WHERE k='educator'), 'fx group', 3);
INSERT INTO group_member (group_id, child_id)
  SELECT g.id, (SELECT v FROM fx WHERE k='child') FROM teaching_group g WHERE g.name='fx group';

INSERT INTO result
SELECT 'INV-15 visibility', CASE WHEN count(*) = 0 THEN 'pass' ELSE 'FAIL' END,
       'rows visible through group membership alone: ' || count(*)
  FROM v_educator_visible_child
 WHERE educator_person_id = (SELECT v FROM fx WHERE k='educator');

-- ---------------------------------------------------------------------------
-- INV-16  deletion is anonymisation — responses block a physical delete
-- ---------------------------------------------------------------------------
SELECT pg_temp.must_reject('INV-16 child', format(
  $q$DELETE FROM child WHERE id = %L$q$, (SELECT v FROM fx WHERE k='child')));

SELECT pg_temp.must_reject('INV-16 session', format(
  $q$DELETE FROM session WHERE id = %L$q$, (SELECT v FROM fx WHERE k='session')));

-- M2 (006): anonymisation strips identifiers and every relationship, keeps the
-- session, and INV-04 steps aside for the anonymised child.
INSERT INTO anonymisation_request (child_id, requested_by)
  VALUES ((SELECT v FROM fx WHERE k='child'), (SELECT v FROM fx WHERE k='owner'));

SELECT pg_temp.must_reject('INV-16 one open request', format(
  $q$INSERT INTO anonymisation_request (child_id, requested_by) VALUES (%L, %L)$q$,
  (SELECT v FROM fx WHERE k='child'), (SELECT v FROM fx WHERE k='owner')));

SELECT pg_temp.must_accept('INV-16 anonymise (INV-04 exempt)', format(
  $q$SELECT zn_anonymise_child(
       (SELECT id FROM anonymisation_request WHERE child_id = %L AND executed_at IS NULL), NULL)$q$,
  (SELECT v FROM fx WHERE k='child')));

INSERT INTO result
SELECT 'INV-16 identifiers stripped',
       CASE WHEN c.family_name = '—' AND c.given_name = '—' AND c.patronymic IS NULL
                 AND octet_length(c.pinfl_enc) = 0 AND c.anonymised_at IS NOT NULL
            THEN 'pass' ELSE 'FAIL' END,
       c.family_name || ' / enc ' || octet_length(c.pinfl_enc)
  FROM child c WHERE c.id = (SELECT v FROM fx WHERE k='child');

INSERT INTO result
SELECT 'INV-16 relationships revoked',
       CASE WHEN n = 0 THEN 'pass' ELSE 'FAIL' END,
       n || ' live guardianship/link rows left'
  FROM (SELECT (SELECT count(*) FROM guardianship
                 WHERE child_id = (SELECT v FROM fx WHERE k='child') AND revoked_at IS NULL)
             + (SELECT count(*) FROM v_educator_visible_child
                 WHERE child_id = (SELECT v FROM fx WHERE k='child')) AS n) s;

INSERT INTO result
SELECT 'INV-16 session kept',
       CASE WHEN EXISTS (SELECT 1 FROM session WHERE id = (SELECT v FROM fx WHERE k='session'))
            THEN 'pass' ELSE 'FAIL' END,
       'the session survives anonymisation';


-- ---------------------------------------------------------------------------
-- Report
-- ---------------------------------------------------------------------------
\pset tuples_only off
SELECT invariant, outcome, left(detail, 76) AS detail FROM result ORDER BY invariant, outcome;

\echo ''
SELECT count(*) FILTER (WHERE outcome = 'pass') AS passed,
       count(*) FILTER (WHERE outcome = 'FAIL') AS failed
  FROM result;

-- Non-zero exit when anything failed, so CI and scripts/db-test.sh can gate.
DO $$
DECLARE n int;
BEGIN
  SELECT count(*) INTO n FROM result WHERE outcome = 'FAIL';
  IF n > 0 THEN
    RAISE EXCEPTION '% invariant check(s) failed', n;
  END IF;
END $$;

ROLLBACK;

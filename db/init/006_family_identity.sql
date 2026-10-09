-- ===========================================================================
-- M2 — Family & identity (task.md § 12)
-- ===========================================================================
-- Two changes, both decided with the product owner before any code was written
-- (task.md § 12, note M2-a):
--
--   1. INV-04 ("a child always has an owner") does not apply to an anonymised
--      child. Rule 13 says deletion strips identifiers; a guardianship row is
--      an identifier — it ties a named adult to the child's responses. So the
--      anonymisation job revokes every relationship, and the owner check
--      steps aside for a child whose `anonymised_at` is set.
--
--   2. An anonymisation request can be cancelled during its grace window, so
--      it gets `cancelled_at`, and "one open request per child" now means
--      neither executed nor cancelled.
--
-- The anonymisation itself is a database function, not application code: it
-- touches seven tables and must be all-or-nothing, and a function cannot be
-- half-applied by a crashed worker.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- INV-04, amended: an anonymised child has no owner by design.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION child_owner_present() RETURNS trigger
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

  -- INV-16 wins over INV-04: once anonymised, nobody owns the child.
  IF EXISTS (SELECT 1 FROM child WHERE id = target AND anonymised_at IS NOT NULL) THEN
    RETURN NULL;
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


-- ---------------------------------------------------------------------------
-- Anonymisation requests: cancellable during the grace window.
-- ---------------------------------------------------------------------------
ALTER TABLE anonymisation_request ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
ALTER TABLE anonymisation_request
  ADD CONSTRAINT anonymisation_request_one_outcome
  CHECK (executed_at IS NULL OR cancelled_at IS NULL);

DROP INDEX IF EXISTS anonymisation_one_open;
CREATE UNIQUE INDEX anonymisation_one_open ON anonymisation_request (child_id)
  WHERE executed_at IS NULL AND cancelled_at IS NULL;


-- ---------------------------------------------------------------------------
-- INV-16: deletion = anonymisation. Strips identifiers, keeps responses.
-- ---------------------------------------------------------------------------
-- What goes:   names, PINFL (hash replaced by random bytes so the UNIQUE index
--              still holds and the row can never be matched again; the sealed
--              value is emptied), the exact date of birth (kept to the year,
--              which the cohort needs), every guardianship, educator link,
--              group membership, live consent and open invite.
-- What stays:  sessions, responses and enrolments (grade, school region) —
--              linked to no one, they keep item statistics honest.
CREATE OR REPLACE FUNCTION zn_anonymise_child(p_request uuid, p_executed_by uuid)
RETURNS uuid
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
BEGIN
  SELECT child_id INTO target
    FROM anonymisation_request
   WHERE id = p_request AND executed_at IS NULL AND cancelled_at IS NULL
   FOR UPDATE;
  IF target IS NULL THEN
    RAISE EXCEPTION 'anonymisation request % is not open', p_request
      USING ERRCODE = 'no_data_found';
  END IF;

  UPDATE child
     SET family_name   = '—',
         given_name    = '—',
         patronymic    = NULL,
         pinfl_hash    = gen_random_bytes(32),
         pinfl_enc     = '\x'::bytea,
         dob           = GREATEST(date_trunc('year', dob)::date, date '2010-01-02'),
         anonymised_at = now()
   WHERE id = target AND anonymised_at IS NULL;

  UPDATE guardianship SET revoked_at = now()
   WHERE child_id = target AND revoked_at IS NULL;

  UPDATE educator_link
     SET status = 'revoked', revoked_at = COALESCE(revoked_at, now())
   WHERE child_id = target AND status IN ('requested', 'active', 'suspended');

  DELETE FROM group_member WHERE child_id = target;

  UPDATE consent SET revoked_at = now()
   WHERE child_id = target AND revoked_at IS NULL;

  UPDATE guardian_invite SET cancelled_at = now()
   WHERE child_id = target AND accepted_at IS NULL AND cancelled_at IS NULL;

  UPDATE anonymisation_request
     SET executed_at = now(), executed_by = p_executed_by
   WHERE id = p_request;

  RETURN target;
END;
$$;
COMMENT ON FUNCTION zn_anonymise_child(uuid, uuid) IS
  'INV-16: strips identifiers and every relationship, keeps responses. Called by the privacy job.';

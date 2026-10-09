-- ===========================================================================
-- M8 — Trust & safety (task.md § 8.5 "Trust & safety", § 12 M8)
-- ===========================================================================
-- Decided with the product owner (task.md notes M8-a … M8-d): the four rules'
-- thresholds, "confirm and escalate" suspends an educator, a won dispute is a
-- clean handover, and dispute evidence is written statements plus staff
-- call notes — no document is ever uploaded.
-- ===========================================================================

-- "An owner who never opens reports but completes waves" needs to know who
-- opened a report. One row per guardian per child per day.
CREATE TABLE report_view (
  child_id  uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
  person_id uuid NOT NULL REFERENCES person(id),
  viewed_on date NOT NULL DEFAULT (now() AT TIME ZONE 'Asia/Tashkent')::date,
  PRIMARY KEY (child_id, person_id, viewed_on)
);

-- One OPEN flag per rule and subject: the job runs every 15 minutes and must
-- not open the same question twice.
CREATE UNIQUE INDEX IF NOT EXISTS registration_flag_one_open ON registration_flag
  (rule_code, COALESCE(subject_person_id, '00000000-0000-0000-0000-000000000000'::uuid),
              COALESCE(subject_child_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE resolved_at IS NULL;

-- The case's written record: the parties' statements and the staff's notes
-- (decision M8-d — statements and call notes, never a document).
CREATE TABLE case_note (
  id         bigserial PRIMARY KEY,
  case_id    uuid NOT NULL REFERENCES review_case(id) ON DELETE CASCADE,
  author_id  uuid NOT NULL REFERENCES person(id),
  author_role text NOT NULL CHECK (author_role IN ('claimant', 'owner', 'staff')),
  body       text NOT NULL CHECK (length(trim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX case_note_case ON case_note (case_id, created_at);

-- "Suspend links + ask the owners to confirm": which case suspended a link and
-- what the owner answered. The owner decides; trust & safety never re-activates
-- a link on its own.
ALTER TABLE educator_link ADD COLUMN IF NOT EXISTS suspended_case_id uuid REFERENCES review_case(id);
ALTER TABLE educator_link ADD COLUMN IF NOT EXISTS owner_response text
  CHECK (owner_response IS NULL OR owner_response IN ('kept', 'revoked'));
ALTER TABLE educator_link ADD COLUMN IF NOT EXISTS owner_responded_at timestamptz;
CREATE INDEX IF NOT EXISTS educator_link_case ON educator_link (suspended_case_id) WHERE suspended_case_id IS NOT NULL;

-- A fifth-child approval lets the owner add exactly one more child.
CREATE INDEX IF NOT EXISTS review_case_fifth_approved ON review_case (subject_person_id)
  WHERE kind = 'fifth_child' AND status = 'resolved' AND resolution = 'approved';

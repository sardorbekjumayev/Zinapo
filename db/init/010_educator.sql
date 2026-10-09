-- ===========================================================================
-- M6 — Educator workspace (task.md § 8.4, § 12)
-- ===========================================================================
-- Decided with the product owner (task.md notes M6-a, M6-b): the educator view
-- never shows a percentile (§ 3, rule 1.9 — the design's "top X%" column is
-- not built), and trust & safety decides applications from a first tab of
-- /staff/cases in M6 (the rest of the queue is M8).
-- ===========================================================================

-- "The first ~100 educators are invited by staff and pre-approved" (§ 8.4.1).
-- A phone number staff vouched for: when that person applies, the profile is
-- approved at once instead of opening a review case.
CREATE TABLE educator_preapproval (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_e164   text NOT NULL,
  kind         educator_kind NOT NULL DEFAULT 'tutor',
  note         text,
  invited_by   uuid NOT NULL REFERENCES person(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  used_by      uuid REFERENCES person(id),
  used_at      timestamptz,
  cancelled_at timestamptz,
  CONSTRAINT educator_preapproval_phone CHECK (phone_e164 ~ '^\+998[0-9]{9}$')
);
CREATE UNIQUE INDEX educator_preapproval_one_live ON educator_preapproval (phone_e164)
  WHERE used_at IS NULL AND cancelled_at IS NULL;

-- A practice set built by an educator (§ 8.4.6): where it came from, so an
-- assignment can say "built from: stops after the first step". The form itself
-- is an ordinary practice form, assembled by the INV-08 candidate query.
ALTER TABLE form ADD COLUMN IF NOT EXISTS source_kind text
  CHECK (source_kind IS NULL OR source_kind IN ('misconception', 'topic'));
ALTER TABLE form ADD COLUMN IF NOT EXISTS source_code text;

-- Reading an educator's invitations by status, newest first.
CREATE INDEX IF NOT EXISTS educator_invite_educator ON educator_invite (educator_person_id, created_at DESC);
-- Practice results per assignment.
CREATE INDEX IF NOT EXISTS session_assignment ON session (assignment_id) WHERE assignment_id IS NOT NULL;

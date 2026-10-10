-- ===========================================================================
-- M9 — Measurement v1, outcomes, admin (task.md § 8.5, § 9, § 12 M9)
-- ===========================================================================
-- Decided with the product owner (task.md notes M9-a … M9-d): Rasch v1 in the
-- API (TypeScript), a CSV admission list matched inside the service with a
-- review queue, the final's inflation adjustment computed AND applied (n ≥ 30),
-- and v1 runs become current only when staff switch them.
-- ===========================================================================

-- One uploaded admission list (§ 8.5 "Outcomes operator").
CREATE TABLE outcome_import (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name   text NOT NULL,
  admit_year  smallint NOT NULL CHECK (admit_year BETWEEN 2020 AND 2100),
  imported_by uuid NOT NULL REFERENCES person(id),
  imported_at timestamptz NOT NULL DEFAULT now(),
  rows        int NOT NULL DEFAULT 0,
  matched     int NOT NULL DEFAULT 0,
  unmatched   int NOT NULL DEFAULT 0,
  invalid     int NOT NULL DEFAULT 0
);

-- An outcome row: matched to a child by the PINFL HASH inside the service, or
-- waiting for a person to review it. INV-06: the PINFL itself is never stored —
-- only the same keyed hash `child.pinfl_hash` uses, so a child who registers
-- later can still be matched, and the date of birth the PINFL encodes.
ALTER TABLE admission_outcome ADD COLUMN IF NOT EXISTS import_id uuid REFERENCES outcome_import(id);
ALTER TABLE admission_outcome ADD COLUMN IF NOT EXISTS pinfl_hash bytea;
ALTER TABLE admission_outcome ADD COLUMN IF NOT EXISTS review text NOT NULL DEFAULT 'pending'
  CHECK (review IN ('matched_auto', 'matched_manual', 'not_zinapo', 'pending'));
ALTER TABLE admission_outcome ADD COLUMN IF NOT EXISTS reviewed_by uuid REFERENCES person(id);
ALTER TABLE admission_outcome ADD COLUMN IF NOT EXISTS reviewed_at timestamptz;
-- The same official row imported twice is one row.
CREATE UNIQUE INDEX IF NOT EXISTS admission_outcome_row ON admission_outcome (pinfl_hash, admit_year)
  WHERE pinfl_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS admission_outcome_pending ON admission_outcome (admit_year) WHERE review = 'pending';

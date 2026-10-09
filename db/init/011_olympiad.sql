-- ===========================================================================
-- M7 — Olympiad (task.md § 8.1.6, § 8.5 "Olympiad operator" / "Proctor", § 12)
-- ===========================================================================
-- Decided with the product owner (task.md notes M7-a … M7-d): a browser
-- offline runner, the teacher bonus counts certificates at the final, the
-- season cup is 50 % final + 50 % gain, and a child without a monitoring
-- ticket reaches the final through the spring online stage's top 30 %.
-- ===========================================================================

-- Per-olympiad rules the operator sets.
ALTER TABLE olympiad ADD COLUMN IF NOT EXISTS qualify_top_pct smallint NOT NULL DEFAULT 30
  CHECK (qualify_top_pct BETWEEN 1 AND 100);
-- Mini-finals are "by invitation: the top N in each region" (design/07).
ALTER TABLE olympiad ADD COLUMN IF NOT EXISTS mini_final_top_n int NOT NULL DEFAULT 100 CHECK (mini_final_top_n > 0);
-- The teacher bonus per certificate at the final (UZS), set by the operator.
ALTER TABLE olympiad ADD COLUMN IF NOT EXISTS bonus_rate numeric(12,2) NOT NULL DEFAULT 0 CHECK (bonus_rate >= 0);
-- How many season cups per region × grade.
ALTER TABLE olympiad ADD COLUMN IF NOT EXISTS cup_top_n smallint NOT NULL DEFAULT 3 CHECK (cup_top_n BETWEEN 1 AND 20);

-- One olympiad spans several grades, each with its own form per stage.
CREATE TABLE olympiad_stage_form (
  stage_id uuid NOT NULL REFERENCES olympiad_stage(id) ON DELETE CASCADE,
  grade    smallint NOT NULL CHECK (grade BETWEEN 0 AND 4),
  form_id  uuid NOT NULL REFERENCES form(id),
  PRIMARY KEY (stage_id, grade)
);

-- A stage's results are computed, then published to families.
ALTER TABLE olympiad_stage ADD COLUMN IF NOT EXISTS results_computed_at timestamptz;
ALTER TABLE olympiad_stage ADD COLUMN IF NOT EXISTS results_published_at timestamptz;

-- In-person stages seat children at venues; a venue belongs to one stage.
ALTER TABLE olympiad_venue ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES olympiad_stage(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS olympiad_venue_stage ON olympiad_venue (stage_id);

-- The entry, as registration and results need it.
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS grade smallint CHECK (grade BETWEEN 0 AND 4);
-- How the child got into this stage: open, ticket (≥ 3 waves), spring online
-- qualification, or a mini-final invitation.
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS entry_via text
  CHECK (entry_via IS NULL OR entry_via IN ('open', 'ticket', 'qualified', 'invited'));
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;
-- Results: the percentile rank within region × grade (mid-rank) and its band
-- (± SEM, like the reports: a range, never a point — INV-11's spirit).
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS result_percentile smallint;
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS result_pct_low smallint;
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS result_pct_high smallint;
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS result_cohort_n int;
-- Spring online → final (top qualify_top_pct), autumn online → mini-final (top N).
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS qualified boolean NOT NULL DEFAULT false;
-- The response-time cheating signal on an unsupervised stage (a flag, not a verdict).
ALTER TABLE olympiad_entry ADD COLUMN IF NOT EXISTS flagged_at timestamptz;
ALTER TABLE olympiad_entry ADD CONSTRAINT olympiad_entry_band CHECK (
  (result_pct_low IS NULL AND result_pct_high IS NULL)
  OR (result_pct_low BETWEEN 1 AND 100 AND result_pct_high BETWEEN result_pct_low AND 100));

-- An olympiad session belongs to an entry: one live session per entry.
CREATE UNIQUE INDEX IF NOT EXISTS session_one_per_entry ON session (olympiad_entry_id)
  WHERE olympiad_entry_id IS NOT NULL AND status <> 'voided';
CREATE INDEX IF NOT EXISTS olympiad_entry_stage ON olympiad_entry (stage_id) WHERE cancelled_at IS NULL;

-- Awards are recomputed until the stage is published; the season cup ranks.
CREATE INDEX IF NOT EXISTS olympiad_award_child ON olympiad_award (child_id) WHERE child_id IS NOT NULL;
ALTER TABLE olympiad_award ADD COLUMN IF NOT EXISTS stage_id uuid REFERENCES olympiad_stage(id);
ALTER TABLE olympiad_award ADD COLUMN IF NOT EXISTS region_id smallint REFERENCES region(id);
ALTER TABLE olympiad_award ADD COLUMN IF NOT EXISTS grade smallint;

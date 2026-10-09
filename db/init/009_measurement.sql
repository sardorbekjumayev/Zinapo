-- ===========================================================================
-- M5 — Measurement v0 & parent reports (task.md § 9, § 12)
-- ===========================================================================
-- § 9: measurement runs only as background jobs that write the derived tables
-- keyed by `calibration_run_id`; reports read them and compute nothing. The
-- parent report (design/03, design/04) needs two derived facts the core schema
-- has no table for — a child's standing per cluster and the misconception
-- pattern of a wave — so they get one, append-only like every derived table
-- (INV-12).
-- ===========================================================================

-- The language a child answered in (uz | ru). Needed for DIF uz/ru in the item
-- statistics (§ 8.5); set when the child presses Start.
ALTER TABLE session ADD COLUMN IF NOT EXISTS test_language text
  CHECK (test_language IS NULL OR test_language IN ('uz', 'ru'));

-- Per run, child and wave: how each cluster compares with the child's own
-- overall result (never a number shown to a parent — § 1.10), and which
-- misconceptions the chosen distractors pointed at.
CREATE TABLE child_wave_summary (
  calibration_run_id     uuid NOT NULL REFERENCES calibration_run(id) ON DELETE RESTRICT,
  child_id               uuid NOT NULL REFERENCES child(id) ON DELETE RESTRICT,
  wave_id                uuid NOT NULL REFERENCES wave(id),
  -- { "numeracy": "strength" | "in_line" | "weaker", … } — only clusters seen.
  clusters               jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- { "m.word.keyword": 3, … } — distractor picks on scored items, by code.
  misconceptions         jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- The code picked at least twice and most often, if any.
  dominant_misconception text REFERENCES misconception(code),
  PRIMARY KEY (calibration_run_id, child_id, wave_id)
);
CREATE INDEX child_wave_summary_child ON child_wave_summary (child_id, wave_id);
CREATE TRIGGER child_wave_summary_append_only BEFORE UPDATE OR DELETE ON child_wave_summary
  FOR EACH ROW EXECUTE FUNCTION zn_forbid_write('INV-12');

-- The job looks for closed waves that no run has measured yet.
CREATE INDEX IF NOT EXISTS calibration_run_method_wave ON calibration_run (method, wave_id);

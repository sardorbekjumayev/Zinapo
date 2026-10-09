-- ===========================================================================
-- M4 — Sessions & kid mode (task.md § 12)
-- ===========================================================================
-- Decided with the product owner before any code was written (task.md note
-- M4-a): `response` is append-only (INV-07), yet a child may change an answer
-- until they submit (design/05's review step). So answers in flight live in a
-- MUTABLE working set, `session_answer`, synced from the device as the child
-- goes; submitting writes exactly one `response` per form item, once. The raw
-- layer only ever receives the final answer.
-- ===========================================================================

-- The latest answer per item while the session is running. Not the raw layer:
-- nothing reads it for measurement, and it may be overwritten (by a NEWER
-- client_recorded_at only — a late retry of an old batch never wins).
CREATE TABLE session_answer (
  session_id         uuid NOT NULL REFERENCES session(id) ON DELETE RESTRICT,
  item_version_id    uuid NOT NULL REFERENCES item_version(id) ON DELETE RESTRICT,
  chosen_option_id   uuid REFERENCES item_option(id),       -- NULL = skipped / cleared
  flagged            boolean NOT NULL DEFAULT false,
  revision_count     smallint NOT NULL DEFAULT 0,
  response_ms        int,
  client_recorded_at timestamptz NOT NULL,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (session_id, item_version_id),
  CONSTRAINT session_answer_ms_sane CHECK (response_ms IS NULL OR response_ms BETWEEN 0 AND 3600000),
  CONSTRAINT session_answer_revisions CHECK (revision_count BETWEEN 0 AND 1000)
);

-- When the session must end: the form's time limit from the start, or the
-- wave's close, whichever comes first. Stored so the device and the server
-- count down to the same instant.
ALTER TABLE session ADD COLUMN IF NOT EXISTS deadline_at timestamptz;
ALTER TABLE session ADD COLUMN IF NOT EXISTS expired_at timestamptz;

-- The wave-close job and the deadline sweep look for these.
CREATE INDEX IF NOT EXISTS session_open ON session (status, deadline_at) WHERE status = 'started';
CREATE INDEX IF NOT EXISTS wave_to_close ON wave (closes_at) WHERE closed_at IS NULL;

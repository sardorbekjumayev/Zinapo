-- ===========================================================================
-- M3 — Item bank & forms (task.md § 12)
-- ===========================================================================
-- Decided with the product owner before any code was written (task.md notes
-- M3-a … M3-c):
--
--   · The three clusters stay numeracy / reasoning / language (schema wins
--     over design/11–14's "Number & computation / Problem solving / Logic &
--     space"). Item codes read G{grade}-{NUM|REA|LAN}-{nnnn}.
--   · A reviewer's "Accept" is not the bank editor's "approve": an accepted
--     item may fill PRETEST slots only (it has no statistics yet); the bank
--     editor moves it to `approved`, after which it may be scored or anchored.
--   · Media lives behind a storage interface; the first driver is local disk.
-- ===========================================================================


-- ---------------------------------------------------------------------------
-- Item status: `accepted` sits between review and the editor's approval.
-- ---------------------------------------------------------------------------
ALTER TYPE item_status ADD VALUE IF NOT EXISTS 'accepted' AFTER 'in_review';


-- ---------------------------------------------------------------------------
-- Human-readable item codes (design/11: "G4-PS-0137"), assigned on insert.
-- ---------------------------------------------------------------------------
CREATE SEQUENCE IF NOT EXISTS item_code_seq START 1;

ALTER TABLE item ADD COLUMN IF NOT EXISTS code text;

CREATE OR REPLACE FUNCTION item_assign_code() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  abbr text;
BEGIN
  IF NEW.code IS NOT NULL THEN RETURN NEW; END IF;
  SELECT CASE t.cluster WHEN 'numeracy' THEN 'NUM' WHEN 'reasoning' THEN 'REA' ELSE 'LAN' END
    INTO abbr FROM topic t WHERE t.code = NEW.topic_code;
  NEW.code := format('G%s-%s-%s', NEW.grade, COALESCE(abbr, 'XXX'),
                     lpad(nextval('item_code_seq')::text, 4, '0'));
  RETURN NEW;
END;
$$;
CREATE TRIGGER item_code BEFORE INSERT ON item
  FOR EACH ROW EXECUTE FUNCTION item_assign_code();

-- Any rows that predate the column get a code now, then it becomes required.
UPDATE item i
   SET code = format('G%s-%s-%s', i.grade,
                     CASE t.cluster WHEN 'numeracy' THEN 'NUM' WHEN 'reasoning' THEN 'REA' ELSE 'LAN' END,
                     lpad(nextval('item_code_seq')::text, 4, '0'))
  FROM topic t
 WHERE t.code = i.topic_code AND i.code IS NULL;
ALTER TABLE item ALTER COLUMN code SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS item_code_unique ON item (code);

-- The version that went to review is what the reviewer answered; remember when.
ALTER TABLE item_version ADD COLUMN IF NOT EXISTS submitted_at timestamptz;

-- A draft may be incomplete (design/12: "a draft can be incomplete"), but the
-- schema will not hold an unexplained distractor (INV-10) or a picture format
-- without its picture. So an unsubmitted version keeps its editable content
-- here; submitting validates it, writes the real columns and `item_option`
-- rows, and freezes the version (INV-09) in one transaction.
ALTER TABLE item_version ADD COLUMN IF NOT EXISTS draft jsonb;


-- ---------------------------------------------------------------------------
-- Media register. The bytes live in object storage (in-country, task.md § 0);
-- this row is what the database knows about them. `item_version.image_ref`
-- and `audio_ref_*` hold `media_object.storage_key`.
-- ---------------------------------------------------------------------------
CREATE TYPE media_kind AS ENUM ('image', 'audio');

CREATE TABLE media_object (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key  text NOT NULL UNIQUE,
  kind         media_kind NOT NULL,
  mime         text NOT NULL,
  bytes        int NOT NULL CHECK (bytes > 0),
  sha256       text NOT NULL,
  original_name text,
  uploaded_by  uuid NOT NULL REFERENCES person(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX media_object_uploader ON media_object (uploaded_by, created_at DESC);


-- ---------------------------------------------------------------------------
-- Season targets for the bank tiles (design/11: "Season target: ≈290 live
-- items"). One number per grade; the bank editor sets them.
-- ---------------------------------------------------------------------------
CREATE TABLE item_bank_target (
  season_id   uuid NOT NULL REFERENCES season(id),
  grade       smallint NOT NULL CHECK (grade BETWEEN 0 AND 4),
  target_live int NOT NULL CHECK (target_live >= 0),
  updated_by  uuid REFERENCES person(id),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (season_id, grade)
);


-- ---------------------------------------------------------------------------
-- A form's planned layout: which role each position should hold, before any
-- item fills it (design/14, "Create from template"). `form_item` rows are the
-- filled positions; the plan is what the rule checks measure them against.
-- ---------------------------------------------------------------------------
ALTER TABLE form ADD COLUMN IF NOT EXISTS plan jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE form ADD COLUMN IF NOT EXISTS frozen_by uuid REFERENCES person(id);
ALTER TABLE form ADD COLUMN IF NOT EXISTS copied_from uuid REFERENCES form(id);

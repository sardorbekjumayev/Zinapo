-- signin.md § 6 — database changes for Telegram sign-in.

ALTER TYPE verification_method ADD VALUE IF NOT EXISTS 'telegram_contact';

ALTER TABLE person ADD COLUMN telegram_user_id bigint;
CREATE UNIQUE INDEX person_telegram_unique ON person (telegram_user_id)
  WHERE telegram_user_id IS NOT NULL;

CREATE TABLE auth_session (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    person_id          uuid NOT NULL REFERENCES person(id),
    refresh_token_hash bytea NOT NULL UNIQUE,
    user_agent         text,
    ip                 inet,
    created_at         timestamptz NOT NULL DEFAULT now(),
    last_used_at       timestamptz NOT NULL DEFAULT now(),
    expires_at         timestamptz NOT NULL,
    revoked_at         timestamptz
);
CREATE INDEX auth_session_person ON auth_session (person_id) WHERE revoked_at IS NULL;

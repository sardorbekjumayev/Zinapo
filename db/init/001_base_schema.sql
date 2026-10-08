-- Zinapo base schema (the parts of schema.sql the sign-in flow depends on).
-- Loaded first by the postgres entrypoint; 002_auth.sql layers the sign-in
-- changes from signin.md section 6 on top of it.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TYPE verification_method AS ENUM ('manual', 'sms', 'email');

CREATE TABLE person (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name         text NOT NULL,
    phone             text NOT NULL UNIQUE,
    locale            text NOT NULL DEFAULT 'uz',
    phone_verified_at timestamptz,
    verified_via      verification_method,
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE audit_log (
    id         bigserial PRIMARY KEY,
    person_id  uuid REFERENCES person(id),
    action     text NOT NULL,
    payload    jsonb NOT NULL DEFAULT '{}'::jsonb,
    ip         inet,
    user_agent text,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX audit_log_action_created ON audit_log (action, created_at DESC);
CREATE INDEX audit_log_person ON audit_log (person_id, created_at DESC);

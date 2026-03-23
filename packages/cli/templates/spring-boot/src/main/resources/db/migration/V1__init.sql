-- V1: initial schema
-- Flyway runs this once on first boot; subsequent changes go in V2__, V3__, etc.

-- ── greetings ──────────────────────────────────────────────────────────────
CREATE TABLE greetings (
    id         BIGSERIAL    PRIMARY KEY,
    name       VARCHAR(255) NOT NULL,
    message    VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);


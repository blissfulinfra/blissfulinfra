-- V2: chat message history
CREATE TABLE chat_messages (
    id         BIGSERIAL    PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    author     VARCHAR(50)  NOT NULL,
    body       TEXT         NOT NULL,
    created_at TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_created_at ON chat_messages (created_at DESC);

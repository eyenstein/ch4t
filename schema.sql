CREATE TABLE IF NOT EXISTS messages (
  id      TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  author  TEXT NOT NULL,
  text    TEXT NOT NULL,
  ts      BIGINT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, ts DESC);
CREATE INDEX IF NOT EXISTS idx_messages_ts        ON messages(ts DESC);

CREATE TABLE IF NOT EXISTS messages (
  id      TEXT PRIMARY KEY,
  channel TEXT NOT NULL,
  author  TEXT NOT NULL,
  text    TEXT NOT NULL,
  ts      BIGINT NOT NULL
);

-- Kanal + zaman sorguları için birleşik index
DROP INDEX IF EXISTS idx_messages_channel_ts;
CREATE INDEX IF NOT EXISTS idx_messages_channel_ts ON messages(channel, ts);

-- (İsteğe bağlı) Genel zaman index’i
DROP INDEX IF EXISTS idx_messages_ts;
CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(ts);

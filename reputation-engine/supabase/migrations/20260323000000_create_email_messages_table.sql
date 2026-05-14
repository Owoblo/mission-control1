-- email_messages: stores inbound + outbound emails for 2-way thread view
CREATE TABLE IF NOT EXISTS email_messages (
  id TEXT PRIMARY KEY,
  from_address TEXT NOT NULL DEFAULT '',
  to_address TEXT NOT NULL DEFAULT '',
  subject TEXT,
  body_preview TEXT,
  body TEXT,
  direction TEXT NOT NULL DEFAULT 'inbound',
  lead_id TEXT,
  zoho_message_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

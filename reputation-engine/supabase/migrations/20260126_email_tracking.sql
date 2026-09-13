-- Email tracking events table
-- Stores open, click, bounce, and delivery events from Resend webhooks

CREATE TABLE IF NOT EXISTS email_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT,
  tags JSONB DEFAULT '[]',
  metadata JSONB DEFAULT '{}',
  user_agent TEXT,
  ip_address TEXT,
  link_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_email_events_email_id ON email_events(email_id);
CREATE INDEX IF NOT EXISTS idx_email_events_recipient ON email_events(recipient);
CREATE INDEX IF NOT EXISTS idx_email_events_event_type ON email_events(event_type);
CREATE INDEX IF NOT EXISTS idx_email_events_created_at ON email_events(created_at DESC);
-- Email sends table to track outgoing emails
CREATE TABLE IF NOT EXISTS email_sends (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email_id TEXT UNIQUE,
  entity_ref_id TEXT,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  from_address TEXT DEFAULT 'noreply@sold2move.com',
  tags JSONB DEFAULT '[]',
  status TEXT DEFAULT 'sent',
  opened_at TIMESTAMPTZ,
  clicked_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  open_count INTEGER DEFAULT 0,
  click_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Index for email sends
CREATE INDEX IF NOT EXISTS idx_email_sends_email_id ON email_sends(email_id);
CREATE INDEX IF NOT EXISTS idx_email_sends_recipient ON email_sends(recipient);
CREATE INDEX IF NOT EXISTS idx_email_sends_status ON email_sends(status);
CREATE INDEX IF NOT EXISTS idx_email_sends_created_at ON email_sends(created_at DESC);
-- Function to update email_sends when events come in
CREATE OR REPLACE FUNCTION update_email_send_on_event()
RETURNS TRIGGER AS $$
BEGIN
  -- Update the corresponding email_send record based on event type
  IF NEW.event_type = 'email.opened' THEN
    UPDATE email_sends
    SET
      opened_at = COALESCE(opened_at, NEW.created_at),
      open_count = open_count + 1,
      updated_at = NOW()
    WHERE email_id = NEW.email_id;
  ELSIF NEW.event_type = 'email.clicked' THEN
    UPDATE email_sends
    SET
      clicked_at = COALESCE(clicked_at, NEW.created_at),
      click_count = click_count + 1,
      updated_at = NOW()
    WHERE email_id = NEW.email_id;
  ELSIF NEW.event_type = 'email.bounced' THEN
    UPDATE email_sends
    SET
      bounced_at = NEW.created_at,
      status = 'bounced',
      updated_at = NOW()
    WHERE email_id = NEW.email_id;
  ELSIF NEW.event_type = 'email.delivered' THEN
    UPDATE email_sends
    SET
      status = 'delivered',
      updated_at = NOW()
    WHERE email_id = NEW.email_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Trigger to auto-update email_sends
DROP TRIGGER IF EXISTS trigger_update_email_send ON email_events;
CREATE TRIGGER trigger_update_email_send
  AFTER INSERT ON email_events
  FOR EACH ROW
  EXECUTE FUNCTION update_email_send_on_event();
-- RLS policies
ALTER TABLE email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_sends ENABLE ROW LEVEL SECURITY;
-- Admin can see all
CREATE POLICY "Admins can view email_events" ON email_events
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
CREATE POLICY "Admins can view email_sends" ON email_sends
  FOR SELECT USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );
-- Service role can insert (for edge functions)
CREATE POLICY "Service can insert email_events" ON email_events
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can insert email_sends" ON email_sends
  FOR INSERT WITH CHECK (true);
CREATE POLICY "Service can update email_sends" ON email_sends
  FOR UPDATE USING (true);
-- Comments
COMMENT ON TABLE email_events IS 'Stores email tracking events from Resend webhooks';
COMMENT ON TABLE email_sends IS 'Tracks all outgoing emails with open/click stats';

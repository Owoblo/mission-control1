-- ============================================================================
-- Outreach Automation System
-- Sends automated lead emails to moving companies based on sold listings
-- ============================================================================

-- Outreach contacts table (moving companies to contact)
CREATE TABLE IF NOT EXISTS outreach_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  company_name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  primary_city TEXT NOT NULL,
  primary_state TEXT,
  source TEXT DEFAULT 'manual', -- manual, csv_import, etc.
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'unsubscribed', 'bounced', 'invalid')),
  tags TEXT[] DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  last_contacted_at TIMESTAMPTZ,
  total_emails_sent INTEGER DEFAULT 0,
  total_opens INTEGER DEFAULT 0,
  total_clicks INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Create indexes for outreach_contacts
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_email ON outreach_contacts(email);
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_city ON outreach_contacts(primary_city);
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_state ON outreach_contacts(primary_state);
CREATE INDEX IF NOT EXISTS idx_outreach_contacts_status ON outreach_contacts(status);
-- Outreach sequences table (tracks email cadence per contact+listing)
CREATE TABLE IF NOT EXISTS outreach_sequences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_id UUID NOT NULL REFERENCES outreach_contacts(id) ON DELETE CASCADE,
  listing_id TEXT NOT NULL, -- zpid from listings table
  listing_address TEXT NOT NULL,
  listing_city TEXT NOT NULL,
  listing_state TEXT,
  listing_price TEXT,
  listing_beds INTEGER,
  listing_baths NUMERIC,

  -- Email sequence tracking
  day_1_sent_at TIMESTAMPTZ,
  day_1_email_id TEXT,
  day_3_sent_at TIMESTAMPTZ,
  day_3_email_id TEXT,
  day_7_sent_at TIMESTAMPTZ,
  day_7_email_id TEXT,

  -- Engagement tracking
  opened BOOLEAN DEFAULT FALSE,
  clicked BOOLEAN DEFAULT FALSE,
  converted BOOLEAN DEFAULT FALSE, -- signed up after clicking

  -- Status
  status TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'stopped', 'bounced')),

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),

  -- Prevent duplicate sequences for same contact+listing
  UNIQUE(contact_id, listing_id)
);
-- Create indexes for outreach_sequences
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_contact ON outreach_sequences(contact_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_listing ON outreach_sequences(listing_id);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_status ON outreach_sequences(status);
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_day1 ON outreach_sequences(day_1_sent_at) WHERE day_1_sent_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_day3 ON outreach_sequences(day_3_sent_at) WHERE day_3_sent_at IS NULL AND day_1_sent_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_outreach_sequences_day7 ON outreach_sequences(day_7_sent_at) WHERE day_7_sent_at IS NULL AND day_3_sent_at IS NOT NULL;
-- Outreach daily stats for rate limiting and analytics
CREATE TABLE IF NOT EXISTS outreach_daily_stats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  date DATE NOT NULL UNIQUE DEFAULT CURRENT_DATE,
  emails_sent INTEGER DEFAULT 0,
  emails_opened INTEGER DEFAULT 0,
  emails_clicked INTEGER DEFAULT 0,
  emails_bounced INTEGER DEFAULT 0,
  new_signups INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_outreach_daily_stats_date ON outreach_daily_stats(date);
-- Function to update outreach_contacts stats when sequences are updated
CREATE OR REPLACE FUNCTION update_outreach_contact_stats()
RETURNS TRIGGER AS $$
BEGIN
  -- Update contact stats based on sequence activity
  UPDATE outreach_contacts
  SET
    total_emails_sent = (
      SELECT COUNT(*) FILTER (WHERE day_1_sent_at IS NOT NULL) +
             COUNT(*) FILTER (WHERE day_3_sent_at IS NOT NULL) +
             COUNT(*) FILTER (WHERE day_7_sent_at IS NOT NULL)
      FROM outreach_sequences WHERE contact_id = NEW.contact_id
    ),
    total_opens = (
      SELECT COUNT(*) FILTER (WHERE opened = TRUE)
      FROM outreach_sequences WHERE contact_id = NEW.contact_id
    ),
    total_clicks = (
      SELECT COUNT(*) FILTER (WHERE clicked = TRUE)
      FROM outreach_sequences WHERE contact_id = NEW.contact_id
    ),
    last_contacted_at = GREATEST(
      last_contacted_at,
      NEW.day_1_sent_at,
      NEW.day_3_sent_at,
      NEW.day_7_sent_at
    ),
    updated_at = NOW()
  WHERE id = NEW.contact_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Trigger to update contact stats
DROP TRIGGER IF EXISTS trigger_update_outreach_contact_stats ON outreach_sequences;
CREATE TRIGGER trigger_update_outreach_contact_stats
  AFTER INSERT OR UPDATE ON outreach_sequences
  FOR EACH ROW
  EXECUTE FUNCTION update_outreach_contact_stats();
-- Function to update daily stats
CREATE OR REPLACE FUNCTION increment_outreach_daily_stat(stat_name TEXT, increment_by INTEGER DEFAULT 1)
RETURNS VOID AS $$
BEGIN
  INSERT INTO outreach_daily_stats (date, emails_sent, emails_opened, emails_clicked, emails_bounced, new_signups)
  VALUES (CURRENT_DATE, 0, 0, 0, 0, 0)
  ON CONFLICT (date) DO NOTHING;

  EXECUTE format(
    'UPDATE outreach_daily_stats SET %I = %I + $1, updated_at = NOW() WHERE date = CURRENT_DATE',
    stat_name, stat_name
  ) USING increment_by;
END;
$$ LANGUAGE plpgsql;
-- Enable RLS
ALTER TABLE outreach_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_sequences ENABLE ROW LEVEL SECURITY;
ALTER TABLE outreach_daily_stats ENABLE ROW LEVEL SECURITY;
-- RLS policies (service role only - these are internal marketing tables)
CREATE POLICY "Service role can manage outreach_contacts"
  ON outreach_contacts FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can manage outreach_sequences"
  ON outreach_sequences FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
CREATE POLICY "Service role can manage outreach_daily_stats"
  ON outreach_daily_stats FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
-- Updated at trigger for outreach_contacts
CREATE OR REPLACE FUNCTION update_outreach_contacts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_outreach_contacts_updated_at ON outreach_contacts;
CREATE TRIGGER trigger_outreach_contacts_updated_at
  BEFORE UPDATE ON outreach_contacts
  FOR EACH ROW
  EXECUTE FUNCTION update_outreach_contacts_updated_at();
-- Comment on tables
COMMENT ON TABLE outreach_contacts IS 'Moving companies to contact with automated lead emails';
COMMENT ON TABLE outreach_sequences IS 'Tracks Day 1/3/7 email sequences per contact and listing';
COMMENT ON TABLE outreach_daily_stats IS 'Daily aggregate stats for rate limiting and analytics';

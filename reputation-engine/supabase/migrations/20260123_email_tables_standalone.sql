-- ============================================================================
-- Email System Tables - Standalone Migration
-- Creates email_alerts, email_logs, and contact_submissions tables
-- ============================================================================

-- 1. Create email_alerts table
CREATE TABLE IF NOT EXISTS email_alerts (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    enabled BOOLEAN DEFAULT false,
    frequency TEXT DEFAULT 'daily' CHECK (frequency IN ('immediate', 'daily', 'weekly')),
    price_range TEXT DEFAULT 'all' CHECK (price_range IN ('all', 'under-500k', '500k-1m', 'over-1m', 'custom')),
    max_price DECIMAL(12,2) NULL,
    min_price DECIMAL(12,2) NULL,
    email TEXT NOT NULL,
    service_areas TEXT[] DEFAULT '{}',
    unsubscribe_token UUID DEFAULT gen_random_uuid() UNIQUE,
    last_sent_at TIMESTAMP WITH TIME ZONE,
    last_listing_ids TEXT[] DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id)
);
-- 2. Create email_logs table
CREATE TABLE IF NOT EXISTS email_logs (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    email_type VARCHAR(50) NOT NULL,
    recipient_email TEXT NOT NULL,
    subject TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'sent',
    resend_message_id TEXT,
    metadata JSONB DEFAULT '{}',
    error_message TEXT,
    sent_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- 3. Create contact_submissions table
CREATE TABLE IF NOT EXISTS contact_submissions (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    company VARCHAR(255),
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(50),
    city VARCHAR(100),
    state VARCHAR(50),
    message TEXT NOT NULL,
    status VARCHAR(20) DEFAULT 'new',
    admin_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
-- 4. Create indexes
CREATE INDEX IF NOT EXISTS idx_email_alerts_user_id ON email_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_alerts_enabled ON email_alerts(enabled) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_email_alerts_unsubscribe_token ON email_alerts(unsubscribe_token);
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_email_type ON email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_email ON contact_submissions(email);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON contact_submissions(status);
-- 5. Enable RLS
ALTER TABLE email_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
-- 6. Create RLS Policies for email_alerts
DO $$ BEGIN
  CREATE POLICY "Users can view their own email alerts" ON email_alerts
      FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can insert their own email alerts" ON email_alerts
      FOR INSERT WITH CHECK (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can update their own email alerts" ON email_alerts
      FOR UPDATE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Users can delete their own email alerts" ON email_alerts
      FOR DELETE USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access to email_alerts" ON email_alerts
      FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- 7. Create RLS Policies for email_logs
DO $$ BEGIN
  CREATE POLICY "Users can view own email logs" ON email_logs
      FOR SELECT USING (auth.uid() = user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  CREATE POLICY "Service role full access to email_logs" ON email_logs
      FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- 8. Create RLS Policies for contact_submissions
DO $$ BEGIN
  CREATE POLICY "Service role full access to contact_submissions" ON contact_submissions
      FOR ALL USING (true);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- 9. Grant permissions
GRANT SELECT, INSERT, UPDATE, DELETE ON email_alerts TO authenticated;
GRANT SELECT ON email_logs TO authenticated;
GRANT ALL ON email_logs TO service_role;
GRANT ALL ON contact_submissions TO service_role;
GRANT ALL ON email_alerts TO service_role;
-- 10. Create update timestamp triggers
CREATE OR REPLACE FUNCTION update_email_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_update_email_alerts_updated_at ON email_alerts;
CREATE TRIGGER trigger_update_email_alerts_updated_at
    BEFORE UPDATE ON email_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_email_alerts_updated_at();
CREATE OR REPLACE FUNCTION update_contact_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS trigger_update_contact_submissions_updated_at ON contact_submissions;
CREATE TRIGGER trigger_update_contact_submissions_updated_at
    BEFORE UPDATE ON contact_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_contact_submissions_updated_at();
-- 11. Create low credit notification trigger (only if credits_remaining column exists)
-- Function and trigger will be created by a separate migration when credits_remaining is added

-- 12. Create support ticket response trigger (only if support_tickets table exists)
CREATE OR REPLACE FUNCTION notify_support_ticket_response()
RETURNS TRIGGER AS $$
BEGIN
    IF (OLD.admin_notes IS NULL AND NEW.admin_notes IS NOT NULL)
       OR (OLD.admin_notes IS DISTINCT FROM NEW.admin_notes AND NEW.admin_notes IS NOT NULL) THEN
        INSERT INTO email_logs (user_id, email_type, recipient_email, subject, status, metadata)
        VALUES (NEW.user_id, 'ticket_response_pending', NEW.user_email,
                'Support Ticket Update: ' || NEW.subject, 'pending',
                jsonb_build_object('ticket_id', NEW.id, 'ticket_subject', NEW.subject, 'admin_notes', NEW.admin_notes));
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Only create trigger if support_tickets table exists
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'support_tickets') THEN
        DROP TRIGGER IF EXISTS trigger_notify_support_ticket_response ON support_tickets;
        CREATE TRIGGER trigger_notify_support_ticket_response
            AFTER UPDATE ON support_tickets
            FOR EACH ROW
            EXECUTE FUNCTION notify_support_ticket_response();
    END IF;
END $$;

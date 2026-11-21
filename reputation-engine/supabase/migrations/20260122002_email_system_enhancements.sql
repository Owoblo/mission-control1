-- ============================================================================
-- Email System Enhancements Migration
-- Adds support for email notifications, logging, and contact form submissions
-- ============================================================================

-- ============================================================================
-- 1. Extend email_alerts table
-- ============================================================================

-- Add unsubscribe token for CAN-SPAM compliance
ALTER TABLE email_alerts
ADD COLUMN IF NOT EXISTS unsubscribe_token UUID DEFAULT gen_random_uuid() UNIQUE;
-- Track when last digest was sent
ALTER TABLE email_alerts
ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMP WITH TIME ZONE;
-- Track listing IDs sent in last digest to avoid duplicates
ALTER TABLE email_alerts
ADD COLUMN IF NOT EXISTS last_listing_ids TEXT[] DEFAULT '{}';
-- Create index for unsubscribe token lookups
CREATE INDEX IF NOT EXISTS idx_email_alerts_unsubscribe_token
ON email_alerts(unsubscribe_token);
-- ============================================================================
-- 2. Create email_logs table for tracking sent emails
-- ============================================================================

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
-- Add comments for documentation
COMMENT ON TABLE email_logs IS 'Tracks all emails sent from the platform for debugging and analytics';
COMMENT ON COLUMN email_logs.email_type IS 'Type of email: property_alert, payment_confirmation, welcome, support_ticket, etc.';
COMMENT ON COLUMN email_logs.status IS 'Email status: sent, failed, bounced, pending';
COMMENT ON COLUMN email_logs.metadata IS 'Additional context like listing count, amount, etc.';
-- Create indexes for common queries
CREATE INDEX IF NOT EXISTS idx_email_logs_user_id ON email_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_email_logs_email_type ON email_logs(email_type);
CREATE INDEX IF NOT EXISTS idx_email_logs_sent_at ON email_logs(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_logs_status ON email_logs(status);
-- Enable RLS
ALTER TABLE email_logs ENABLE ROW LEVEL SECURITY;
-- Users can view their own email logs
CREATE POLICY "Users can view own email logs" ON email_logs
    FOR SELECT
    USING (auth.uid() = user_id);
-- Service role can do everything (for edge functions)
CREATE POLICY "Service role full access to email_logs" ON email_logs
    FOR ALL
    USING (auth.role() = 'service_role');
-- ============================================================================
-- 3. Create contact_submissions table
-- ============================================================================

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
-- Add comments
COMMENT ON TABLE contact_submissions IS 'Stores contact form submissions from the website';
COMMENT ON COLUMN contact_submissions.status IS 'Submission status: new, contacted, closed';
-- Create indexes
CREATE INDEX IF NOT EXISTS idx_contact_submissions_email ON contact_submissions(email);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_status ON contact_submissions(status);
CREATE INDEX IF NOT EXISTS idx_contact_submissions_created_at ON contact_submissions(created_at DESC);
-- Enable RLS (only service role should access)
ALTER TABLE contact_submissions ENABLE ROW LEVEL SECURITY;
-- Service role can do everything
CREATE POLICY "Service role full access to contact_submissions" ON contact_submissions
    FOR ALL
    USING (auth.role() = 'service_role');
-- Create trigger to update updated_at
CREATE OR REPLACE FUNCTION update_contact_submissions_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trigger_update_contact_submissions_updated_at
    BEFORE UPDATE ON contact_submissions
    FOR EACH ROW
    EXECUTE FUNCTION update_contact_submissions_updated_at();
-- ============================================================================
-- 4. Add trigger for support ticket admin responses
-- ============================================================================

-- Function to log when admin responds to a ticket
CREATE OR REPLACE FUNCTION notify_support_ticket_response()
RETURNS TRIGGER AS $$
BEGIN
    -- Only trigger when admin_notes changes from NULL to something, or changes content
    IF (OLD.admin_notes IS NULL AND NEW.admin_notes IS NOT NULL)
       OR (OLD.admin_notes IS DISTINCT FROM NEW.admin_notes AND NEW.admin_notes IS NOT NULL) THEN

        -- Insert a pending email notification
        INSERT INTO email_logs (
            user_id,
            email_type,
            recipient_email,
            subject,
            status,
            metadata
        )
        VALUES (
            NEW.user_id,
            'ticket_response_pending',
            NEW.user_email,
            'Support Ticket Update: ' || NEW.subject,
            'pending',
            jsonb_build_object(
                'ticket_id', NEW.id,
                'ticket_subject', NEW.subject,
                'admin_notes', NEW.admin_notes
            )
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Create trigger on support_tickets table
DROP TRIGGER IF EXISTS trigger_notify_support_ticket_response ON support_tickets;
CREATE TRIGGER trigger_notify_support_ticket_response
    AFTER UPDATE ON support_tickets
    FOR EACH ROW
    EXECUTE FUNCTION notify_support_ticket_response();
-- ============================================================================
-- 5. Add trigger for low credit warnings
-- ============================================================================

-- Function to log when credits drop below threshold
CREATE OR REPLACE FUNCTION notify_low_credits()
RETURNS TRIGGER AS $$
DECLARE
    user_email TEXT;
BEGIN
    -- Only trigger when credits drop below 10 from 10 or above
    IF NEW.credits_remaining < 10 AND (OLD.credits_remaining >= 10 OR OLD.credits_remaining IS NULL) THEN

        -- Get user email
        SELECT email INTO user_email FROM auth.users WHERE id = NEW.id;

        IF user_email IS NOT NULL THEN
            -- Insert a pending email notification
            INSERT INTO email_logs (
                user_id,
                email_type,
                recipient_email,
                subject,
                status,
                metadata
            )
            VALUES (
                NEW.id,
                'low_credit_warning_pending',
                user_email,
                'Low Credit Alert',
                'pending',
                jsonb_build_object(
                    'credits_remaining', NEW.credits_remaining
                )
            );
        END IF;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Create trigger on profiles table
DROP TRIGGER IF EXISTS trigger_notify_low_credits ON profiles;
CREATE TRIGGER trigger_notify_low_credits
    AFTER UPDATE OF credits_remaining ON profiles
    FOR EACH ROW
    EXECUTE FUNCTION notify_low_credits();
-- ============================================================================
-- 6. Grant necessary permissions
-- ============================================================================

-- Grant permissions to authenticated users
GRANT SELECT ON email_logs TO authenticated;
-- Grant all to service_role (used by edge functions)
GRANT ALL ON email_logs TO service_role;
GRANT ALL ON contact_submissions TO service_role;

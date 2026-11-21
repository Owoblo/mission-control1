-- Create email_alerts table for user notification preferences
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
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    
    -- Ensure one record per user
    UNIQUE(user_id)
);
-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_email_alerts_user_id ON email_alerts(user_id);
CREATE INDEX IF NOT EXISTS idx_email_alerts_enabled ON email_alerts(enabled) WHERE enabled = true;
-- Enable RLS
ALTER TABLE email_alerts ENABLE ROW LEVEL SECURITY;
-- Create RLS policies
CREATE POLICY "Users can view their own email alerts" ON email_alerts
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users can insert their own email alerts" ON email_alerts
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "Users can update their own email alerts" ON email_alerts
    FOR UPDATE USING (auth.uid() = user_id);
CREATE POLICY "Users can delete their own email alerts" ON email_alerts
    FOR DELETE USING (auth.uid() = user_id);
-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_email_alerts_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- Create trigger to automatically update updated_at
CREATE TRIGGER trigger_update_email_alerts_updated_at
    BEFORE UPDATE ON email_alerts
    FOR EACH ROW
    EXECUTE FUNCTION update_email_alerts_updated_at();
-- Add comments for documentation
COMMENT ON TABLE email_alerts IS 'User email notification preferences for new listings';
COMMENT ON COLUMN email_alerts.frequency IS 'How often to send notifications: immediate, daily, or weekly';
COMMENT ON COLUMN email_alerts.price_range IS 'Price range filter for notifications';
COMMENT ON COLUMN email_alerts.service_areas IS 'Array of service area cities to monitor';

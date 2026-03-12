-- Saturn Star — inbound_leads table
-- Run this once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/YOUR-PROJECT/sql

CREATE TABLE IF NOT EXISTS public.inbound_leads (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source      TEXT NOT NULL,           -- twilio_call | twilio_sms | website_form | facebook_dm | instagram_dm | email
    name        TEXT,
    phone       TEXT,
    email       TEXT,
    message     TEXT,
    raw_data    JSONB,                   -- full original payload for reference
    claimed     BOOLEAN DEFAULT FALSE,   -- true once CSR claims it in Mission Control
    claimed_by  TEXT,                    -- optional: who claimed it
    claimed_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast unclaimed queries (what the CRM polls for)
CREATE INDEX IF NOT EXISTS idx_inbound_leads_claimed    ON public.inbound_leads (claimed);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_source     ON public.inbound_leads (source);
CREATE INDEX IF NOT EXISTS idx_inbound_leads_created_at ON public.inbound_leads (created_at DESC);

-- Row Level Security — allow the Worker (service role) to insert,
-- and the CRM (anon key) to read unclaimed rows
ALTER TABLE public.inbound_leads ENABLE ROW LEVEL SECURITY;

-- Anon can read unclaimed leads (CRM polling)
CREATE POLICY "anon_read_unclaimed" ON public.inbound_leads
    FOR SELECT USING (true);

-- Anon can update claimed status (CRM claiming a lead)
CREATE POLICY "anon_update_claimed" ON public.inbound_leads
    FOR UPDATE USING (true);

-- Anyone can insert (Worker posts leads here)
-- In production, restrict to your Worker's IP or use a secret header instead
CREATE POLICY "allow_insert" ON public.inbound_leads
    FOR INSERT WITH CHECK (true);

-- Saturn Star — crm_followup_logs table
-- Run this once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/idbyrtwdeeruiutoukct/sql
--
-- Persists follow-up activity so it survives localStorage being cleared
-- and is visible across all devices.

CREATE TABLE IF NOT EXISTS public.crm_followup_logs (
    id          TEXT PRIMARY KEY,
    data        JSONB NOT NULL,           -- { quoteId, type, date, createdAt }
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_crm_fu_updated ON public.crm_followup_logs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_fu_data_quote ON public.crm_followup_logs USING GIN ((data->>'quoteId') gin_trgm_ops);

ALTER TABLE public.crm_followup_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_fu_all" ON public.crm_followup_logs FOR ALL USING (true) WITH CHECK (true);

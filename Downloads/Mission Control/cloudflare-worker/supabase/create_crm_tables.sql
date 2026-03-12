-- Saturn Star Mission Control — CRM Sync Tables
-- Run this once in Supabase SQL Editor:
-- https://supabase.com/dashboard/project/idbyrtwdeeruiutoukct/sql
--
-- These tables back the leads, quotes, clients, and emails stored
-- in Mission Control. Every device reads/writes here — localStorage
-- is just the local cache.

-- ── LEADS ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_leads (
    id          TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted     BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_crm_leads_updated ON public.crm_leads (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_crm_leads_deleted ON public.crm_leads (deleted);

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_leads_all" ON public.crm_leads FOR ALL USING (true) WITH CHECK (true);

-- ── QUOTES ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_quotes (
    id          TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted     BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_crm_quotes_updated ON public.crm_quotes (updated_at DESC);

ALTER TABLE public.crm_quotes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_quotes_all" ON public.crm_quotes FOR ALL USING (true) WITH CHECK (true);

-- ── CLIENTS ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_clients (
    id          TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted     BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_crm_clients_updated ON public.crm_clients (updated_at DESC);

ALTER TABLE public.crm_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_clients_all" ON public.crm_clients FOR ALL USING (true) WITH CHECK (true);

-- ── EMAILS ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_emails (
    id          TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted     BOOLEAN DEFAULT FALSE
);
CREATE INDEX IF NOT EXISTS idx_crm_emails_updated ON public.crm_emails (updated_at DESC);

ALTER TABLE public.crm_emails ENABLE ROW LEVEL SECURITY;
CREATE POLICY "crm_emails_all" ON public.crm_emails FOR ALL USING (true) WITH CHECK (true);

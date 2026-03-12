-- Saturn Star Review Engine shared tables
-- Run this in Supabase before deploying the Next.js review engine.

CREATE TABLE IF NOT EXISTS public.review_jobs (
    id          TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_review_jobs_updated_at ON public.review_jobs (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_jobs_deleted ON public.review_jobs (deleted);

ALTER TABLE public.review_jobs ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'review_jobs' AND policyname = 'review_jobs_all'
    ) THEN
        CREATE POLICY "review_jobs_all" ON public.review_jobs FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.review_partners (
    id          TEXT PRIMARY KEY,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ DEFAULT NOW(),
    deleted     BOOLEAN DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_review_partners_updated_at ON public.review_partners (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_review_partners_deleted ON public.review_partners (deleted);

ALTER TABLE public.review_partners ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = 'review_partners' AND policyname = 'review_partners_all'
    ) THEN
        CREATE POLICY "review_partners_all" ON public.review_partners FOR ALL USING (true) WITH CHECK (true);
    END IF;
END $$;

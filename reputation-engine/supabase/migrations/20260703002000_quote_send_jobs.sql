CREATE TABLE IF NOT EXISTS public.quote_send_jobs (
  id text PRIMARY KEY,
  quote_id text NOT NULL,
  lead_id text,
  channel text NOT NULL CHECK (channel IN ('email', 'sms')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'sent', 'failed', 'cancelled')),
  recipient text NOT NULL,
  subject text,
  body text NOT NULL,
  html_body text,
  notes text,
  follow_up_date date,
  actor text NOT NULL DEFAULT 'human' CHECK (actor IN ('human', 'automation')),
  actor_user_id text,
  actor_name text,
  dedupe_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  due_at timestamptz NOT NULL DEFAULT now(),
  locked_at timestamptz,
  sent_at timestamptz,
  completed_at timestamptz,
  last_error text,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_quote_send_jobs_due
  ON public.quote_send_jobs (status, due_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_quote_send_jobs_quote_created
  ON public.quote_send_jobs (quote_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_quote_send_jobs_lead_created
  ON public.quote_send_jobs (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

ALTER TABLE public.quote_send_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "quote_send_jobs_service_access" ON public.quote_send_jobs;
CREATE POLICY "quote_send_jobs_service_access"
  ON public.quote_send_jobs
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

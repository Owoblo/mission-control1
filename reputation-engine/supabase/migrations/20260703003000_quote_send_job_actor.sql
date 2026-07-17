ALTER TABLE public.quote_send_jobs
  ADD COLUMN IF NOT EXISTS actor text NOT NULL DEFAULT 'human';

ALTER TABLE public.quote_send_jobs
  DROP CONSTRAINT IF EXISTS quote_send_jobs_actor_check;

ALTER TABLE public.quote_send_jobs
  ADD CONSTRAINT quote_send_jobs_actor_check
  CHECK (actor IN ('human', 'automation'));

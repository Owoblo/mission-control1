-- Reliability fix: record the provider (Twilio/Resend) message SID on a
-- sequence job immediately after a successful send, while the job is still
-- 'running'. Crash recovery checks this column and skips re-sending instead
-- of double-messaging the customer.
--
-- Safe to apply any time: the processor writes this column best-effort and
-- reads it via select=*, so the send flow behaves exactly as before until
-- the migration is applied.
ALTER TABLE public.sequence_jobs
  ADD COLUMN IF NOT EXISTS provider_message_sid text;

COMMENT ON COLUMN public.sequence_jobs.provider_message_sid IS
  'Provider message SID (Twilio SID / Resend id) recorded right after a successful send; recovery skips re-send when present.';

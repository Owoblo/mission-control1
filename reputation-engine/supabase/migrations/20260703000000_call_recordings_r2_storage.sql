CREATE TABLE IF NOT EXISTS public.call_recordings (
  id TEXT PRIMARY KEY,
  recording_id TEXT,
  recording_sid TEXT UNIQUE,
  twilio_call_sid TEXT NOT NULL,
  lead_id TEXT,
  call_log_id TEXT,
  customer_id TEXT,
  job_id TEXT,
  phone_number TEXT,
  duration_seconds INTEGER,
  city TEXT,
  recording_status TEXT NOT NULL DEFAULT 'received'
    CHECK (recording_status IN ('received', 'uploaded', 'verified', 'transcribed', 'failed', 'twilio_deleted', 'unavailable')),
  recording_size BIGINT,
  content_type TEXT,
  storage_provider TEXT,
  cloudflare_object_key TEXT UNIQUE,
  cloudflare_url TEXT,
  transcript TEXT,
  summary TEXT,
  call_outcome TEXT,
  customer_intent TEXT,
  extracted_move_details JSONB,
  sentiment TEXT,
  action_items TEXT[],
  twilio_delete_after TIMESTAMPTZ,
  twilio_deleted_at TIMESTAMPTZ,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector TSVECTOR
);

CREATE INDEX IF NOT EXISTS idx_call_recordings_call_sid
  ON public.call_recordings (twilio_call_sid);

CREATE INDEX IF NOT EXISTS idx_call_recordings_lead
  ON public.call_recordings (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_call_recordings_delete_due
  ON public.call_recordings (twilio_delete_after)
  WHERE twilio_deleted_at IS NULL AND cloudflare_object_key IS NOT NULL AND recording_sid IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_call_recordings_search
  ON public.call_recordings USING GIN (search_vector);

CREATE TABLE IF NOT EXISTS public.crm_search_documents (
  id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  source_id TEXT NOT NULL,
  lead_id TEXT,
  customer_name TEXT,
  phone_number TEXT,
  address TEXT,
  city TEXT,
  body TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  search_vector TSVECTOR
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_search_documents_source
  ON public.crm_search_documents (source_type, source_id);

CREATE INDEX IF NOT EXISTS idx_crm_search_documents_lead
  ON public.crm_search_documents (lead_id);

CREATE INDEX IF NOT EXISTS idx_crm_search_documents_search
  ON public.crm_search_documents USING GIN (search_vector);

CREATE OR REPLACE FUNCTION public.update_call_recordings_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.transcript, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.summary, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.customer_intent, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.call_outcome, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(NEW.action_items, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.phone_number, '')), 'C') ||
    setweight(to_tsvector('english', coalesce(NEW.city, '')), 'C');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_call_recordings_search_vector ON public.call_recordings;
CREATE TRIGGER trg_call_recordings_search_vector
  BEFORE INSERT OR UPDATE ON public.call_recordings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_call_recordings_search_vector();

CREATE OR REPLACE FUNCTION public.update_crm_search_documents_search_vector()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.search_vector :=
    setweight(to_tsvector('english', coalesce(NEW.customer_name, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.phone_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(NEW.address, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.city, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(NEW.body, '')), 'C');
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_crm_search_documents_search_vector ON public.crm_search_documents;
CREATE TRIGGER trg_crm_search_documents_search_vector
  BEFORE INSERT OR UPDATE ON public.crm_search_documents
  FOR EACH ROW
  EXECUTE FUNCTION public.update_crm_search_documents_search_vector();

ALTER TABLE public.call_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_search_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "call_recordings_service_access" ON public.call_recordings;
CREATE POLICY "call_recordings_service_access"
  ON public.call_recordings
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "crm_search_documents_service_access" ON public.crm_search_documents;
CREATE POLICY "crm_search_documents_service_access"
  ON public.crm_search_documents
  FOR ALL
  USING (true)
  WITH CHECK (true);

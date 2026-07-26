CREATE TABLE IF NOT EXISTS public.video_survey_sessions (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  provider TEXT NOT NULL DEFAULT 'cloudflare_realtimekit',
  provider_meeting_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft', 'ready', 'waiting', 'live', 'reconnecting', 'completed',
      'recording_processing', 'analysis_pending', 'analyzing', 'review_required',
      'confirmed', 'cancelled', 'failed'
    )),
  customer_token_hash TEXT NOT NULL UNIQUE,
  customer_token_expires_at TIMESTAMPTZ NOT NULL,
  customer_participant_id TEXT,
  rep_participant_id TEXT,
  scheduled_at TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  recording_started_at TIMESTAMPTZ,
  consented_at TIMESTAMPTZ,
  consent_version TEXT,
  consent_ip_hash TEXT,
  consent_user_agent TEXT,
  recording_consent BOOLEAN NOT NULL DEFAULT FALSE,
  ai_consent BOOLEAN NOT NULL DEFAULT FALSE,
  current_room TEXT,
  last_heartbeat_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id TEXT,
  created_by_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_survey_sessions_lead
  ON public.video_survey_sessions (lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_survey_sessions_status
  ON public.video_survey_sessions (status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_survey_sessions_heartbeat
  ON public.video_survey_sessions (last_heartbeat_at)
  WHERE status IN ('waiting', 'live', 'reconnecting', 'recording_processing', 'analyzing');

CREATE TABLE IF NOT EXISTS public.video_survey_events (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.video_survey_sessions(id) ON DELETE CASCADE,
  provider_event_id TEXT,
  type TEXT NOT NULL,
  actor_type TEXT NOT NULL DEFAULT 'system'
    CHECK (actor_type IN ('customer', 'rep', 'provider', 'system', 'ai')),
  actor_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_survey_events_provider_event
  ON public.video_survey_events(provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_video_survey_events_session
  ON public.video_survey_events(session_id, occurred_at);

CREATE TABLE IF NOT EXISTS public.video_survey_markers (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.video_survey_sessions(id) ON DELETE CASCADE,
  kind TEXT NOT NULL
    CHECK (kind IN ('room', 'snapshot', 'measure', 'staying_behind', 'oversized', 'fragile', 'disassembly', 'access', 'note')),
  room TEXT,
  label TEXT,
  note TEXT,
  offset_ms BIGINT,
  snapshot_object_key TEXT,
  created_by_type TEXT NOT NULL DEFAULT 'rep'
    CHECK (created_by_type IN ('customer', 'rep', 'system', 'ai')),
  created_by_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_survey_markers_session
  ON public.video_survey_markers(session_id, offset_ms, created_at);

CREATE TABLE IF NOT EXISTS public.video_survey_recordings (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.video_survey_sessions(id) ON DELETE CASCADE,
  provider_recording_id TEXT UNIQUE,
  kind TEXT NOT NULL DEFAULT 'composite'
    CHECK (kind IN ('composite', 'customer_audio', 'rep_audio', 'raw_video', 'snapshot')),
  status TEXT NOT NULL DEFAULT 'invoked'
    CHECK (status IN ('invoked', 'recording', 'uploading', 'uploaded', 'verified', 'transcribed', 'failed', 'deleted')),
  provider_download_url TEXT,
  provider_download_expires_at TIMESTAMPTZ,
  object_key TEXT,
  storage_provider TEXT DEFAULT 'r2',
  content_type TEXT,
  size_bytes BIGINT,
  checksum TEXT,
  duration_seconds INTEGER,
  transcript TEXT,
  transcript_segments JSONB NOT NULL DEFAULT '[]'::jsonb,
  error_message TEXT,
  retention_delete_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_survey_recordings_session
  ON public.video_survey_recordings(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_video_survey_recordings_processing
  ON public.video_survey_recordings(status, updated_at)
  WHERE status IN ('invoked', 'recording', 'uploading', 'uploaded');

CREATE TABLE IF NOT EXISTS public.video_survey_analysis_jobs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.video_survey_sessions(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'review_required', 'completed', 'retry', 'failed', 'cancelled')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 5,
  locked_at TIMESTAMPTZ,
  locked_by TEXT,
  next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  stage TEXT,
  progress INTEGER NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 100),
  input JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_survey_analysis_active
  ON public.video_survey_analysis_jobs(session_id)
  WHERE status IN ('pending', 'processing', 'retry', 'review_required');
CREATE INDEX IF NOT EXISTS idx_video_survey_analysis_queue
  ON public.video_survey_analysis_jobs(status, next_attempt_at);

CREATE TABLE IF NOT EXISTS public.video_survey_inventory_evidence (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES public.video_survey_sessions(id) ON DELETE CASCADE,
  inventory_key TEXT,
  room TEXT NOT NULL DEFAULT 'Unassigned',
  item_name TEXT NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  disposition TEXT NOT NULL DEFAULT 'moving'
    CHECK (disposition IN ('moving', 'staying', 'uncertain')),
  confidence NUMERIC(5,4),
  source_kind TEXT NOT NULL
    CHECK (source_kind IN ('video', 'transcript', 'snapshot', 'mls', 'photo', 'manual')),
  recording_id TEXT REFERENCES public.video_survey_recordings(id) ON DELETE SET NULL,
  offset_ms BIGINT,
  snapshot_object_key TEXT,
  transcript_excerpt TEXT,
  estimated_cubic_feet NUMERIC,
  estimated_weight_lbs NUMERIC,
  duplicate_group_id TEXT,
  duplicate_confidence NUMERIC(5,4),
  review_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (review_status IN ('pending', 'approved', 'rejected', 'merged', 'edited')),
  reviewed_by_user_id TEXT,
  reviewed_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_video_survey_evidence_session
  ON public.video_survey_inventory_evidence(session_id, room, review_status);
CREATE INDEX IF NOT EXISTS idx_video_survey_evidence_duplicate
  ON public.video_survey_inventory_evidence(session_id, duplicate_group_id)
  WHERE duplicate_group_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.video_survey_webhook_receipts (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  provider_event_id TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'processed', 'ignored', 'failed')),
  error_message TEXT,
  received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_video_survey_webhook_dedupe
  ON public.video_survey_webhook_receipts(provider, provider_event_id);

ALTER TABLE public.video_survey_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_survey_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_survey_markers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_survey_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_survey_analysis_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_survey_inventory_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.video_survey_webhook_receipts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "video_survey_sessions_service_access" ON public.video_survey_sessions
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "video_survey_events_service_access" ON public.video_survey_events
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "video_survey_markers_service_access" ON public.video_survey_markers
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "video_survey_recordings_service_access" ON public.video_survey_recordings
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "video_survey_analysis_jobs_service_access" ON public.video_survey_analysis_jobs
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "video_survey_inventory_evidence_service_access" ON public.video_survey_inventory_evidence
  FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "video_survey_webhook_receipts_service_access" ON public.video_survey_webhook_receipts
  FOR ALL USING (true) WITH CHECK (true);


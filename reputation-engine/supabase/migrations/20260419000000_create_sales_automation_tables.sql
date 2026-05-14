-- sales automation support: conversation state + queued jobs

CREATE TABLE IF NOT EXISTS crm_conversation_threads (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('sms', 'email')),
  contact_value TEXT NOT NULL,
  contact_name TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'human_handoff', 'closed')),
  automation_status TEXT NOT NULL DEFAULT 'active' CHECK (automation_status IN ('idle', 'active', 'paused', 'handoff', 'do_not_contact')),
  automation_owner TEXT NOT NULL DEFAULT 'automation' CHECK (automation_owner IN ('automation', 'human', 'mixed')),
  last_inbound_at TIMESTAMPTZ,
  last_outbound_at TIMESTAMPTZ,
  last_human_outbound_at TIMESTAMPTZ,
  last_automation_outbound_at TIMESTAMPTZ,
  last_inbound_preview TEXT,
  last_outbound_preview TEXT,
  qualification_state JSONB NOT NULL DEFAULT '{}'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_conversation_threads_identity
  ON crm_conversation_threads (lead_id, channel, contact_value);

CREATE INDEX IF NOT EXISTS idx_crm_conversation_threads_lead
  ON crm_conversation_threads (lead_id);

CREATE INDEX IF NOT EXISTS idx_crm_conversation_threads_updated
  ON crm_conversation_threads (updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_automation_jobs (
  id TEXT PRIMARY KEY,
  lead_id TEXT NOT NULL,
  conversation_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('lead_response', 'quote_followup', 'survey_followup', 'move_reminder', 'stale_reactivation')),
  channel TEXT CHECK (channel IN ('sms', 'email')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running', 'completed', 'cancelled', 'failed')),
  due_at TIMESTAMPTZ NOT NULL,
  locked_at TIMESTAMPTZ,
  attempts INTEGER NOT NULL DEFAULT 0,
  dedupe_key TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  result JSONB NOT NULL DEFAULT '{}'::jsonb,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_crm_automation_jobs_dedupe
  ON crm_automation_jobs (dedupe_key)
  WHERE dedupe_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_automation_jobs_due
  ON crm_automation_jobs (status, due_at ASC);

CREATE INDEX IF NOT EXISTS idx_crm_automation_jobs_lead
  ON crm_automation_jobs (lead_id, created_at DESC);

ALTER TABLE crm_conversation_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE crm_automation_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "crm_conversation_threads_full_access" ON crm_conversation_threads;
CREATE POLICY "crm_conversation_threads_full_access"
  ON crm_conversation_threads
  FOR ALL
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "crm_automation_jobs_full_access" ON crm_automation_jobs;
CREATE POLICY "crm_automation_jobs_full_access"
  ON crm_automation_jobs
  FOR ALL
  USING (true)
  WITH CHECK (true);

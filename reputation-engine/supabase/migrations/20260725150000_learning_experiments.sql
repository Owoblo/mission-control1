CREATE TABLE IF NOT EXISTS public.crm_experiment_assignments (
  experiment_key TEXT NOT NULL,
  subject_type TEXT NOT NULL DEFAULT 'lead',
  subject_id TEXT NOT NULL,
  variant TEXT NOT NULL,
  assignment_version INTEGER NOT NULL DEFAULT 1,
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_exposed_at TIMESTAMPTZ,
  last_exposed_at TIMESTAMPTZ,
  exposure_count INTEGER NOT NULL DEFAULT 0,
  context JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (experiment_key, subject_type, subject_id)
);

CREATE INDEX IF NOT EXISTS idx_crm_experiment_assignments_variant
  ON public.crm_experiment_assignments (experiment_key, variant, assigned_at);

ALTER TABLE public.crm_experiment_assignments ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.crm_experiment_assignments IS
  'Stable experiment assignment and exposure ledger. Outcomes remain in analytics_events and join by lead/subject ID.';

CREATE INDEX IF NOT EXISTS idx_analytics_events_lead_type_time
  ON public.analytics_events (lead_id, event_type, ts DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_properties_gin
  ON public.analytics_events USING GIN (properties jsonb_path_ops);

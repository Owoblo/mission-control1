-- Lead visibility checks only need archive/restore lifecycle events. Keep this
-- tiny partial index separate from the general follow-up timeline indexes so
-- dashboards, notifications, and lead reads do not scan the activity history.
CREATE INDEX IF NOT EXISTS idx_crm_followup_logs_lifecycle_updated
  ON public.crm_followup_logs (updated_at DESC)
  WHERE deleted = false
    AND (data->>'notes') IN (
      '__system__:lead_archived',
      '__system__:lead_restored'
    );

CREATE INDEX IF NOT EXISTS idx_crm_emails_active_updated
  ON public.crm_emails (updated_at DESC)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_inbound_leads_created_at
  ON public.inbound_leads (created_at DESC);

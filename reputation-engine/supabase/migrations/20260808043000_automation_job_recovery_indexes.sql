create index if not exists idx_crm_automation_jobs_stale_running
  on public.crm_automation_jobs (locked_at)
  where status = 'running';

create index if not exists idx_crm_automation_jobs_retryable_failed
  on public.crm_automation_jobs (attempts, due_at)
  where status = 'failed';

alter table public.crm_automation_jobs
  drop constraint if exists crm_automation_jobs_kind_check;

alter table public.crm_automation_jobs
  add constraint crm_automation_jobs_kind_check check (kind in (
    'intelligence_refresh',
    'lead_response',
    'lost_feedback',
    'quote_followup',
    'quote_viewed_followup',
    'quote_expiry_followup',
    'survey_followup',
    'consultation_reminder',
    'move_reminder',
    'stale_reactivation'
  ));

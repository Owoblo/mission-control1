create index if not exists idx_crm_followup_logs_lifecycle_updated
  on public.crm_followup_logs (updated_at desc)
  where deleted = false
    and (data->>'notes') in ('__system__:lead_archived', '__system__:lead_restored');

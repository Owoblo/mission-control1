CREATE INDEX IF NOT EXISTS idx_sms_messages_phone_created_at
  ON public.sms_messages (from_number, to_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sms_messages_lead_created_at
  ON public.sms_messages (lead_id, created_at DESC)
  WHERE lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inbound_leads_phone_created_at
  ON public.inbound_leads (phone, created_at DESC)
  WHERE phone IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_crm_followup_logs_data_lead
  ON public.crm_followup_logs ((data->>'leadId'), updated_at DESC)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_followup_logs_data_quote
  ON public.crm_followup_logs ((data->>'quoteId'), updated_at DESC)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_quotes_data_lead_updated
  ON public.crm_quotes ((data->>'leadId'), updated_at DESC)
  WHERE deleted = false;

CREATE INDEX IF NOT EXISTS idx_crm_leads_data_inbound_updated
  ON public.crm_leads ((data->>'inboundId'), updated_at DESC)
  WHERE deleted = false;

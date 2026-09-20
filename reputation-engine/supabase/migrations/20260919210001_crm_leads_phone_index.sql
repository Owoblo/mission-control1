-- Reliability fix: expression index backing the indexed phone lookup used by
-- the Twilio webhooks (sales dialer call-status / recording-callback), which
-- previously pulled the entire crm_leads table to find one caller.
-- Phones are stored E.164-normalized in data->>'phone'.
CREATE INDEX IF NOT EXISTS idx_crm_leads_data_phone
  ON public.crm_leads ((data ->> 'phone'))
  WHERE deleted = false;

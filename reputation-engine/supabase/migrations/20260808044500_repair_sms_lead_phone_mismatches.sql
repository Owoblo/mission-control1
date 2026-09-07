-- Remove historical SMS-to-lead associations where the message participant
-- and the CRM lead have different complete North American phone numbers.
-- The inbox will subsequently resolve the correct lead by exact phone.
WITH mismatched AS (
  SELECT sm.id
  FROM public.sms_messages sm
  JOIN public.crm_leads cl ON cl.id = sm.lead_id
  CROSS JOIN LATERAL (
    SELECT regexp_replace(
      CASE WHEN sm.direction = 'inbound' THEN sm.from_number ELSE sm.to_number END,
      '[^0-9]', '', 'g'
    ) AS contact_digits,
    regexp_replace(
      COALESCE(NULLIF(cl.data->>'identityPhone', ''), cl.data->>'phone', ''),
      '[^0-9]', '', 'g'
    ) AS lead_digits
  ) phones
  WHERE length(phones.contact_digits) IN (10, 11)
    AND length(phones.lead_digits) IN (10, 11)
    AND right(phones.contact_digits, 10) <> right(phones.lead_digits, 10)
)
UPDATE public.sms_messages sm
SET lead_id = NULL
FROM mismatched
WHERE sm.id = mismatched.id;

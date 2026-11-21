-- Capture decision-grade CRM changes in the same transaction as the source row.
-- This complements analytics_events (behavioral telemetry) and human-facing notes.
CREATE TABLE IF NOT EXISTS public.crm_lifecycle_events (
  event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key TEXT UNIQUE,
  event_type TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('lead', 'quote', 'call', 'interaction', 'job_outcome', 'job_cost')),
  entity_id TEXT NOT NULL,
  lead_id TEXT,
  quote_id TEXT,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT transaction_timestamp(),
  actor_user_id TEXT,
  actor_name TEXT,
  source TEXT NOT NULL DEFAULT 'database_trigger',
  before_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  properties JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS crm_lifecycle_events_lead_time_idx
  ON public.crm_lifecycle_events (lead_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_lifecycle_events_quote_time_idx
  ON public.crm_lifecycle_events (quote_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS crm_lifecycle_events_type_time_idx
  ON public.crm_lifecycle_events (event_type, occurred_at DESC);

ALTER TABLE public.crm_lifecycle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.crm_lifecycle_events FROM anon, authenticated;
REVOKE UPDATE, DELETE, TRUNCATE ON public.crm_lifecycle_events FROM service_role;
GRANT SELECT, INSERT ON public.crm_lifecycle_events TO service_role;

CREATE OR REPLACE FUNCTION public.reject_crm_lifecycle_event_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'CRM lifecycle events are append-only; record a correction event';
END;
$$;

DROP TRIGGER IF EXISTS crm_lifecycle_events_append_only ON public.crm_lifecycle_events;
CREATE TRIGGER crm_lifecycle_events_append_only
  BEFORE UPDATE OR DELETE ON public.crm_lifecycle_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_crm_lifecycle_event_mutation();
DROP TRIGGER IF EXISTS crm_lifecycle_events_no_truncate ON public.crm_lifecycle_events;
CREATE TRIGGER crm_lifecycle_events_no_truncate
  BEFORE TRUNCATE ON public.crm_lifecycle_events
  FOR EACH STATEMENT EXECUTE FUNCTION public.reject_crm_lifecycle_event_mutation();

CREATE OR REPLACE FUNCTION public.safe_crm_attribution(value JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT jsonb_strip_nulls(jsonb_build_object(
    'source', value->'source', 'sourceDetail', value->'sourceDetail',
    'originalSource', value->'originalSource', 'normalizedSource', value->'normalizedSource',
    'partnerCode', value->'partnerCode', 'partnerSlug', value->'partnerSlug',
    'partnerName', value->'partnerName', 'partnerType', value->'partnerType',
    'partnerCompany', value->'partnerCompany', 'market', value->'market',
    'utmSource', value->'utmSource', 'utmMedium', value->'utmMedium',
    'utmCampaign', value->'utmCampaign', 'utmTerm', value->'utmTerm',
    'utmContent', value->'utmContent', 'utmId', value->'utmId',
    'gclid', value->'gclid', 'gbraid', value->'gbraid', 'wbraid', value->'wbraid',
    'fbclid', value->'fbclid', 'msclkid', value->'msclkid',
    'firstCapturedAt', value->'firstCapturedAt', 'lastCapturedAt', value->'lastCapturedAt'
  ))
$$;

CREATE OR REPLACE FUNCTION public.safe_crm_payment_records(value JSONB)
RETURNS JSONB
LANGUAGE SQL
IMMUTABLE
SET search_path = pg_catalog
AS $$
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', payment->'id', 'kind', payment->'kind', 'method', payment->'method',
    'amount', payment->'amount', 'totalBeforePayment', payment->'totalBeforePayment',
    'paidAfterPayment', payment->'paidAfterPayment', 'balanceAfterPayment', payment->'balanceAfterPayment',
    'paidAt', payment->'paidAt', 'status', payment->'status',
    'refundedAmount', payment->'refundedAmount', 'refundedAt', payment->'refundedAt'
  )) ORDER BY payment->>'paidAt'), '[]'::jsonb)
  FROM jsonb_array_elements(CASE WHEN jsonb_typeof(value) = 'array' THEN value ELSE '[]'::jsonb END) payment
$$;

CREATE OR REPLACE FUNCTION public.capture_crm_lead_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_data JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE OLD.data END;
  new_data JSONB := NEW.data;
  actor_id TEXT := COALESCE(new_data->>'lastTouchedByUserId', new_data->>'assignedRepUserId');
  actor_label TEXT := COALESCE(new_data->>'lastTouchedByName', new_data->>'assignedRepName', new_data->>'assignedRep');
  old_calls JSONB;
  new_calls JSONB;
  old_scope JSONB;
  new_scope JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, after_values)
    VALUES ('lead_created', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      jsonb_strip_nulls(jsonb_build_object(
        'source', new_data->'source', 'sourceDetail', new_data->'sourceDetail',
        'commercialDisposition', new_data->'commercialDisposition', 'stage', new_data->'stage',
        'branch', new_data->'branch', 'moveType', new_data->'moveType', 'moveDate', new_data->'moveDate',
        'originCity', new_data->'originCity', 'destCity', new_data->'destCity',
        'quoteId', new_data->'quoteId', 'quoteIds', new_data->'quoteIds', 'inboundId', new_data->'inboundId',
        'assignedRepUserId', new_data->'assignedRepUserId', 'assignedRepName', new_data->'assignedRepName',
        'attribution', public.safe_crm_attribution(new_data->'attribution')
      )));
    RETURN NEW;
  END IF;

  IF OLD.deleted IS DISTINCT FROM NEW.deleted AND NEW.deleted IS TRUE THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('lead_archived', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      jsonb_build_object('deleted', OLD.deleted), jsonb_build_object('deleted', NEW.deleted));
  END IF;

  IF old_data->'stage' IS DISTINCT FROM new_data->'stage' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('lead_stage_changed', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      jsonb_build_object('stage', old_data->'stage'), jsonb_build_object('stage', new_data->'stage'));
  END IF;
  IF old_data->'source' IS DISTINCT FROM new_data->'source' OR old_data->'sourceDetail' IS DISTINCT FROM new_data->'sourceDetail' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('lead_source_changed', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      jsonb_strip_nulls(jsonb_build_object('source', old_data->'source', 'sourceDetail', old_data->'sourceDetail')),
      jsonb_strip_nulls(jsonb_build_object('source', new_data->'source', 'sourceDetail', new_data->'sourceDetail')));
  END IF;
  IF old_data->'assignedRepUserId' IS DISTINCT FROM new_data->'assignedRepUserId'
     OR old_data->'assignedRepName' IS DISTINCT FROM new_data->'assignedRepName'
     OR old_data->'assignedRep' IS DISTINCT FROM new_data->'assignedRep' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('lead_owner_changed', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      jsonb_strip_nulls(jsonb_build_object('assignedRepUserId', old_data->'assignedRepUserId', 'assignedRepName', old_data->'assignedRepName', 'assignedRep', old_data->'assignedRep')),
      jsonb_strip_nulls(jsonb_build_object('assignedRepUserId', new_data->'assignedRepUserId', 'assignedRepName', new_data->'assignedRepName', 'assignedRep', new_data->'assignedRep')));
  END IF;
  IF old_data->'bookedAt' IS DISTINCT FROM new_data->'bookedAt'
     OR old_data->'quoteId' IS DISTINCT FROM new_data->'quoteId'
     OR old_data->'quoteIds' IS DISTINCT FROM new_data->'quoteIds' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('lead_booking_link_changed', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      jsonb_strip_nulls(jsonb_build_object('bookedAt', old_data->'bookedAt', 'quoteId', old_data->'quoteId', 'quoteIds', old_data->'quoteIds')),
      jsonb_strip_nulls(jsonb_build_object('bookedAt', new_data->'bookedAt', 'quoteId', new_data->'quoteId', 'quoteIds', new_data->'quoteIds')));
  END IF;
  IF old_data->'attribution' IS DISTINCT FROM new_data->'attribution' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('lead_attribution_changed', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      public.safe_crm_attribution(old_data->'attribution'), public.safe_crm_attribution(new_data->'attribution'));
  END IF;

  old_scope := jsonb_strip_nulls(jsonb_build_object(
    'commercialDisposition', old_data->'commercialDisposition', 'branch', old_data->'branch',
    'moveType', old_data->'moveType', 'moveDate', old_data->'moveDate', 'propertyType', old_data->'propertyType',
    'propertyBedrooms', old_data->'propertyBedrooms', 'originCity', old_data->'originCity', 'destCity', old_data->'destCity',
    'originStairFlights', old_data->'originStairFlights', 'destStairFlights', old_data->'destStairFlights',
    'originElevatorAccess', old_data->'originElevatorAccess', 'destElevatorAccess', old_data->'destElevatorAccess',
    'inventoryItemCount', CASE WHEN jsonb_typeof(old_data->'inventory') = 'array' THEN jsonb_array_length(old_data->'inventory') END,
    'totalItems', old_data->'totalItems', 'totalCubicFeet', old_data->'totalCubicFeet'
  ));
  new_scope := jsonb_strip_nulls(jsonb_build_object(
    'commercialDisposition', new_data->'commercialDisposition', 'branch', new_data->'branch',
    'moveType', new_data->'moveType', 'moveDate', new_data->'moveDate', 'propertyType', new_data->'propertyType',
    'propertyBedrooms', new_data->'propertyBedrooms', 'originCity', new_data->'originCity', 'destCity', new_data->'destCity',
    'originStairFlights', new_data->'originStairFlights', 'destStairFlights', new_data->'destStairFlights',
    'originElevatorAccess', new_data->'originElevatorAccess', 'destElevatorAccess', new_data->'destElevatorAccess',
    'inventoryItemCount', CASE WHEN jsonb_typeof(new_data->'inventory') = 'array' THEN jsonb_array_length(new_data->'inventory') END,
    'totalItems', new_data->'totalItems', 'totalCubicFeet', new_data->'totalCubicFeet'
  ));
  IF old_scope IS DISTINCT FROM new_scope THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('lead_scope_changed', 'lead', NEW.id, NEW.id, actor_id, actor_label, old_scope, new_scope);
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', item->'id', 'date', item->'date', 'direction', item->'direction', 'duration', item->'duration',
    'durationSeconds', item->'durationSeconds', 'source', item->'source', 'callOutcome', item->'callOutcome',
    'isVoicemail', item->'isVoicemail', 'answeredAt', item->'answeredAt', 'answerLatencySeconds', item->'answerLatencySeconds',
    'answeredBy', item->'answeredBy', 'repId', item->'repId', 'repName', item->'repName', 'callSid', item->'callSid'
  )) ORDER BY item->>'date'), '[]'::jsonb)
    INTO old_calls FROM jsonb_array_elements(CASE WHEN jsonb_typeof(old_data->'callLogs') = 'array' THEN old_data->'callLogs' ELSE '[]'::jsonb END) item;
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', item->'id', 'date', item->'date', 'direction', item->'direction', 'duration', item->'duration',
    'durationSeconds', item->'durationSeconds', 'source', item->'source', 'callOutcome', item->'callOutcome',
    'isVoicemail', item->'isVoicemail', 'answeredAt', item->'answeredAt', 'answerLatencySeconds', item->'answerLatencySeconds',
    'answeredBy', item->'answeredBy', 'repId', item->'repId', 'repName', item->'repName', 'callSid', item->'callSid'
  )) ORDER BY item->>'date'), '[]'::jsonb)
    INTO new_calls FROM jsonb_array_elements(CASE WHEN jsonb_typeof(new_data->'callLogs') = 'array' THEN new_data->'callLogs' ELSE '[]'::jsonb END) item;
  IF old_calls IS DISTINCT FROM new_calls THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, actor_name, before_values, after_values, properties)
    VALUES ('lead_call_history_changed', 'lead', NEW.id, NEW.id, actor_id, actor_label,
      jsonb_build_object('calls', old_calls), jsonb_build_object('calls', new_calls),
      jsonb_build_object('transcriptsAndRecordingsOmitted', true));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_crm_quote_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_data JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE OLD.data END;
  new_data JSONB := NEW.data;
  lead_key TEXT := COALESCE(new_data->>'leadId', old_data->>'leadId');
  quote_key TEXT := NEW.id;
  actor_id TEXT := new_data->>'lastTouchedByUserId';
  actor_label TEXT := COALESCE(new_data->>'lastTouchedByName', new_data->>'lastTouchedBy', 'System');
  before_financials JSONB;
  after_financials JSONB;
  before_terms JSONB;
  after_terms JSONB;
  before_payments JSONB;
  after_payments JSONB;
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id, actor_name, after_values)
    VALUES ('quote_created', 'quote', quote_key, lead_key, quote_key, actor_id, actor_label,
      jsonb_strip_nulls(jsonb_build_object('number', new_data->'number', 'status', new_data->'status', 'revision', new_data->'revision', 'createdAt', new_data->'createdAt', 'moveDate', new_data->'moveDate')));
    RETURN NEW;
  END IF;
  IF OLD.deleted IS DISTINCT FROM NEW.deleted AND NEW.deleted IS TRUE THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('quote_archived', 'quote', quote_key, lead_key, quote_key, actor_id, actor_label,
      jsonb_build_object('deleted', OLD.deleted), jsonb_build_object('deleted', NEW.deleted));
  END IF;
  IF old_data->'status' IS DISTINCT FROM new_data->'status'
     OR old_data->'acceptedAt' IS DISTINCT FROM new_data->'acceptedAt'
     OR old_data->'sentAt' IS DISTINCT FROM new_data->'sentAt' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('quote_status_changed', 'quote', quote_key, lead_key, quote_key, actor_id, actor_label,
      jsonb_strip_nulls(jsonb_build_object('status', old_data->'status', 'sentAt', old_data->'sentAt', 'acceptedAt', old_data->'acceptedAt')),
      jsonb_strip_nulls(jsonb_build_object('status', new_data->'status', 'sentAt', new_data->'sentAt', 'acceptedAt', new_data->'acceptedAt')));
  END IF;
  before_financials := jsonb_strip_nulls(jsonb_build_object('subtotal', old_data->'subtotal', 'hst', old_data->'hst', 'total', old_data->'total', 'deposit', old_data->'deposit', 'balance', old_data->'balance', 'discountAmount', old_data->'discountAmount'));
  after_financials := jsonb_strip_nulls(jsonb_build_object('subtotal', new_data->'subtotal', 'hst', new_data->'hst', 'total', new_data->'total', 'deposit', new_data->'deposit', 'balance', new_data->'balance', 'discountAmount', new_data->'discountAmount'));
  IF before_financials IS DISTINCT FROM after_financials THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('quote_amounts_changed', 'quote', quote_key, lead_key, quote_key, actor_id, actor_label, before_financials, after_financials);
  END IF;
  before_terms := jsonb_strip_nulls(jsonb_build_object('moveDate', old_data->'moveDate', 'moveType', old_data->'moveType', 'quoteType', old_data->'quoteType', 'crewSize', old_data->'crewSize', 'estimatedHours', old_data->'estimatedHours', 'truckCount', old_data->'truckCount', 'revision', old_data->'revision'));
  after_terms := jsonb_strip_nulls(jsonb_build_object('moveDate', new_data->'moveDate', 'moveType', new_data->'moveType', 'quoteType', new_data->'quoteType', 'crewSize', new_data->'crewSize', 'estimatedHours', new_data->'estimatedHours', 'truckCount', new_data->'truckCount', 'revision', new_data->'revision'));
  IF before_terms IS DISTINCT FROM after_terms THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id, actor_name, before_values, after_values)
    VALUES ('quote_terms_changed', 'quote', quote_key, lead_key, quote_key, actor_id, actor_label, before_terms, after_terms);
  END IF;
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', payment->'id', 'kind', payment->'kind', 'method', payment->'method', 'amount', payment->'amount',
    'totalBeforePayment', payment->'totalBeforePayment', 'paidAfterPayment', payment->'paidAfterPayment',
    'balanceAfterPayment', payment->'balanceAfterPayment', 'paidAt', payment->'paidAt',
    'status', payment->'status', 'refundedAmount', payment->'refundedAmount', 'refundedAt', payment->'refundedAt'
  )) ORDER BY payment->>'paidAt'), '[]'::jsonb)
    INTO before_payments FROM jsonb_array_elements(CASE WHEN jsonb_typeof(old_data->'paymentRecords') = 'array' THEN old_data->'paymentRecords' ELSE '[]'::jsonb END) payment;
  SELECT COALESCE(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'id', payment->'id', 'kind', payment->'kind', 'method', payment->'method', 'amount', payment->'amount',
    'totalBeforePayment', payment->'totalBeforePayment', 'paidAfterPayment', payment->'paidAfterPayment',
    'balanceAfterPayment', payment->'balanceAfterPayment', 'paidAt', payment->'paidAt',
    'status', payment->'status', 'refundedAmount', payment->'refundedAmount', 'refundedAt', payment->'refundedAt'
  )) ORDER BY payment->>'paidAt'), '[]'::jsonb)
    INTO after_payments FROM jsonb_array_elements(CASE WHEN jsonb_typeof(new_data->'paymentRecords') = 'array' THEN new_data->'paymentRecords' ELSE '[]'::jsonb END) payment;
  IF before_payments IS DISTINCT FROM after_payments
     OR old_data->'depositPaidAt' IS DISTINCT FROM new_data->'depositPaidAt'
     OR old_data->'balancePaidAt' IS DISTINCT FROM new_data->'balancePaidAt'
     OR old_data->'depositPaidAmount' IS DISTINCT FROM new_data->'depositPaidAmount'
     OR old_data->'balancePaidAmount' IS DISTINCT FROM new_data->'balancePaidAmount' THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id, actor_name, before_values, after_values, properties)
    VALUES ('quote_payment_state_changed', 'quote', quote_key, lead_key, quote_key, actor_id, actor_label,
      jsonb_strip_nulls(jsonb_build_object('payments', before_payments, 'depositPaidAt', old_data->'depositPaidAt', 'depositPaidAmount', old_data->'depositPaidAmount', 'balancePaidAt', old_data->'balancePaidAt', 'balancePaidAmount', old_data->'balancePaidAmount')),
      jsonb_strip_nulls(jsonb_build_object('payments', after_payments, 'depositPaidAt', new_data->'depositPaidAt', 'depositPaidAmount', new_data->'depositPaidAmount', 'balancePaidAt', new_data->'balancePaidAt', 'balancePaidAmount', new_data->'balancePaidAmount')),
      jsonb_build_object('sensitivePaymentDetailsOmitted', true));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_crm_job_outcome_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_row JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  new_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  current_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  outcome_id TEXT := current_row->>'id';
  lead_key TEXT := current_row->>'lead_id';
  quote_key TEXT := current_row->>'quote_id';
  actor_id TEXT := current_row->>'rep_id';
  before_values JSONB;
  after_values JSONB;
BEGIN
  before_values := jsonb_strip_nulls(jsonb_build_object(
    'moveDate', old_row->'move_date', 'estimatedHours', old_row->'estimated_hours', 'actualHours', old_row->'actual_hours',
    'actualCrew', old_row->'actual_crew', 'revenueCents', old_row->'revenue_cents', 'totalCostsCents', old_row->'total_costs_cents',
    'netProfitCents', old_row->'net_profit_cents', 'marginPct', old_row->'margin_pct', 'damageFlag', old_row->'damage_flag',
    'customerRating', old_row->'customer_rating', 'reviewLeft', old_row->'review_left', 'referralGenerated', old_row->'referral_generated'
  ));
  after_values := jsonb_strip_nulls(jsonb_build_object(
    'moveDate', new_row->'move_date', 'estimatedHours', new_row->'estimated_hours', 'actualHours', new_row->'actual_hours',
    'actualCrew', new_row->'actual_crew', 'revenueCents', new_row->'revenue_cents', 'totalCostsCents', new_row->'total_costs_cents',
    'netProfitCents', new_row->'net_profit_cents', 'marginPct', new_row->'margin_pct', 'damageFlag', new_row->'damage_flag',
    'customerRating', new_row->'customer_rating', 'reviewLeft', new_row->'review_left', 'referralGenerated', new_row->'referral_generated'
  ));
  IF TG_OP = 'INSERT' OR TG_OP = 'DELETE' OR before_values IS DISTINCT FROM after_values THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id, before_values, after_values, properties)
    VALUES (CASE TG_OP WHEN 'INSERT' THEN 'job_outcome_recorded' WHEN 'DELETE' THEN 'job_outcome_deleted' ELSE 'job_outcome_revised' END,
      'job_outcome', outcome_id, lead_key, quote_key, NULL, before_values, after_values,
      jsonb_strip_nulls(jsonb_build_object('assignedRepId', actor_id)));
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_crm_job_cost_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_row JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE to_jsonb(OLD) END;
  new_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE to_jsonb(NEW) END;
  current_row JSONB := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;
  before_values JSONB;
  after_values JSONB;
BEGIN
  before_values := jsonb_strip_nulls(jsonb_build_object('category', old_row->'category', 'amountCents', old_row->'amount_cents', 'costDate', old_row->'cost_date'));
  after_values := jsonb_strip_nulls(jsonb_build_object('category', new_row->'category', 'amountCents', new_row->'amount_cents', 'costDate', new_row->'cost_date'));
  IF TG_OP = 'INSERT' OR TG_OP = 'DELETE' OR before_values IS DISTINCT FROM after_values THEN
    INSERT INTO public.crm_lifecycle_events(event_type, entity_type, entity_id, lead_id, actor_user_id, before_values, after_values)
    VALUES (CASE TG_OP WHEN 'INSERT' THEN 'job_cost_recorded' WHEN 'DELETE' THEN 'job_cost_deleted' ELSE 'job_cost_revised' END,
      'job_cost', current_row->>'id', NULLIF(current_row->>'lead_id', 'overhead'),
      CASE WHEN TG_OP = 'INSERT' THEN current_row->>'created_by' END, before_values, after_values);
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.capture_crm_followup_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  old_data JSONB := CASE WHEN TG_OP = 'INSERT' THEN '{}'::jsonb ELSE OLD.data END;
  new_data JSONB := CASE WHEN TG_OP = 'DELETE' THEN '{}'::jsonb ELSE NEW.data END;
  current_data JSONB := CASE WHEN TG_OP = 'DELETE' THEN OLD.data ELSE NEW.data END;
  lead_key TEXT := current_data->>'leadId';
  quote_key TEXT := current_data->>'quoteId';
  safe_before JSONB;
  safe_after JSONB;
BEGIN
  safe_before := jsonb_strip_nulls(jsonb_build_object(
    'type', old_data->'type', 'date', old_data->'date', 'createdAt', old_data->'createdAt',
    'hasNotes', CASE WHEN old_data ? 'notes' THEN to_jsonb(true) END,
    'noteLength', CASE WHEN jsonb_typeof(old_data->'notes') = 'string' THEN to_jsonb(length(old_data->>'notes')) END
  ));
  safe_after := jsonb_strip_nulls(jsonb_build_object(
    'type', new_data->'type', 'date', new_data->'date', 'createdAt', new_data->'createdAt',
    'hasNotes', CASE WHEN new_data ? 'notes' THEN to_jsonb(true) END,
    'noteLength', CASE WHEN jsonb_typeof(new_data->'notes') = 'string' THEN to_jsonb(length(new_data->>'notes')) END
  ));

  IF TG_OP = 'INSERT' OR TG_OP = 'DELETE'
     OR safe_before IS DISTINCT FROM safe_after
     OR old_data->'notes' IS DISTINCT FROM new_data->'notes'
     OR old_data->'aiSummary' IS DISTINCT FROM new_data->'aiSummary' THEN
    INSERT INTO public.crm_lifecycle_events(
      event_type, entity_type, entity_id, lead_id, quote_id, actor_user_id,
      occurred_at, source, before_values, after_values, properties
    ) VALUES (
      CASE TG_OP WHEN 'INSERT' THEN 'followup_recorded' WHEN 'DELETE' THEN 'followup_deleted' ELSE 'followup_revised' END,
      'interaction', COALESCE(current_data->>'id', CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END),
      lead_key, quote_key,
      COALESCE(current_data->>'actorUserId', current_data->>'repId'),
      COALESCE(NULLIF(current_data->>'date', '')::timestamptz, NULLIF(current_data->>'createdAt', '')::timestamptz, transaction_timestamp()),
      'database_trigger', safe_before, safe_after,
      jsonb_build_object(
        'messageTextAndAiSummaryOmitted', true,
        'privateNoteChanged', old_data->'notes' IS DISTINCT FROM new_data->'notes',
        'aiSummaryChanged', old_data->'aiSummary' IS DISTINCT FROM new_data->'aiSummary'
      )
    );
  END IF;
  RETURN NULL;
END;
$$;

-- Calls, messages, quote engagement, and follow-up telemetry are written to
-- analytics_events. Copy only allowlisted operational fields: never message
-- bodies, transcripts, recording URLs, caller numbers, or free-text summaries.
CREATE OR REPLACE FUNCTION public.capture_crm_analytics_lifecycle_event()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  safe_values JSONB;
BEGIN
  IF NEW.event_type NOT IN (
    'telephony_call_leg_event', 'call_completed', 'voicemail_left',
    'sms_sent', 'sms_received', 'email_sent', 'note_added', 'follow_up_scheduled',
    'consultation_completed', 'quote_viewed', 'quote_section_viewed',
    'quote_section_interaction', 'estimate_opened'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.event_type IN ('telephony_call_leg_event', 'call_completed', 'voicemail_left') THEN
    safe_values := jsonb_strip_nulls(jsonb_build_object(
      'direction', COALESCE(NEW.properties->>'direction', NEW.properties->>'call_direction'),
      'workspace', NEW.properties->>'workspace',
      'callEvent', NEW.properties->>'event',
      'callStatus', NEW.properties->>'callStatus',
      'callDurationSeconds', COALESCE(NEW.properties->'callDurationSeconds', NEW.properties->'call_duration_seconds'),
      'answerLatencySeconds', NEW.properties->'answerTimeSeconds',
      'answerTimeMethod', NEW.properties->>'answerTimeMethod',
      'isVoicemail', COALESCE(NEW.properties->'is_voicemail', NEW.properties->'isVoicemail'),
      'callSid', COALESCE(NEW.properties->>'childCallSid', NEW.properties->>'call_sid'),
      'providerEventId', NEW.id,
      'startedAt', NEW.properties->>'startedAt',
      'occurredAt', NEW.ts
    ));
  ELSE
    safe_values := jsonb_strip_nulls(jsonb_build_object(
      'channel', NEW.properties->'channel', 'messageDirection', NEW.properties->'message_direction',
      'messageLength', NEW.properties->'message_length', 'threadLength', NEW.properties->'thread_length',
      'hasAiSummary', NEW.properties->'has_ai_summary', 'quoteId', NEW.properties->'quote_id',
      'quoteTotal', NEW.properties->'quote_total', 'quoteDeposit', NEW.properties->'quote_deposit',
      'crewSize', NEW.properties->'crew_size', 'estimatedHours', NEW.properties->'estimated_hours',
      'truckCount', NEW.properties->'truck_count', 'discountAmount', NEW.properties->'discount_amount',
      'discountPct', NEW.properties->'discount_pct', 'inventoryItemCount', NEW.properties->'inventory_item_count',
      'totalCubicFeet', NEW.properties->'total_cubic_feet', 'moveType', NEW.properties->'move_type',
      'leadStage', NEW.properties->'lead_stage', 'moveDate', NEW.properties->'move_date',
      'followUpDate', NEW.properties->'follow_up_date',
      'section', COALESCE(NEW.properties->'section', NEW.properties->'quote_section'),
      'interactionType', COALESCE(NEW.properties->'interaction_type', NEW.properties->'quote_interaction'),
      'elapsedMs', NEW.properties->'elapsed_ms', 'occurredAt', NEW.ts
    ));
  END IF;

  INSERT INTO public.crm_lifecycle_events(
    event_key, event_type, entity_type, entity_id, lead_id, actor_user_id,
    actor_name, occurred_at, source, after_values,
    properties
  ) VALUES (
    'analytics:' || NEW.id,
    NEW.event_type,
    CASE WHEN NEW.event_type IN ('telephony_call_leg_event', 'call_completed', 'voicemail_left') THEN 'call' ELSE 'interaction' END,
    NEW.id,
    NEW.lead_id,
    NEW.rep_id,
    COALESCE(NEW.properties->>'repName', NEW.properties->>'actor_name'),
    COALESCE(NEW.ts, NEW.created_at, transaction_timestamp()),
    'analytics_event_trigger',
    safe_values,
    jsonb_build_object('sourceEventType', NEW.event_type, 'freeTextAndSensitivePayloadOmitted', true)
  ) ON CONFLICT (event_key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS crm_leads_lifecycle_capture ON public.crm_leads;
CREATE TRIGGER crm_leads_lifecycle_capture
  AFTER INSERT OR UPDATE OF data, deleted ON public.crm_leads
  FOR EACH ROW EXECUTE FUNCTION public.capture_crm_lead_lifecycle_event();
DROP TRIGGER IF EXISTS crm_quotes_lifecycle_capture ON public.crm_quotes;
CREATE TRIGGER crm_quotes_lifecycle_capture
  AFTER INSERT OR UPDATE OF data, deleted ON public.crm_quotes
  FOR EACH ROW EXECUTE FUNCTION public.capture_crm_quote_lifecycle_event();
DROP TRIGGER IF EXISTS job_outcomes_lifecycle_capture ON public.job_outcomes;
CREATE TRIGGER job_outcomes_lifecycle_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.job_outcomes
  FOR EACH ROW EXECUTE FUNCTION public.capture_crm_job_outcome_lifecycle_event();
DROP TRIGGER IF EXISTS job_costs_lifecycle_capture ON public.job_costs;
CREATE TRIGGER job_costs_lifecycle_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.job_costs
  FOR EACH ROW EXECUTE FUNCTION public.capture_crm_job_cost_lifecycle_event();
DROP TRIGGER IF EXISTS crm_followup_logs_lifecycle_capture ON public.crm_followup_logs;
CREATE TRIGGER crm_followup_logs_lifecycle_capture
  AFTER INSERT OR UPDATE OR DELETE ON public.crm_followup_logs
  FOR EACH ROW EXECUTE FUNCTION public.capture_crm_followup_lifecycle_event();
DROP TRIGGER IF EXISTS analytics_events_call_lifecycle_capture ON public.analytics_events;
DROP TRIGGER IF EXISTS analytics_events_lifecycle_capture ON public.analytics_events;
CREATE TRIGGER analytics_events_lifecycle_capture
  AFTER INSERT ON public.analytics_events
  FOR EACH ROW EXECUTE FUNCTION public.capture_crm_analytics_lifecycle_event();

-- Establish an explicitly labeled point-in-time baseline. These rows are not
-- represented as reconstructed historical transitions.
INSERT INTO public.crm_lifecycle_events(event_key, event_type, entity_type, entity_id, lead_id, source, after_values)
SELECT 'baseline:lead:' || id, 'lead_baseline', 'lead', id, id, 'migration_baseline',
  jsonb_strip_nulls(jsonb_build_object(
    'source', data->'source', 'sourceDetail', data->'sourceDetail', 'commercialDisposition', data->'commercialDisposition',
    'stage', data->'stage', 'branch', data->'branch', 'moveType', data->'moveType', 'moveDate', data->'moveDate',
    'originCity', data->'originCity', 'destCity', data->'destCity', 'quoteId', data->'quoteId', 'quoteIds', data->'quoteIds',
    'assignedRepUserId', data->'assignedRepUserId', 'assignedRepName', data->'assignedRepName',
    'attribution', public.safe_crm_attribution(data->'attribution'), 'createdAt', data->'createdAt', 'bookedAt', data->'bookedAt', 'lostAt', data->'lostAt'
  ))
FROM public.crm_leads
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.crm_lifecycle_events(event_key, event_type, entity_type, entity_id, lead_id, quote_id, source, after_values)
SELECT 'baseline:quote:' || id, 'quote_baseline', 'quote', id, data->>'leadId', id, 'migration_baseline',
  jsonb_strip_nulls(jsonb_build_object(
    'number', data->'number', 'status', data->'status', 'revision', data->'revision', 'moveDate', data->'moveDate',
    'subtotal', data->'subtotal', 'hst', data->'hst', 'total', data->'total', 'deposit', data->'deposit', 'balance', data->'balance',
    'sentAt', data->'sentAt', 'acceptedAt', data->'acceptedAt',
    'depositPaidAt', data->'depositPaidAt', 'depositPaidAmount', data->'depositPaidAmount',
    'balancePaidAt', data->'balancePaidAt', 'balancePaidAmount', data->'balancePaidAmount',
    'paymentRecords', public.safe_crm_payment_records(data->'paymentRecords')
  ))
FROM public.crm_quotes
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.crm_lifecycle_events(event_key, event_type, entity_type, entity_id, lead_id, quote_id, source, after_values)
SELECT 'baseline:job_outcome:' || id, 'job_outcome_baseline', 'job_outcome', id, lead_id, quote_id, 'migration_baseline',
  jsonb_strip_nulls(jsonb_build_object(
    'moveDate', move_date, 'estimatedHours', estimated_hours, 'actualHours', actual_hours, 'actualCrew', actual_crew,
    'revenueCents', revenue_cents, 'totalCostsCents', total_costs_cents, 'netProfitCents', net_profit_cents, 'marginPct', margin_pct,
    'damageFlag', damage_flag, 'customerRating', customer_rating, 'reviewLeft', review_left, 'referralGenerated', referral_generated
  ))
FROM public.job_outcomes
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.crm_lifecycle_events(event_key, event_type, entity_type, entity_id, lead_id, source, after_values)
SELECT 'baseline:job_cost:' || id, 'job_cost_baseline', 'job_cost', id, NULLIF(lead_id, 'overhead'), 'migration_baseline',
  jsonb_strip_nulls(jsonb_build_object('category', category, 'amountCents', amount_cents, 'costDate', cost_date))
FROM public.job_costs
ON CONFLICT (event_key) DO NOTHING;

INSERT INTO public.crm_lifecycle_events(event_key, event_type, entity_type, entity_id, lead_id, quote_id, occurred_at, source, after_values, properties)
SELECT 'baseline:followup:' || id, 'followup_baseline', 'interaction', COALESCE(data->>'id', id), data->>'leadId', data->>'quoteId',
  COALESCE(NULLIF(data->>'date', '')::timestamptz, NULLIF(data->>'createdAt', '')::timestamptz, transaction_timestamp()),
  'migration_baseline',
  jsonb_strip_nulls(jsonb_build_object(
    'type', data->'type', 'date', data->'date', 'createdAt', data->'createdAt',
    'hasNotes', CASE WHEN data ? 'notes' THEN to_jsonb(true) END,
    'noteLength', CASE WHEN jsonb_typeof(data->'notes') = 'string' THEN to_jsonb(length(data->>'notes')) END
  )),
  jsonb_build_object('messageTextAndAiSummaryOmitted', true)
FROM public.crm_followup_logs
WHERE COALESCE(deleted, false) = false
ON CONFLICT (event_key) DO NOTHING;

COMMENT ON TABLE public.crm_lifecycle_events IS
  'Transactional append-only lifecycle changes from CRM lead and quote source rows. Call recordings, transcripts, addresses, and card data are deliberately excluded.';

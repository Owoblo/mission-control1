-- Keep the existing task store and activity ledger. Commit owned work and its
-- explanation together; expose this command only to the authenticated server.
CREATE OR REPLACE FUNCTION public.guard_next_step_history()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
BEGIN
  IF OLD.action LIKE 'next_step.%' THEN
    -- Preserve the existing ON DELETE SET NULL contact lifecycle. The original
    -- contact/request identity remains in immutable event metadata.
    IF TG_OP = 'UPDATE' AND OLD.contact_id IS NOT NULL AND NEW.contact_id IS NULL
      AND (to_jsonb(NEW) - 'contact_id') IS NOT DISTINCT FROM (to_jsonb(OLD) - 'contact_id') THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Next-step history is append-only; insert a correction';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS next_step_history_immutable ON public.partner_activity_logs;
CREATE TRIGGER next_step_history_immutable
  BEFORE UPDATE OR DELETE ON public.partner_activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.guard_next_step_history();

CREATE OR REPLACE FUNCTION public.record_relationship_next_step(
  p_contact_id UUID, p_event JSONB, p_task JSONB DEFAULT NULL,
  p_task_mode TEXT DEFAULT 'none', p_expected_task_updated_at TIMESTAMPTZ DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE
  prior public.partner_activity_logs%ROWTYPE;
  written_task_id TEXT;
BEGIN
  IF p_event->>'action' NOT IN ('next_step.shown', 'next_step.review_opened', 'next_step.create_task', 'next_step.defer', 'next_step.corrected', 'next_step.receipt_linked')
    OR p_event->>'action' IS NULL OR NULLIF(p_event->'metadata'->>'insight_key', '') IS NULL
    OR NULLIF(p_event->'metadata'->>'evidence_version', '') IS NULL
    OR p_event->'metadata'->>'original_contact_id' IS DISTINCT FROM p_contact_id::TEXT
    OR p_task_mode NOT IN ('none', 'create', 'defer') OR p_task_mode IS NULL THEN
    RAISE EXCEPTION 'Invalid next-step command' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(p_contact_id::TEXT, 0));
  SELECT * INTO prior FROM public.partner_activity_logs WHERE id = (p_event->>'id')::UUID;
  IF FOUND THEN
    IF prior.contact_id IS DISTINCT FROM p_contact_id OR prior.action IS DISTINCT FROM p_event->>'action'
      OR prior.actor_user_id IS DISTINCT FROM p_event->>'actor_user_id'
      OR prior.metadata IS DISTINCT FROM p_event->'metadata' THEN
      RAISE EXCEPTION 'Conflicting next-step event identity' USING ERRCODE = '22023';
    END IF;
    RETURN jsonb_build_object('ok', true, 'replayed', true, 'task_id', prior.metadata->>'task_id');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.market_contacts WHERE id = p_contact_id) THEN
    RAISE EXCEPTION 'Contact no longer exists' USING ERRCODE = '40001';
  END IF;
  IF p_task_mode <> 'none' THEN
    IF p_task IS NULL OR p_task->>'source_key' IS DISTINCT FROM p_event->'metadata'->>'insight_key'
      OR p_task->>'id' IS DISTINCT FROM p_event->'metadata'->>'task_id' THEN
      RAISE EXCEPTION 'Task must match the recorded request' USING ERRCODE = '22023';
    END IF;
    IF EXISTS (SELECT 1 FROM public.market_contacts WHERE id = p_contact_id
      AND (do_not_contact OR cross_channel_suppressed_at IS NOT NULL OR stage IN ('dnc','opted_out','wrong_number','do_not_contact'))) THEN
      RAISE EXCEPTION 'Contact restrictions changed; refresh the record' USING ERRCODE = '40001';
    END IF;
    IF p_event->>'action' = 'next_step.defer' AND (p_task->>'due_at' IS NULL OR (p_task->>'due_at')::TIMESTAMPTZ <= clock_timestamp()) THEN
      RAISE EXCEPTION 'A future internal review is required' USING ERRCODE = '22023';
    END IF;
    IF p_task_mode = 'create' THEN
      IF p_event->>'action' NOT IN ('next_step.create_task', 'next_step.defer') THEN
        RAISE EXCEPTION 'Task command does not match event' USING ERRCODE = '22023';
      END IF;
      INSERT INTO public.crm_tasks (id, source_key, source, title, description, status, priority, category,
        owner_name, owner_user_id, branch, related_type, related_id, related_label, due_at, created_by_name, created_by_user_id)
      VALUES (p_task->>'id', p_task->>'source_key', 'condition', p_task->>'title', p_task->>'description', 'open', 'normal', 'relationship_development',
        p_task->>'owner_name', p_task->>'owner_user_id', p_task->>'branch', 'relationship', p_contact_id::TEXT,
        p_task->>'related_label', (p_task->>'due_at')::TIMESTAMPTZ, p_task->>'created_by_name', p_task->>'created_by_user_id')
      ON CONFLICT (source_key) DO NOTHING RETURNING id INTO written_task_id;
      IF written_task_id IS NULL THEN
        RAISE EXCEPTION 'A task already exists; refresh its owner and date' USING ERRCODE = '40001';
      END IF;
    ELSE
      IF p_event->>'action' <> 'next_step.defer' OR p_expected_task_updated_at IS NULL
        OR (p_task->>'due_at')::TIMESTAMPTZ <= clock_timestamp() OR p_task->>'due_at' IS NULL THEN
        RAISE EXCEPTION 'A future review and current task version are required' USING ERRCODE = '22023';
      END IF;
      UPDATE public.crm_tasks SET due_at = (p_task->>'due_at')::TIMESTAMPTZ,
        updated_at = greatest(clock_timestamp(), updated_at + interval '1 microsecond')
      WHERE id = p_task->>'id' AND source_key = p_task->>'source_key' AND related_id = p_contact_id::TEXT
        AND related_type IN ('partner','relationship') AND status IN ('open','in_progress')
        AND updated_at = p_expected_task_updated_at RETURNING id INTO written_task_id;
      IF written_task_id IS NULL THEN RAISE EXCEPTION 'Task changed; refresh before rescheduling' USING ERRCODE = '40001'; END IF;
    END IF;
  END IF;
  INSERT INTO public.partner_activity_logs (id, contact_id, action, actor_user_id, actor_name, metadata)
  VALUES ((p_event->>'id')::UUID, p_contact_id, p_event->>'action', p_event->>'actor_user_id', p_event->>'actor_name', p_event->'metadata');
  RETURN jsonb_build_object('ok', true, 'replayed', false, 'task_id', coalesce(written_task_id, p_event->'metadata'->>'task_id'));
END;
$$;
REVOKE ALL ON FUNCTION public.record_relationship_next_step(UUID,JSONB,JSONB,TEXT,TIMESTAMPTZ) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.record_relationship_next_step(UUID,JSONB,JSONB,TEXT,TIMESTAMPTZ) TO service_role;

-- Normal work in the existing Tasks screen must retain outcomes too. Closing,
-- reopening or correcting one of these tasks appends evidence in that same
-- transaction; a human completion never manufactures provider delivery.
CREATE OR REPLACE FUNCTION public.capture_next_step_task_outcome()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = pg_catalog, public AS $$
DECLARE linked_contact UUID;
BEGIN
  IF OLD.source_key LIKE 'relationship-material:%'
    AND (OLD.status, OLD.completed_at, OLD.outcome_note) IS DISTINCT FROM (NEW.status, NEW.completed_at, NEW.outcome_note) THEN
    IF NEW.related_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT id INTO linked_contact FROM public.market_contacts WHERE id = NEW.related_id::UUID;
    END IF;
    INSERT INTO public.partner_activity_logs(id,contact_id,action,actor_user_id,actor_name,metadata)
    VALUES (gen_random_uuid(), linked_contact, 'next_step.task_outcome_recorded',
      CASE WHEN NEW.status IN ('completed','cancelled') THEN NEW.completed_by_user_id ELSE NULL END,
      CASE WHEN NEW.status IN ('completed','cancelled') THEN NEW.completed_by_name ELSE NULL END,
      jsonb_build_object('original_contact_id', NEW.related_id, 'insight_key', OLD.source_key, 'task_id', NEW.id,
        'previous_status', OLD.status, 'status', NEW.status, 'previous_outcome', OLD.outcome_note,
        'outcome', NEW.outcome_note, 'completed_at', NEW.completed_at, 'emitter', 'crm_task_trigger',
        'schema_version', 1, 'outbound_sent', false, 'delivery_verified', false));
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS next_step_task_outcome ON public.crm_tasks;
CREATE TRIGGER next_step_task_outcome AFTER UPDATE ON public.crm_tasks
  FOR EACH ROW EXECUTE FUNCTION public.capture_next_step_task_outcome();

NOTIFY pgrst, 'reload schema';

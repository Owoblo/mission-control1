-- Keep a handoff awaiting provider reconciliation in the same recipient lane.
do $migration$
declare
  definition text;
  enqueue_signature constant text := 'public.enqueue_prepared_sms(text,text,jsonb,integer)';
  reserve_signature constant text := 'public.reserve_partnership_action(uuid,text,text,text,jsonb)';
  active_statuses constant text := '(''pending'',''running'',''processing'')';
  held_statuses constant text := '(''pending'',''running'',''processing'',''queued_manual'')';
  suppressed constant text := '(''opted_out'',''rejected'')';
  suppressed_with_bad_number constant text := '(''opted_out'',''rejected'',''bad_number'')';
  signature text;
begin
  foreach signature in array array[enqueue_signature, reserve_signature] loop
    definition := pg_get_functiondef(signature::regprocedure);
    if (position(active_statuses in definition)=0 and position(held_statuses in definition)=0)
      or (position(suppressed in definition)=0 and position(suppressed_with_bad_number in definition)=0)
    then
      raise exception 'Unexpected prepared SMS policy for %', signature;
    end if;
    execute replace(replace(definition, active_statuses, held_statuses), suppressed, suppressed_with_bad_number);
  end loop;
end $migration$;

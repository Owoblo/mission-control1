-- Persist the processor before a new Stripe session or invoice can be issued.
create or replace function public.bind_crm_quote_stripe_account(
  p_quote_id text,
  p_lead_id text,
  p_account text,
  p_expected_revision integer
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  quote_data jsonb;
  account_key text;
  quote_revision integer;
begin
  if p_account is null or p_account not in ('saturn', 'dexa') then
    raise exception 'Invalid Stripe account';
  end if;

  select data into quote_data from public.crm_quotes
    where id = p_quote_id and not deleted for update;
  if quote_data is null or quote_data->>'leadId' is distinct from p_lead_id then
    raise exception 'Quote ownership mismatch';
  end if;

  quote_revision := coalesce((quote_data->>'revision')::integer, 0);
  if quote_revision is distinct from p_expected_revision then
    raise exception 'Quote changed; refresh before starting payment';
  end if;
  if quote_data->>'stripeAccountKey' in ('saturn', 'dexa') then
    return quote_data;
  end if;

  -- Older deployments could reserve an operation before writing an account to the quote.
  select provider_account into account_key from public.crm_checkout_operations
    where quote_id = p_quote_id and lead_id = p_lead_id and state in ('reserved', 'open', 'unknown');
  if account_key is null then
    select provider_account into account_key from public.crm_financial_commands
      where quote_id = p_quote_id and lead_id = p_lead_id and state not in ('complete', 'failed');
  end if;
  if account_key is null then
    select provider_account into account_key from public.crm_payment_operations
      where quote_id = p_quote_id and lead_id = p_lead_id and state not in ('complete', 'failed')
      order by created_at desc limit 1;
  end if;
  account_key := coalesce(account_key, p_account);
  if account_key not in ('saturn', 'dexa') then
    raise exception 'Invalid existing Stripe account';
  end if;

  quote_data := quote_data || jsonb_build_object('stripeAccountKey', account_key, 'revision', quote_revision + 1);
  update public.crm_quotes set data = quote_data, updated_at = now() where id = p_quote_id;
  return quote_data;
end;
$$;

revoke all on function public.bind_crm_quote_stripe_account(text, text, text, integer) from public, anon, authenticated;
grant execute on function public.bind_crm_quote_stripe_account(text, text, text, integer) to service_role;

alter table if exists public.market_contacts
  drop constraint if exists market_contacts_stage_check;

alter table if exists public.market_contacts
  add constraint market_contacts_stage_check
  check (
    stage in (
      'cold',
      'contacted',
      'engaged',
      'qualified',
      'partnered',
      'referring',
      'revisit',
      'dnc',
      'target',
      'mail_sent',
      'follow_up_due',
      'attempting_contact',
      'connected',
      'partnership_active',
      'dormant',
      'closed_lost'
    )
  );

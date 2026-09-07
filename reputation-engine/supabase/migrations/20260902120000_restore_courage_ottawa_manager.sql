-- Dr Courage owns the full Ottawa operating view (customers, quotes and
-- partnerships). Branch scoping keeps every other market out of his session;
-- telephony ring groups remain an independent concern.
update public.app_users
set role = 'manager',
    branch = 'ottawa'
where lower(email) = 'courage.ottawa@starmovers.ca';

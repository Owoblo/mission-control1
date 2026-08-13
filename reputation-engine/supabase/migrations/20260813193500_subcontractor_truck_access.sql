alter table public.subcontractors
  add column if not exists truck_access text not null default 'rents'
  check (truck_access in ('owns', 'rents', 'labour_only'));

comment on column public.subcontractors.truck_access is
  'Whether the contractor owns trucks, rents trucks per job, or supplies labour only.';

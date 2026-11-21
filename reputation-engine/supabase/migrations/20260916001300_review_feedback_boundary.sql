-- Narrow, row-locked public feedback mutation. Never overwrite staff fields or capability version.
create or replace function public.patch_review_feedback(p_job_id text,p_access_version integer,p_patch jsonb,p_proof jsonb default '[]')
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare j jsonb; reviews jsonb; confirmed jsonb; k text; v jsonb; rating integer;
begin
 select data into j from public.review_jobs where id=p_job_id and not deleted for update;
 if j is null or coalesce((j->>'reviewAccessVersion')::integer,0)<>p_access_version then raise exception 'Review link changed or unavailable'; end if;
 if jsonb_typeof(p_patch)<>'object' or exists(select 1 from jsonb_object_keys(p_patch) x where x not in ('feedbackRating','feedbackComment','reviews')) then raise exception 'Invalid review fields'; end if;
 if p_patch ? 'feedbackRating' then
  if jsonb_typeof(p_patch->'feedbackRating')<>'number' or (p_patch->>'feedbackRating')::numeric not in (1,2,3,4,5) then raise exception 'Invalid rating'; end if;
  j:=j || jsonb_build_object('feedbackRating',p_patch->'feedbackRating');
 end if;
 if p_patch ? 'feedbackComment' then
  if jsonb_typeof(p_patch->'feedbackComment')<>'string' or length(p_patch->>'feedbackComment')>5000 then raise exception 'Invalid comment'; end if;
  j:=j || jsonb_build_object('feedbackComment',p_patch->'feedbackComment');
 end if;
 reviews:=coalesce(j->'reviews','{}');confirmed:=coalesce(j->'reviewConfirmedAt','{}');
 if p_patch ? 'reviews' then
  if jsonb_typeof(p_patch->'reviews')<>'object' then raise exception 'Invalid confirmations'; end if;
  for k,v in select * from jsonb_each(p_patch->'reviews') loop
   if k not in ('google','yelp','facebook','media') or jsonb_typeof(v)<>'boolean' then raise exception 'Invalid confirmation'; end if;
   if v='true'::jsonb then
    reviews:=reviews || jsonb_build_object(k,true);
    if not confirmed ? k then confirmed:=confirmed || jsonb_build_object(k,now()); end if;
   end if;
  end loop;
 end if;
 j:=j || jsonb_build_object('reviews',reviews,'reviewConfirmedAt',confirmed);
 if p_patch<>'{}'::jsonb then
  rating:=coalesce((j->>'feedbackRating')::integer,0);
  j:=j || jsonb_build_object('status',case when rating between 1 and 3 then 'flagged'
   when reviews @> '{"google":true,"yelp":true,"facebook":true,"media":true}'::jsonb then 'complete' else 'in-progress' end);
 end if;
 if jsonb_typeof(p_proof)<>'array' or jsonb_array_length(p_proof)>6 then raise exception 'Invalid proof'; end if;
 if jsonb_array_length(p_proof)>0 then j:=j || jsonb_build_object('reviewProofAssets',coalesce(j->'reviewProofAssets','[]') || p_proof); end if;
 update public.review_jobs set data=j,updated_at=now() where id=p_job_id;
 return j;
end $$;
revoke all on function public.patch_review_feedback(text,integer,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.patch_review_feedback(text,integer,jsonb,jsonb) to service_role;

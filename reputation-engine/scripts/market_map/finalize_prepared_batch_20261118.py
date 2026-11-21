"""Join reviewed account evidence, read-only CRM context and cloud route checks."""
import json
from collections import Counter
from datetime import datetime,timezone
from pathlib import Path
ROOT=Path(__file__).resolve().parents[2]
DIR=ROOT/'partnership-system/state/windsor-activation-20261118/cloud-enrichment'

FOLLOWUPS={
 'Windsor-Essex Catholic District School Board':('b34a0ce7-b2d0-463e-a0a0-fe96a45b97a7','Sarah Livingston','sarah_livingston@wecdsb.on.ca','Hi Sarah, just bringing this back up in case the board needs office or furniture moving support. Would it be useful to keep our details on file for future requirements? John'),
 'Essex County Library — Tecumseh/CADA':('a26dec8e-4fcc-4f3e-aa49-f1b5e59316a4','Adam Craig','acraig@essexcountylibrary.ca','Hi Adam, just bringing this back up in case a branch or office furniture transfer comes up. Would it be helpful to keep us on file as an option? John'),
 'Fortis Group':('1daebd24-6311-48a8-8f9b-5220cdd37c65','Fortis Group',None,'Hi, just bumping this up in case a project needs furniture moved or a client needs help relocating. Would it be useful to have our details handy for a future project? John'),
}
CUSTOM={
 'Prahit Inc.':'Hi, would it be helpful to have a local moving contact for office furniture or general business relocations? Happy to connect whenever something comes up for the team. John',
 'The Rad Shop':'Hi, would it be useful to have a local moving contact handy for the shop or customers who ask for one? Happy to send our details for you to keep. John',
 'Orqid Inc.':'Hi, would a moving contact be useful for office relocations or clients who need a referral? Happy to connect if that would help your team. John',
 'SBLV Eye Care':'Hi, who would be the best person to keep our details for office furniture moves at the practice? Happy to send a brief introduction. John',
 'Lakeview Montessori School':'Hi Renée, would it be useful to have a local moving contact for classroom furniture transfers or office moves? Happy to send our details for the school to keep on file. John',
 'Quality Cabinets':'Hi, would it be helpful to have a moving contact to pass along when a customer needs furniture relocated around a project? Happy to connect if that would be useful. John',
 'Riverview Steel':'Hi, would it be useful to have a local contact for office furniture moves or general business relocations? Happy to send our details to the right person on your team. John',
 'Urban Greenhouse Hydroponics':'Hi, would it help to have a local moving contact handy for store furniture moves or a change of premises? Happy to send over our details for whenever something comes up. John',
 'Beach Grove Golf & Country Club':'Hi, who would be the best person to keep our details for furniture transfers or office moves at the club? Happy to send a short introduction. John',
 'South Port Sailing Club':'Hi, would it be helpful to have a local moving contact for clubhouse furniture or office moves? Happy to send our details to whoever looks after that for the club. John',
 'The Cutting Board':'Hi, would it be useful to have a local moving contact handy for furniture moves or a future change of premises? Happy to send our details for you to keep. John',
 'Westdale Properties':'Hi, who would be the best person to connect with about tenant moving referrals or office furniture relocations? Happy to send a brief introduction for the team to keep on file. John',
}

def main():
    if (DIR/'copy-quality-hold.json').exists():
        raise RuntimeError('Owner rejected generic copy: preserve the corrected queue and complete a playbook-grounded copy review; do not regenerate earlier drafts.')
    a=json.loads((DIR/'account-route-review.json').read_text());c=json.loads((DIR/'crm-reconciliation.json').read_text());v=json.loads((DIR/'route-verification.json').read_text())
    if v['state']!='completed_with_review_holds':raise ValueError('Cloud route verification incomplete')
    context={x['key']:x for x in c['accounts']};items=[]
    boardkey=next(x['key']for x in a['accounts']if x['organization']=='Windsor-Essex Catholic District School Board')
    for account in a['accounts']:
        x=dict(account);crm=context[x['key']];x['crm_review']=crm;x['owner']='John / partnership operations';x['reviewed_at']=datetime.now(timezone.utc).isoformat()
        x['routes']=[{**r,'technical_check':v['phones'].get(r['value'],{'state':'unknown'})if r['type']=='phone'else v['domains'].get(r['value'].split('@')[1],{'state':'unknown'}),'mailbox_or_sms_delivery_verified':False}for r in account['routes']]
        x['draft']=CUSTOM.get(x['organization'],x['draft']);x['work_type']='new_relationship_review'
        x['holds']=[h for h in x['holds']if h!='fresh_crm_history_and_suppression_check']+['release_time_cross_channel_recheck_required']
        email=next((r for r in x['routes']if r['type']=='email'),None)
        mobile=next((r for r in x['routes']if r['type']=='phone'and r['technical_check'].get('type')=='mobile'),None)
        x['recommended_channel_for_review']='email'if email else 'sms'if mobile else 'professional_route_research'
        x['channel_basis']='professional_route_and_role_hypothesis_not_recipient_preference'
        if email:x['holds']+=['cold_email_paused','individual_mailbox_deliverability_unknown']
        if not email and mobile:x['holds']+=['sms_capability_and_eligibility_review_required']
        if not email and not mobile:x['holds']+=['no_verified_texting_route_or_email']
        x['status']='prepared_draft_release_review'if x['draft']and not x['identity_review_condition']else 'identity_or_role_review'if x['draft']else 'research_debt'
        if crm['history_state']!='no_matching_saved_history_found':
            x['status']='existing_context_review';x['holds'].append(crm['history_state'])
        if x['organization']in FOLLOWUPS:
            id,name,emailaddr,body=FOLLOWUPS[x['organization']]
            records=crm['exact_route_matches']+crm['account_name_or_domain_candidates'];recipient=next(r for r in records if r['id']==id)
            x.update(work_type='prior_outreach_followup_review',draft=body,target_crm_contact_id=id,target_name=name,proposed_recipient=emailaddr or recipient.get('phone'),recommended_channel_for_review='email'if emailaddr else 'sms')
            x['context_summary']='Prior outbound outreach exists; no human inbound reply found in the checked saved records. Do not describe this as an established partnership or moving enquiry.'
            if emailaddr:
                x['holds']+=['cold_email_paused','existing_recipient_route_revalidation_required']
            else:
                x['holds']+=['prior_sms_provider_and_sender_identity_reconciliation_required','existing_recipient_route_revalidation_required']
        if x['organization']in ('L. A. Desmarais Catholic Elementary School','St. André Catholic Elementary School'):
            x.update(status='coordinated_under_existing_account',work_type='parent_account_coordination',coordinated_under=boardkey,draft=None)
            x['holds'].append('avoid_parallel_board_and_school_introductions')
        # Every row remains preparatory. Verification does not establish permission.
        x.update(send_ready=False,approved=False,scheduled=False)
        x['holds']=list(dict.fromkeys(x['holds']));items.append(x)
    counts={'sites_covered':len(a['sites']),'account_review_records':len(items),'accounts_with_source_routes':sum(bool(x['routes'])for x in items),'coordinated_drafts':sum(bool(x['draft'])for x in items),'new_relationship_drafts':sum(bool(x['draft'])and x['work_type']=='new_relationship_review'for x in items),'prior_outreach_followup_drafts':sum(bool(x['draft'])and x['work_type']=='prior_outreach_followup_review'for x in items),'states':dict(Counter(x['status']for x in items)),'unique_phone_checks':v['unique_phones'],'mobile_classified':sum(x.get('type')=='mobile'for x in v['phones'].values()),'ambiguous_fixed_or_mobile':sum(x.get('type')=='fixed line or mobile'for x in v['phones'].values()),'toll_free':sum(x.get('type')=='toll free'for x in v['phones'].values()),'domains_with_mx':sum(x['state']=='mx_present'for x in v['domains'].values()),'new_carrier_lookups':v['paid_carrier_requests'],'approved':0,'scheduled':0,'send_ready':0,'messages_sent':0}
    output={'at':datetime.now(timezone.utc).isoformat(),'scope':'Prepared review queue, not automatic dispatch; no new CRM contacts or Sales leads created. All source sites retained, neighbouring corrections separate.','summary':counts,'items':items,'sites':a['sites'],'excluded_route_assertions':a['excluded_route_assertions'],'crm_scope':c['scope']}
    (DIR/'prepared-outreach-queue.json').write_text(json.dumps(output,ensure_ascii=False,indent=2)+'\n')
    lines=['# Prepared enrichment queue — November 18','', 'All 50 sites retained. Records below are account/branch review units, not asserted unique legal companies, confirmed referrals or new Sales leads. No sends or CRM mutations.','',*['- '+str(k)+': '+str(value)for k,value in counts.items()],'','## Account actions','','| Business/account | Work | State | Proposed channel |','| --- | --- | --- | --- |']
    for x in items:lines.append('| '+' | '.join([x['organization'].replace('|','/'),x['work_type'],x['status'],x['recommended_channel_for_review']])+' |')
    lines+=['','## Prepared copy','']
    for x in items:
        if x['draft']:lines.extend(['### '+x['organization'],'',x['draft'],'','Holds: '+', '.join(x['holds']), ''])
    lines+=['## Evidence and limits','','Read `partnership-system/state/windsor-activation-20261118/cloud-enrichment/prepared-outreach-queue.json` for exact routes, source hashes, dates, CRM candidates, history and technical observations. No-match means no match in the checked saved records, not exhaustive mailbox coverage. No surnames were treated as company matches. School outreach is coordinated under the already-contacted board; Cutting Board duplicate site leads share one account action. Published phone/email technical checks do not establish channel preference or permission. Cold email remains paused. Provider receipts and existing sender/channel histories still need release-time reconciliation.']
    (ROOT/'docs/partnership-prepared-outreach-20261118.md').write_text('\n'.join(lines)+'\n')
    assert counts['coordinated_drafts']==counts['new_relationship_drafts']+counts['prior_outreach_followup_drafts']
    assert all(not x['send_ready']and not x['scheduled']for x in items)
    print(json.dumps(counts,indent=2))

if __name__=='__main__':main()

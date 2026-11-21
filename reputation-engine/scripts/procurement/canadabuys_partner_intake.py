"""Offline CanadaBuys interested-business intake; no CRM writes or outreach.
Preserves distinct source entries, even repeated names. A partner listing proves
neither a bid nor an award nor a qualified supply arrangement.
"""
import argparse,collections,gzip,hashlib,html,json,re
from datetime import datetime,timezone
from pathlib import Path
from urllib.parse import urljoin
NOTICE='cb-1-54052272'
URL='https://canadabuys.canada.ca/en/tender-opportunities/tender-notice/'+NOTICE

def parse(raw,observed_at):
    text=(gzip.decompress(raw) if raw[:2]==b'\x1f\x8b' else raw).decode('utf-8')
    if 'Partner with another business' not in text or 'Businesses interested in partnering for this tender opportunity:' not in text:raise ValueError('Expected interested-business section missing; no inference from arbitrary page links')
    start=text.index('Businesses interested in partnering for this tender opportunity:');end=text.find('Contact information',start)
    if end<0:raise ValueError('Missing section boundary')
    entries=re.findall(r'<a\b[^>]*href=[\"\'](/en/node/preview/\d+)[\"\'][^>]*>(.*?)</a>',text[start:end],re.S|re.I)
    if not entries:raise ValueError('No public profile entries; page may require rendering')
    rows=[];seen=set();source_sha=hashlib.sha256(raw).hexdigest()
    for href,label in entries:
        name=html.unescape(re.sub('<[^>]+>','',label)).strip();profile=urljoin(URL,href)
        if profile in seen:continue
        seen.add(profile);self_record=name.casefold()=='saturn star movers'
        rows.append(dict(id='canadabuys:'+NOTICE+':'+href.rsplit('/',1)[-1],notice_id=NOTICE,organisation_name=name,profile_url=profile,source_url=URL,source_sha256=source_sha,observed_at=observed_at,relationship_type='interested_in_partnering',relationship_target=URL,relationship_basis='Business listed in public interested-in-partnering section',bidder_status='unknown',award_status='unknown',supply_arrangement_qualification='unknown',is_own_business=self_record,identity_status='source_reported_requires_resolution',outreach_eligibility='research_only',campaign_ready=False,required_checks=['profile and official website verification','legal entity and branch resolution','service geography and capability fit','existing CRM/history/suppression review'],next_action='own_listing_review' if self_record else 'retrieve_public_partner_profile'))
    names=collections.Counter(r['organisation_name'].casefold() for r in rows)
    for r in rows:r['duplicate_name_review']=names[r['organisation_name'].casefold()]>1
    return rows

def main():
    ap=argparse.ArgumentParser();ap.add_argument('--html',required=True);ap.add_argument('--output',required=True);a=ap.parse_args();out=Path(a.output)
    if out.exists():raise ValueError('Output exists; preserve snapshots with a new path')
    raw=Path(a.html).read_bytes();now=datetime.now(timezone.utc).isoformat();rows=parse(raw,now);out.mkdir(parents=True)
    (out/'notice.html').write_bytes(raw)
    (out/'interested-businesses.jsonl').write_text(''.join(json.dumps(r,ensure_ascii=False)+'\n' for r in rows))
    (out/'profile-review-queue.jsonl').write_text(''.join(json.dumps(dict(dedupe_key=r['id'],target_url=r['profile_url'],task_type=r['next_action'],status='pending',source_evidence=r['source_sha256'],metadata={'notice_id':NOTICE,'relationship_type':'interested_in_partnering','self_record':r['is_own_business']}))+'\n' for r in rows))
    report=dict(observed_at=now,notice_id=NOTICE,source_url=URL,entries=len(rows),distinct_names=len({r['organisation_name'].casefold() for r in rows}),own_business_entries=sum(r['is_own_business'] for r in rows),duplicate_name_entries=sum(r['duplicate_name_review'] for r in rows),campaign_ready=0,crm_writes=0,sent=0,files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in out.iterdir()})
    (out/'manifest.json').write_text(json.dumps(report,indent=2));print(json.dumps(report))
if __name__=='__main__':main()

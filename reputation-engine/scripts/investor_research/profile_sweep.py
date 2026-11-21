"""Source-only profile email collection, including public JavaScript email icons."""
import argparse
import csv
import fcntl
import io
import json
import os
from pathlib import Path
import urllib.parse
from worker import Worker,EMAIL,atomic

def run(folder,manifest):
    out=Path(folder);out.mkdir(parents=True,exist_ok=True)
    lock=(out/'sweep.lock').open('a');fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
    w=Worker(out);records=[]
    for i,person in enumerate(manifest):
        if (out/'STOP').exists():break
        page=w.capture(person['url'])
        addresses={e:'visible_text' for e in EMAIL.findall(page.get('text',''))}
        for href,label in page.get('links',[]):
            if href.lower().startswith('mailto:'):
                method=(label if label.startswith('Published email:') else
                    'literal_javascript_email_icon' if 'JavaScript' in label else 'mailto_link')
                for email in EMAIL.findall(urllib.parse.unquote(href[7:]).split('?')[0]):addresses[email]=method
        for email,method in (addresses.items() or [('', 'not_found')]):
            records.append(dict(person, email=email,extraction_method=method,
                source_status=page.get('status','unknown'),source_sha256=page.get('sha256',''),
                retrieved_at=page.get('retrieved_at',''),
                email_status='Publicly published; mailbox unverified; confirm person association' if email else 'No address extracted'))
        stream=io.StringIO();writer=csv.DictWriter(stream,fieldnames=list(records[0]));writer.writeheader();writer.writerows(records)
        atomic(out/'profile-emails.csv',stream.getvalue())
        atomic(out/'status.json',json.dumps({'state':'running','profiles_completed':i+1,'profiles_total':len(manifest),
            'unique_email_addresses':len({r['email'].lower() for r in records if r['email']}),
            'profiles_with_email':len({r['url'] for r in records if r['email']}),
            'model_calls':0,'messages_sent':0},indent=2))
    status=json.loads((out/'status.json').read_text());status['state']='stopped' if (out/'STOP').exists() else 'completed'
    atomic(out/'status.json',json.dumps(status,indent=2))

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--root',required=True);p.add_argument('--manifest',required=True);a=p.parse_args()
    os.umask(0o077);run(a.root,json.loads(Path(a.manifest).read_text()))

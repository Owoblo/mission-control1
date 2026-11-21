"""Save the five individually reviewed quiet-relationship drafts to Railway."""
import json

from .geo_recipient_cloud import FOLDER, remote


DRAFTS = {
    '1a1e1bb9-b0cf-4cbe-ab15-2bfa8b9dba9c': (
        '7531efe7-7034-499a-8270-f2a3e23654e4',
        'Prior Kitchener SMS introduced local move help around closings. The office visit was offered as a question. No acceptance appears in the saved partnership history.',
        'Hi Adrian, just circling back in case a Kitchener client ever needs a mover around closing. I’d be glad to be a local option you can pass along. Would a quick contact card be useful to keep handy? John',
    ),
    '953b4b91-9fea-44e3-9f83-5f0d8a2dbf81': (
        '329ae47f-4274-4920-9f73-d1360336580b',
        'The London SMS introduced furniture handling around installations and a digital card. There is no named recipient or saved reply.',
        'I wanted to follow up on my note about moving help in London. If a kitchen install ever means furniture needs to come out and go back in afterward, would it help to have a local mover your team can call? John',
    ),
    'a5c90a56-dd81-46dd-9c67-3449501bd541': (
        'cf083b20-636c-4b9f-bc3e-070e3ea5a789',
        'The July Kitchener SMS offered moving referrals for buyers and sellers. No office visit acceptance is saved.',
        'Hi Nicole, quick follow-up on my note from July. If a buyer ever asks for a Kitchener mover while they’re sorting out possession, I’d be happy to help. Would you like my contact info in an easy-to-forward card? John',
    ),
    'e4f79916-e196-489b-b4fa-29d03dcbb5d0': (
        '8e919640-beca-4a45-a7bb-b0ad2ef433fe',
        'The July SMS introduced local moving help in Kitchener. The saved thread contains the introduction only.',
        'Hi Andrew, just wanted to put my name back on your radar for Kitchener moves. If a client already has a mover lined up and the date falls through, would it be useful to have a backup you can call? John',
    ),
    '01108b3e-43cc-4f78-849f-3ae08e23d0e2': (
        '7f6c077d-4c81-47e6-97a2-e1944ff1e7bf',
        'The July London SMS introduced moving support for buyers and sellers. No reply or agreed visit is saved.',
        'Hi Joe, just following up on my note from the summer. If someone asks your team who to call for a London move, I’d be glad to be an option. Is there a better way to share my details with your team for when that comes up? John',
    ),
}

if __name__ == '__main__':
    print(json.dumps(remote(f"""
import json, os, pathlib
from datetime import datetime, timezone
os.umask(0o077)
p=pathlib.Path({FOLDER!r})
review=json.loads((p/'relationship-context-review.json').read_text())
drafts={DRAFTS!r}
items=[]
for item in review['items']:
    if item['state']!='quiet_relationship_review':
        continue
    contact_id=item['resolved_contact']['id']
    if contact_id not in drafts:
        continue
    touch_id, context, body=drafts[contact_id]
    if item['latest_touch']['id']!=touch_id or item['latest_touch']['channel']!='sms':
        continue
    items.append({{'contact_id':contact_id,'organization':item['organization'],'city':item['city'],
                  'context':context,'latest_saved_touch_id':touch_id,'channel':'sms',
                  'body':body,'state':'draft_requires_release_review','dispatch':False}})
assert len(items)==len(drafts)
summary={{'as_of':datetime.now(timezone.utc).isoformat(),'drafts':len(items),'dispatch':False}}
path=p/'quiet-relationship-drafts.json'
next_file=path.with_suffix('.next')
next_file.write_text(json.dumps({{'summary':summary,'items':items}},ensure_ascii=False,indent=2))
next_file.replace(path)
print('RESULT:'+json.dumps(summary))
"""), indent=2))

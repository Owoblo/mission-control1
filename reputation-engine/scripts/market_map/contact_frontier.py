"""Deterministic ranking of offered contact links; never invents URLs or releases holds."""
import heapq,re,unicodedata
from urllib.parse import urlsplit,unquote


def words(value):
    value=''.join(c for c in unicodedata.normalize('NFD',str(value)).casefold() if not unicodedata.combining(c))
    return ' '.join(re.findall(r'[a-z0-9]+',value))


def score_contact_link(url,label='',seed_url=None):
    try:
        p=urlsplit(url)
        if p.scheme not in ('http','https','') or p.username or p.password:return -1
        text=words(unquote(p.path)+' '+label)
        if re.search(r'\bcontact (?:lens|lenses|lents)\b',text):return -1
        scores=[score for score,pattern in [(100,r'\b(contact|contactez|joindre|coordonnees)\b'),
            (95,r'\b(procurement|purchasing|approvisionnement|achats|facilities|suppliers?|vendors?)\b'),
            (90,r'\b(team|staff|people|leadership|management|equipe|personnel)\b'),
            (80,r'\b(locations?|branches?|offices?|succursales?|bureaux)\b'),(30,r'\b(about|propos)\b')] if re.search(pattern,text)]
        score=max(scores,default=0)
        if seed_url and score:
            seed=urlsplit(seed_url)
            prefix=seed.path.rstrip('/')
            if prefix and seed.hostname==p.hostname and (p.path==prefix or p.path.startswith(prefix+'/')):score+=25
        return score
    except ValueError:return -1


def select_frontier(rows,limit,seed_url=None):
    candidates=(dict(r) for r in rows)
    return heapq.nsmallest(limit,(r for r in candidates if r.get('status','pending')=='pending'),
        key=lambda r:(-score_contact_link(r['url'],r.get('label',''),seed_url),r.get('depth',0),r['url']))


def ordered_frontier(frontier,visited,seed_url=None):
    while True:
        rows=select_frontier((r for r in frontier if r['url'] not in visited),1,seed_url)
        if not rows:return
        yield rows[0]


def initialize(db):
    db.execute('CREATE TABLE IF NOT EXISTS frontier_link_context(domain TEXT,url TEXT,label TEXT NOT NULL,PRIMARY KEY(domain,url))')
    db.commit()


def select_queued(db,domain,limit,seed_url=None):
    rows=db.execute("SELECT f.url,f.depth,f.status,COALESCE(l.label,'') AS label FROM frontier f LEFT JOIN frontier_link_context l ON l.domain=f.domain AND l.url=f.url WHERE f.domain=? AND f.status='pending'",(domain,))
    return select_frontier(rows,limit,seed_url)


def remember_links(db,result):
    for row in result.get('frontier_metadata',[]):
        db.execute('INSERT INTO frontier_link_context VALUES(?,?,?) ON CONFLICT(domain,url) DO UPDATE SET label=excluded.label',
                   (result['domain'],row['url'],row['label']))


def upsert_link(db,domain,url,depth,state):
    db.execute("""INSERT INTO frontier(domain,url,depth,status) VALUES(?,?,?,?) ON CONFLICT(domain,url) DO UPDATE SET depth=MIN(frontier.depth,excluded.depth),status=CASE WHEN frontier.status='depth_deferred' AND excluded.status='pending' THEN 'pending' ELSE frontier.status END""",(domain,url,depth,state))

"""Normalize downloaded official classifications; keep industries and occupations separate."""
import csv, io, json, pathlib, re, zipfile, xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[1] / 'partnership-system/catalogs'
NS = {'x': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}

def csvrows(name):
    data=(ROOT/'raw'/name).read_bytes()
    try: text=data.decode('utf-8-sig')
    except UnicodeDecodeError: text=data.decode('cp1252')
    return list(csv.DictReader(io.StringIO(text)))

def workbook(name):
    with zipfile.ZipFile(ROOT/'raw'/name) as z:
        strings = [''.join(n.itertext()) for n in ET.fromstring(z.read('xl/sharedStrings.xml'))] if 'xl/sharedStrings.xml' in z.namelist() else []
        result = []
        for row in ET.fromstring(z.read('xl/worksheets/sheet1.xml')).findall('.//x:row', NS):
            values = {}
            for c in row:
                v = c.find('x:v', NS)
                t = v.text if v is not None else ''.join(c.itertext())
                values[re.sub('[0-9]', '', c.get('r'))] = strings[int(t)] if c.get('t') == 's' else t
            result.append(values)
        return result

rows = []
def add(system, kind, code, title, level, parent='', definition=''):
    rows.append(dict(system=system, kind=kind, code=code, title=title.strip(), level=int(level), parent_code=parent, definition=definition))

for r in csvrows('naics-ca-2022.csv'):
    add('NAICS-CA-2022-v1', 'industry', r['Code'], r['Class title'], r['Level'], r['Parent'], r['Class definition'])
for r in csvrows('noc-2021.csv'):
    code = r['Code - NOC 2021 V1.0']
    add('NOC-2021-v1', 'occupation', code, r['Class title'], r['Level'], code[:-1], r['Class definition'])
isic_parents = {}
for r in csvrows('isic-5.csv'):
    code = r['ISIC Rev 5 Code']; level = 1 if code.isalpha() else len(code)
    add('ISIC-5', 'industry', code, r['ISIC Rev 5 Title'], level, isic_parents.get(level-1, ''))
    isic_parents[level] = code
for r in workbook('isco-08.xlsx')[1:]:
    if r.get('A', '').isdigit() and r.get('B'):
        code=r['B']; add('ISCO-08', 'occupation', code, r['C'], r['A'], code[:-1], r.get('D',''))
parents = {}
for r in workbook('naics-us-2022.xlsx')[3:]:
    code = r.get('B','')
    if not re.fullmatch(r'\d{2,6}|\d{2}-\d{2}', code): continue
    level = 1 if '-' in code else len(code)-1
    title = r.get('C','').strip()
    # Workbook attaches the trilateral T marker to agreed titles.
    if title.endswith('T'): title = title[:-1].rstrip()
    add('NAICS-US-2022','industry',code,title,level,parents.get(level-1,''))
    parents[level]=code

with (ROOT/'classifications.csv').open('w') as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0])); writer.writeheader(); writer.writerows(rows)
aliases=[]
for name,system,codekey,typekey,textkey in [
    ('naics-ca-elements.csv','NAICS-CA-2022-v1','Code','Element Type Label','Element Description'),
    ('noc-elements.csv','NOC-2021-v1','Code - NOC 2021 V1.0','Element Type Label English','Element Description English')]:
    for r in csvrows(name):
        aliases.append(dict(system=system,code=r[codekey],title=r['Class title'],element_type=r[typekey],text=r[textkey].strip()))
with (ROOT/'examples-and-boundaries.csv').open('w') as f:
    w=csv.DictWriter(f,fieldnames=list(aliases[0])); w.writeheader(); w.writerows(aliases)
summary={}
for system in sorted({r['system'] for r in rows}):
    subset=[r for r in rows if r['system']==system]; level=max(r['level'] for r in subset)
    assert len({r['code'] for r in subset})==len(subset), system
    codes={r['code'] for r in subset}
    assert all(not r['parent_code'] or r['parent_code'] in codes for r in subset), system
    summary[system]=dict(all_levels=len(subset),leaf_level=level,leaf_categories=sum(r['level']==level for r in subset))
(ROOT/'counts.json').write_text(json.dumps(summary,indent=2))
sources=json.loads((ROOT/'sources.json').read_text())
for s in sources:
    p=ROOT/'raw'/s['file']
    if p.exists(): s.update(status='downloaded',bytes=p.stat().st_size); s.pop('error',None)
(ROOT/'sources.json').write_text(json.dumps(sources,indent=2))

payload=json.dumps([{k:v for k,v in r.items() if k!='definition'} for r in rows]).replace('<','\\u003c')
html='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Partnership category library</title>
<style>body{font:16px system-ui;background:#f5f7fa;color:#15243a;margin:32px auto;max-width:1150px;padding:20px}input,select{padding:12px;font:inherit;margin:6px}table{border-collapse:collapse;width:100%;background:white}td,th{text-align:left;padding:12px;border-bottom:1px solid #dde4ed}small{color:#53627b}a{color:#1268af}</style>
<h1>Partnership category library</h1><p>Industry = what an organization does. Occupation = what a person does. Search either; classifications are separate systems, not automatic crosswalks.</p>
<p><a href="classifications.csv">All classification rows</a> · <a href="examples-and-boundaries.csv">Detailed examples and exclusions</a> · <a href="sources.json">Sources and editions</a></p>
<label>Search <input id="q" placeholder="hotel, facilities, nonprofit…"></label><label>System <select id="system"><option value="">All systems</option></select></label><label><input id="leaf" type="checkbox" checked>Most detailed categories</label><p id="count"></p><table><thead><tr><th>System</th><th>Code</th><th>Category</th><th>Kind</th></tr></thead><tbody id="rows"></tbody></table>
<script>const data=PAYLOAD;const max={};data.forEach(r=>max[r.system]=Math.max(max[r.system]||0,r.level));const q=document.querySelector('#q'),s=document.querySelector('#system'),leaf=document.querySelector('#leaf');Object.keys(max).forEach(v=>{const o=document.createElement('option');o.value=o.textContent=v;s.append(o)});function render(){const term=q.value.toLowerCase().trim();const a=data.filter(r=>(!s.value||r.system===s.value)&&(!leaf.checked||r.level===max[r.system])&&(!term||(r.code+' '+r.title).toLowerCase().includes(term)));document.querySelector('#count').textContent=a.length+' matches; showing first 300. Download CSV for all rows.';const target=document.querySelector('#rows');target.replaceChildren();a.slice(0,300).forEach(r=>{const tr=document.createElement('tr');[r.system,r.code,r.title,r.kind].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.append(td)});target.append(tr)})}q.oninput=s.onchange=leaf.onchange=render;render();</script>'''.replace('PAYLOAD',payload)
(ROOT/'browse.html').write_text(html)
print(json.dumps(summary,indent=2)); print('Example/boundary rows:',len(aliases))

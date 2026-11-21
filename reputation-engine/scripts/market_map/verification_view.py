"""Standalone local pilot view: searchable evidence rows and coordinate context."""
from __future__ import annotations

import argparse
import gzip
import json
import math
from pathlib import Path

from .verification_pilot import file_hash


def project(lon, lat):
    return round((lon + 83.6) / 10.0 * 1000, 2), round((46.6 - lat) / 5.4 * 540, 2)


def polygon_paths(path):
    """Display-only simplification; never used for matching or area claims."""
    if not path:
        return []
    from shapely.geometry import shape, mapping
    data = json.loads(Path(path).read_text())
    paths = []
    for feature in data.get("features", []):
        geometry = feature.get("geometry") or {}
        source_shape = shape(geometry)
        # Invalid source geometry remains unchanged in its archive. It is
        # omitted from the context drawing rather than repaired or invented.
        if not source_shape.is_valid:
            continue
        geometry = mapping(source_shape.simplify(.002, preserve_topology=True))
        polygons = geometry.get("coordinates", [])
        if geometry.get("type") == "Polygon":
            polygons = [polygons]
        elif geometry.get("type") != "MultiPolygon":
            continue
        commands = []
        for polygon in polygons:
            for ring in polygon:
                if len(ring) < 4:
                    continue
                points = ring
                commands.append("M" + "L".join(",".join(map(str, project(float(point[0]), float(point[1])))) for point in points) + "Z")
        paths.append({"name": feature.get("properties", {}).get("MUNICIPAL_NAME_SHORTFORM", "Municipality"), "d": "".join(commands)})
    return paths


def build_view(pilot_path, output, *, observations=None, polygons=None, reviews=None):
    pilot_path = Path(pilot_path)
    manifest = json.loads((pilot_path / "manifest.json").read_text())
    by_artifact = {item["path"]: item for item in manifest["artifacts"]}
    for name in ("pilot-records.jsonl.gz", "location-baseline.jsonl.gz"):
        if file_hash(pilot_path / name) != by_artifact[name]["sha256"]:
            raise ValueError("Pilot view source hash mismatch: " + name)
    with gzip.open(pilot_path / "pilot-records.jsonl.gz", "rt", encoding="utf-8") as stream:
        source_rows = [json.loads(line) for line in stream]
    targets = {row["location_id"] for row in source_rows}
    coordinates = {}
    with gzip.open(pilot_path / "location-baseline.jsonl.gz", "rt", encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            if row["id"] not in targets:
                continue
            try:
                lon, lat = float(row["longitude"]), float(row["latitude"])
                if math.isfinite(lon) and math.isfinite(lat) and -83.6 <= lon <= -73.6 and 41.2 <= lat <= 46.6:
                    coordinates[row["id"]] = {"lon": lon, "lat": lat, "point": project(lon, lat)}
            except (ValueError, TypeError):
                pass
    checked = {}
    review_notes = json.loads(Path(reviews).read_text()).get("reviews", {}) if reviews else {}
    if observations and Path(observations).exists():
        for line in Path(observations).read_text().splitlines():
            result = json.loads(line)
            for org in result["organisations"]:
                checked[org["organisation_id"]] = {"status": result["status"], "domain": result["domain"], "name_evidence": org.get("website_name_evidence", "not_established"),
                    "pages": [page["url"] for page in result["pages"]], "checked_at": result["observed_at"],
                    "published_emails": sorted({value for page in result["pages"] for value in page["published_mailto_addresses"]}),
                    "published_phones": sorted({value for page in result["pages"] for value in page["published_tel_values"]})}
                note = review_notes.get(result["domain"])
                if note:
                    checked[org["organisation_id"]]["manual_review"] = note
                    if note.get("reuse_status") in {"hold_pending_permission", "do_not_apply_to_candidate"}:
                        checked[org["organisation_id"]]["published_emails"] = []
                        checked[org["organisation_id"]]["published_phones"] = []
    rows = [{"id": row["organisation_id"], "name": row["name"], "city": row["city_raw"], "address": row["address_raw"],
             "location_type": row["location_type"], "labels": row["service_labels"], "industries": row["industries"],
             "sources": row["source_ids"], "website": row["website_candidate_url"], "flags": row["quality_flags"],
             "location_contexts": row["location_scopes"], "point": coordinates.get(row["location_id"]),
             "web": checked.get(row["organisation_id"], {"status": "pending" if row["website_candidate_url"] else "no_website_candidate"})}
            for row in source_rows]
    payload = {"rows": rows, "polygons": polygon_paths(polygons), "snapshot": manifest["snapshot_counts"],
               "pilot_count": len(rows), "labels": sorted({label for row in rows for label in row["labels"]}),
               "labels_unrepresented": manifest["configured_labels_without_selected_record"],
               "generated_from": manifest["completed_at"], "observed_organisations": len(checked),
               "polygon_context_sha256": file_hash(polygons) if polygons else None,
               "review_overlay_sha256": file_hash(reviews) if reviews else None}
    # Escaping '<' protects the script boundary even for malicious source names.
    inline = json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c").replace("\u2028", "\\u2028").replace("\u2029", "\\u2029")
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SSM verification pilot</title><style>
*{box-sizing:border-box}body{margin:0;color:#17283d;background:#f4f7fa;font:14px system-ui,sans-serif}header{padding:28px 4vw;background:#14263b;color:white}h1{margin:0 0 8px;font-size:30px}p{line-height:1.55}header p{max-width:1050px;color:#d4e2ee}.stats{display:flex;gap:24px;flex-wrap:wrap}.stats b{display:block;font-size:25px}main{padding:22px 4vw}.filters{display:flex;gap:10px;flex-wrap:wrap}input,select,button{padding:10px;border:1px solid #b7c6d2;border-radius:5px;background:white;color:#17283d;font:inherit}input{min-width:250px;flex:1}.map{margin:18px 0;background:#e6eff5;border:1px solid #c6d7e3;border-radius:8px;overflow:hidden}svg{display:block;width:100%;max-height:450px}.boundary{fill:#f9fbfc;stroke:#a6bdcc;stroke-width:.7;fill-rule:evenodd}.pin{fill:#267d9b;opacity:.7;cursor:pointer}.pin.observed{fill:#bb6d22}.notice{color:#536879;font-size:13px}.table{overflow:auto;background:white;border:1px solid #d8e2e9}table{width:100%;border-collapse:collapse;min-width:1000px}th,td{text-align:left;padding:12px;border-bottom:1px solid #e3eaf0;vertical-align:top}th{background:#eaf0f5}td:first-child{min-width:220px;font-weight:600}small{display:block;font-weight:400;color:#596e7e;margin-top:5px;line-height:1.5}a{color:#126585}details{font-weight:400;max-width:450px}summary{cursor:pointer}.pager{display:flex;gap:12px;align-items:center;margin:15px 0}footer{padding:20px 4vw;color:#536879}code{font-size:12px;overflow-wrap:anywhere}
</style><header><h1>SSM commercial map · verification pilot</h1><p>A versioned PILOT_COUNT-record research pilot selected from the loaded inventory. Field checks and source evidence are shown separately. This is a purposive coverage sample; its results cannot establish market-wide verification rates.</p><div class="stats" id="stats"></div></header><main>
<div class="filters"><input id="search" placeholder="Search organisations, addresses, sources…" aria-label="Search pilot"><select id="city" aria-label="Service label"></select><select id="industry" aria-label="Industry"></select><select id="status" aria-label="Website observation"></select></div>
<div class="map"><svg viewBox="0 0 1000 540" role="img" aria-label="Source-reported coordinate context"><g id="boundaries"></g><g id="pins"></g></svg></div>
<p class="notice">Dots show source-reported coordinates for representative addresses, including historical or mailing records. They are unverified. Blue: no website observation; amber: observation or review receipt. Simplified municipal outlines are visual context only; they do not establish occupancy or service eligibility.</p>
<p id="count"></p><div class="table"><table><thead><tr><th>Organisation / source</th><th>Location claim</th><th>Industry / service labels</th><th>Website evidence</th><th>Review details</th></tr></thead><tbody id="rows"></tbody></table></div><div class="pager"><button id="previous">Previous</button><span id="page"></span><button id="next">Next</button></div>
<p class="notice" id="missing"></p></main><footer>Names, addresses, contact ownership, operation and purchasing authority remain subject to field-level review. No messages or calls are sent by this view. Full baseline and pilot files are stored alongside this report.</footer>
<script id="data" type="application/json">PAYLOAD</script><script>
const data=JSON.parse(document.querySelector('#data').textContent), $=s=>document.querySelector(s), ns='http://www.w3.org/2000/svg';let page=0;
function node(tag,text){const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n}function options(id,label,values){const s=$(id);s.append(new Option(label,''));values.forEach(v=>s.append(new Option(v,v)))}
[['Screened snapshot organisations',data.snapshot.organisations],['Locations screened',data.snapshot.locations],['Pilot records',data.pilot_count],['With website receipts',data.observed_organisations]].forEach(([label,value])=>{const n=node('div');n.append(node('b',value.toLocaleString()),node('span',label));$('#stats').append(n)});
document.querySelector('header p').append(document.createTextNode(' Snapshot screened '+data.generated_from+'. Later imports are tracked separately.'));
options('#city','All represented service labels',data.labels);options('#industry','All mapped industries',[...new Set(data.rows.flatMap(r=>r.industries))].sort());options('#status','All website statuses',[...new Set(data.rows.map(r=>r.web.status))].sort());
data.polygons.forEach(p=>{const n=document.createElementNS(ns,'path');n.setAttribute('d',p.d);n.setAttribute('class','boundary');const t=document.createElementNS(ns,'title');t.textContent=p.name;n.append(t);$('#boundaries').append(n)});
function render(){const q=$('#search').value.toLowerCase().trim(),city=$('#city').value,industry=$('#industry').value,status=$('#status').value;const filtered=data.rows.filter(r=>(!q||JSON.stringify(r).toLowerCase().includes(q))&&(!city||r.labels.includes(city))&&(!industry||r.industries.includes(industry))&&(!status||r.web.status===status));page=Math.min(page,Math.max(0,Math.ceil(filtered.length/100)-1));$('#rows').replaceChildren();$('#pins').replaceChildren();
filtered.forEach(r=>{if(r.point){const c=document.createElementNS(ns,'circle');c.setAttribute('cx',r.point.point[0]);c.setAttribute('cy',r.point.point[1]);c.setAttribute('r','3');c.setAttribute('class','pin'+(!['pending','no_website_candidate'].includes(r.web.status)?' observed':''));const t=document.createElementNS(ns,'title');t.textContent=r.name+' · '+(r.city||'Unknown locality')+' · '+r.location_type;c.append(t);c.addEventListener('click',()=>{$('#search').value=r.name;page=0;render()});$('#pins').append(c)}});
filtered.slice(page*100,(page+1)*100).forEach(r=>{const tr=node('tr'),name=node('td',r.name);name.append(node('small',r.sources.join(', ')));const location=node('td',(r.address||'Address missing')+' · '+(r.city||'Locality unknown'));location.append(node('small',r.location_type+' · '+r.location_contexts.length+' location record(s)'));const category=node('td',r.industries.join(', '));category.append(node('small',r.labels.join(', ')));const web=node('td',r.web.status.replaceAll('_',' '));if(r.website){const a=node('a','Candidate website');a.href=r.website;a.target='_blank';a.rel='noopener';web.append(node('br'),a)}web.append(node('small',r.web.name_evidence||'Website identity not checked'));if(r.web.manual_review)web.append(node('small','Manual review: '+r.web.manual_review.identity_status+' · '+r.web.manual_review.reuse_status));const review=node('td'),d=node('details'),s=node('summary','Evidence and open questions');d.append(s,node('p',r.flags.join('; ')),node('p','Physical branch operation, contact ownership and purchasing authority: not verified by this view.'));if(r.web.manual_review)d.append(node('p',r.web.manual_review.notes));if(r.web.checked_at)d.append(node('p','Observed '+r.web.checked_at));(r.web.pages||[]).forEach(url=>{const a=node('a',url);a.href=url;a.target='_blank';a.rel='noopener';d.append(a,node('br'))});d.append(node('p','Published email links: '+((r.web.published_emails||[]).join(', ')||'None captured or held')),node('p','Published phone links: '+((r.web.published_phones||[]).join(', ')||'None captured or held')),node('code',r.id));review.append(d);tr.append(name,location,category,web,review);$('#rows').append(tr)});
$('#count').textContent=filtered.length.toLocaleString()+' matching pilot records · '+filtered.filter(r=>r.point).length.toLocaleString()+' with coordinates in this view';$('#page').textContent='Page '+(page+1)+' of '+Math.max(1,Math.ceil(filtered.length/100));$('#previous').disabled=page===0;$('#next').disabled=(page+1)*100>=filtered.length;}
['#search','#city','#industry','#status'].forEach(s=>$(s).addEventListener('input',()=>{page=0;render()}));$('#previous').onclick=()=>{page--;render()};$('#next').onclick=()=>{page++;render()};$('#missing').textContent='Configured labels without a selected pilot record ('+data.labels_unrepresented.length+'): '+data.labels_unrepresented.join(', ');render();
</script></html>'''
    document = document.replace("PAYLOAD", inline).replace("PILOT_COUNT", f"{len(rows):,}")
    output = Path(output)
    output.write_text(document, encoding="utf-8")
    return {"path": str(output), "pilot_records": len(rows), "coordinate_points": len(coordinates),
            "website_observation_organisations": len(checked), "sha256": file_hash(output)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--observations")
    parser.add_argument("--polygons")
    parser.add_argument("--reviews")
    args = parser.parse_args()
    print(json.dumps(build_view(args.pilot, args.output, observations=args.observations, polygons=args.polygons, reviews=args.reviews)))


if __name__ == "__main__":
    main()

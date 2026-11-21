"""Small searchable local preview of the complete compressed inventory."""
import csv
import gzip
import html
import json
from collections import Counter
from pathlib import Path
from urllib.parse import urlsplit

TARGETS = ["Windsor", "London", "Sarnia", "Chatham", "Woodstock", "Kitchener", "Waterloo", "Cambridge", "Guelph", "Ottawa", "Toronto", "Mississauga", "Brampton", "Vaughan", "Markham", "Hamilton"]


def build_preview(folder, per_city=40):
    folder = Path(folder)
    topline = json.loads((folder / "topline.json").read_text())
    total_candidates = topline.get("service_footprint_business_candidate_counts", {}).get("configured_label_match", 0)
    selected, counts, category_counts = [], Counter(), Counter()
    names = {name.casefold(): name for name in TARGETS}
    names["chatham-kent"] = "Chatham"
    path = folder / "configured-service-area-business-candidates.csv.gz"
    with gzip.open(path, "rt", newline="", encoding="utf-8") as handle:
        reader = csv.DictReader(handle)
        columns = reader.fieldnames
        for row in reader:
            city = names.get(row["city"].casefold())
            if not city or counts[city] >= per_city:
                continue
            key = city, row["source_category"]
            if category_counts[key] >= 4:
                continue
            selected.append(row)
            counts[city] += 1
            category_counts[key] += 1
            if all(counts[name] >= per_city for name in TARGETS):
                break
    selected.sort(key=lambda row: (row["city"].casefold(), row["name"].casefold()))
    with (folder / "inventory-preview.csv").open("w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=columns)
        writer.writeheader()
        writer.writerows(selected)
    config = json.loads((Path(__file__).parent / "config/taxonomy.json").read_text())
    labels = {item["id"]: item["label"] for item in config["industry_families"]}
    rows = []
    for row in selected:
        try:
            families = ", ".join(labels.get(value, value) for value in json.loads(row["ssm_industry_families"]))
        except (ValueError, TypeError):
            families = row["ssm_industry_families"]
        website = row["website"]
        parsed = urlsplit(website)
        link = '<a target="_blank" rel="noopener" href="' + html.escape(website, quote=True) + '">Website</a>' if parsed.scheme in ("http", "https") and parsed.hostname else ""
        cells = "".join("<td>" + html.escape(row.get(field) or "") + "</td>" for field in ("name", "city", "address", "source_category"))
        rows.append("<tr>" + cells + "<td>" + html.escape(families or "Uncategorised") + "</td><td>" + link + "</td></tr>")
    document = '''<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SSM inventory preview</title><style>
*{box-sizing:border-box}body{margin:0;background:#f6f8fb;color:#142238;font:15px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
header{padding:32px 4vw 22px;background:#142238;color:white}h1{margin:0 0 10px;font-size:30px}header p{max-width:1000px;line-height:1.55;color:#d5dfed}
nav{display:flex;gap:18px;flex-wrap:wrap}nav a{color:#b6e1ff}main{padding:24px 4vw}input{width:min(680px,100%);padding:14px 16px;border:1px solid #b7c5d7;border-radius:8px;font:inherit;background:white}
#count{color:#53667e;margin:14px 0}.table{overflow:auto;background:white;border:1px solid #dbe3ee;border-radius:10px}table{border-collapse:collapse;width:100%;min-width:1050px}th{position:sticky;top:0;background:#e8eff8;text-align:left;padding:13px 12px;font-size:13px}
td{padding:12px;border-bottom:1px solid #edf1f7;vertical-align:top;line-height:1.4}td:first-child{font-weight:600;min-width:200px}td:nth-child(3){min-width:180px}td:nth-child(4){color:#52667f}td a{color:#075a9c}tr[hidden]{display:none}footer{padding:20px 4vw;color:#52667f;font-size:13px}
</style><header><h1>SSM commercial inventory</h1><p>Readable sample from the TOTAL_CANDIDATES source-backed business candidates matched to configured service locations. This preview contains SAMPLE_COUNT rows across the main city lanes; the full compressed CSV contains the complete list. Candidates are provisional, and franchise ownership and current buying intent remain unverified.</p><nav>
<a href="configured-service-area-business-candidates.csv.gz">Full service-area CSV.gz</a><a href="organisation-business-candidates.csv.gz">Broader business CSV.gz</a><a href="city-summary.csv">City/locality summary</a><a href="category-summary.csv">Source categories</a><a href="scope-summary.csv">Scope review</a></nav></header>
<main><input id="search" aria-label="Search preview" placeholder="Search names, streets, cities, or industries in this preview…"><p id="count"></p><div class="table"><table><thead><tr><th>Business/place name</th><th>Published locality</th><th>Published address</th><th>Source category</th><th>Mapped industry family</th><th>Website</th></tr></thead><tbody>TABLE_ROWS</tbody></table></div></main>
<footer>Source: Overture release 2026-10-21.0 and retained contributor provenance. Published details require verification before use. All records remain research-only. The CSVs retain provider IDs, observation dates, source links, and attribution.</footer>
<script>const input=document.querySelector('#search'),rows=[...document.querySelectorAll('tbody tr')],count=document.querySelector('#count');const texts=rows.map(r=>r.textContent.toLowerCase());function filter(){const q=input.value.toLowerCase().trim();let shown=0;rows.forEach((r,i)=>{r.hidden=q&&!texts[i].includes(q);if(!r.hidden)shown++});count.textContent=shown.toLocaleString()+' of '+rows.length.toLocaleString()+' preview rows shown — search applies to the preview sample.'}input.addEventListener('input',filter);filter();</script></html>'''
    document = document.replace("TOTAL_CANDIDATES", f"{total_candidates:,}").replace("SAMPLE_COUNT", str(len(selected))).replace("TABLE_ROWS", "".join(rows))
    target = folder / "inventory-preview.html"
    target.write_text(document, encoding="utf-8")
    return {"preview": str(target), "rows": len(selected), "city_counts": dict(counts)}

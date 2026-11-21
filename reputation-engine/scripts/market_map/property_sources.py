"""Bounded first-party shopping-centre and project-portfolio observations.

Internal tenant/profile links establish what a property publisher lists, never a
franchise owner, current lease, construction contract, buying signal or authority.
HTML is parsed in memory; saved batches retain short factual extracts only.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urljoin, urlsplit, urlunsplit

from lxml import html

from .store import domain, dumps, normalise, stable_id, stamp
from .transport import BudgetExceeded, SourceBlocked, Transport


DEFAULT_SPECS = [
    {"id": "devonshire-mall-tenants", "name": "Devonshire Mall", "kind": "mall_directory", "directory_url": "https://devonshiremall.com/stores/", "info_url": "https://devonshiremall.com/pages/devonshire-rules-regulations/", "terms_url": "https://devonshiremall.com/pages/privacy-policy/", "city": "Windsor", "address_candidate": "3100 Howard Avenue", "profile_paths": ["/stores/"]},
    {"id": "white-oaks-mall-tenants", "name": "White Oaks Mall", "kind": "mall_directory", "directory_url": "https://www.whiteoaksmall.ca/stores/", "info_url": "https://www.whiteoaksmall.ca/mall-info/", "terms_url": "https://www.whiteoaksmall.ca/privacy-policy/", "city": "London", "address_candidate": "1105 Wellington Rd.", "profile_paths": ["/stores/"]},
    {"id": "lambton-mall-tenants", "name": "Lambton Mall", "kind": "mall_directory", "directory_url": "https://lambtonmall.com/stores", "info_url": "https://lambtonmall.com/stores/crunch-fitness-2fa87fb5-72f6-4613-bea8-c2dcdefabd03", "terms_url": "https://lambtonmall.com/pages/privacy-policy/", "city": "Sarnia", "address_candidate": "1380 London Rd", "profile_paths": ["/stores/"]},
    {"id": "cf-masonville-place-tenants", "name": "CF Masonville Place", "kind": "mall_directory", "directory_url": "https://shops.cadillacfairview.com/property/cf-masonville-place/store", "info_url": "https://shops.cadillacfairview.com/property/cf-masonville-place/store", "policy_hosts": ["cadillacfairview.com", "www.cadillacfairview.com"], "city": "London", "address_candidate": "1680 Richmond Street", "profile_paths": ["/property/cf-masonville-place/store/"]},
    {"id": "dancor-published-projects", "name": "Dancor Construction Ltd.", "kind": "project_portfolio", "directory_url": "https://dancor.ca/projects", "profile_paths": ["/buildings/", "/property-listing/", "/property-listings/", "/project-listing/"]},
]
PHONE = re.compile(r"(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}")
UTILITY = re.compile(r"privacy|terms|cookie|contact|careers|map|hours|guest services|newsletter|gift card", re.I)
POLICY_RESTRICTION = re.compile(r"(?:prohibit|may not|shall not|not permitted|not allowed|forbidden|without.{0,20}permission).{0,120}(?:scrap|crawl|robot|automated|bulk)|(?:scrap|crawl|robot|automated|bulk).{0,120}(?:prohibit|not permitted|not allowed|forbidden)", re.I)
STATUS = re.compile(r"\s*(?:[–—|]|\s-\s)\s*(?:NOW OPEN!?|COMING SOON!?|CLOSED|Now located.*)$", re.I)


def _url(value, base):
    try:
        parsed = urlsplit(urljoin(base, value))
        if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 80, 443):
            return None
        return urlunsplit(("https", parsed.hostname.casefold(), parsed.path or "/", "", ""))
    except ValueError:
        return None


def _document(body):
    if isinstance(body, bytes):
        body = body.decode("utf-8-sig", errors="replace")
    document = html.fromstring(body)
    for node in document.xpath("//script|//style|//noscript"):
        node.drop_tree()
    return document


def _text(node):
    return " ".join(node.text_content().split())


def _status(label):
    if re.search(r"\bcoming soon\b", label, re.I):
        return "listed_future"
    if re.search(r"\bclosed\b", label, re.I):
        return "listed_closed"
    return "source_listed"


def parse_directory(body, page_url, *, kind="mall_directory", profile_paths=None):
    """Parse internal profile links, including /buildings and property listings."""
    document = _document(body)
    paths = profile_paths or (["/stores/", "/store/"] if kind == "mall_directory" else ["/buildings/", "/property-listing/", "/property-listings/", "/project-listing/"])
    records = {}
    for anchor in document.xpath("//a[@href]"):
        if anchor.xpath("ancestor::nav|ancestor::footer|ancestor::header"):
            continue
        target = _url(anchor.get("href"), page_url)
        if not target or domain(target) != domain(page_url):
            continue
        path = urlsplit(target).path
        if not any(path.startswith(prefix) and path[len(prefix):].strip("/") for prefix in paths):
            continue
        label = _text(anchor) or " ".join(anchor.xpath(".//img/@alt")).strip()
        if not label or len(label) > 220:
            continue
        # White Oaks includes a published phone in the anchor, alongside its name.
        phone = PHONE.search(label)
        name = label[:phone.start()].strip() if phone else label
        name = re.sub(r"\s+\d[\d, ]*\s*sq\s*ft\.?$", "", name, flags=re.I).strip()
        name = STATUS.sub("", name).strip(" –—|-")
        if not name:
            continue
        records[target] = {"name": name, "profile_url": target, "directory_url": page_url, "listing_label": label, "listing_status": _status(label), "phone": phone.group() if phone else None, "supporting_excerpt": label[:250]}
    policies = []
    for anchor in document.xpath("//a[@href]"):
        if re.search(r"privacy|terms|conditions", _text(anchor), re.I):
            target = _url(anchor.get("href"), page_url)
            if target:
                policies.append(target)
    return {"records": list(records.values()), "policy_urls": sorted(set(policies)), "title": " ".join(document.xpath("//h1//text() | //title/text()"))[:250], "content_hash": hashlib.sha256(body if isinstance(body, bytes) else body.encode()).hexdigest()}


def parse_profile(body, url):
    document = _document(body)
    content = document.xpath("//main")
    content = content[0] if content else document
    title = " ".join(content.xpath(".//h1//text()"))[:220]
    websites = []
    for anchor in content.xpath(".//a[@href]"):
        target = _url(anchor.get("href"), url)
        label = _text(anchor)
        parent = _text(anchor.getparent())[:350] if anchor.getparent() is not None else label
        if target and domain(target) != domain(url) and re.search(r"\bweb(?:site)?\b|https?://|www\.", label + " " + parent, re.I):
            if not re.search(r"facebook|instagram|twitter|linkedin|google|googletagmanager|youtube", domain(target), re.I):
                websites.append(target)
    text = _text(content)
    phone = PHONE.search(text)
    return {"title": title, "website": websites[0] if len(set(websites)) == 1 else None, "website_candidates": sorted(set(websites)), "phone": phone.group() if phone else None, "source_url": url, "content_hash": hashlib.sha256(body if isinstance(body, bytes) else body.encode()).hexdigest()}


def _project_address(record, profile=None):
    # Numbered source titles supply street addresses. A city is used only when
    # explicitly in the same title, rather than the developer's footer office.
    label = (profile or {}).get("title") or record["name"]
    label = re.sub(r"\s+\d[\d, ]*\s*sq\s*ft\.?$", "", label, flags=re.I).strip()
    if not re.match(r"^\d+[A-Za-z-]?\s+", label):
        return {"address": None, "city": None}
    address, separator, locality = label.partition(",")
    return {"address": address.strip(), "city": locality.strip() if separator and locality.strip() else None}


def inspect_property_source(transport, spec, *, max_pages=20, profile_limit=5):
    """Inspect robots/access and policy separately; collect bounded factual rows.

    A reachable privacy policy is not an open-data licence. These observations
    carry an explicit limited factual-review status, never bulk-reuse permission.
    Any explicit automation prohibition prevents further extraction/application.
    """
    if not 1 <= max_pages <= 20 or not 0 <= profile_limit <= 16:
        raise ValueError("Property acquisition is limited to 20 useful pages per source domain")
    started = stamp()
    before = transport.metrics()
    batch = {"source": dict(spec), "observed_at": started, "status": "pending", "access_status": "unverified", "reuse_status": "unverified", "bulk_reuse_permission": False, "pages": [], "policy_observations": [], "records": [], "errors": [], "property": None}
    host = urlsplit(spec["directory_url"]).hostname
    allowed = {host, *spec.get("policy_hosts", [])}

    def fetch(url, purpose):
        if len(batch["pages"]) >= max_pages:
            raise BudgetExceeded("Per-domain property useful-page cap reached")
        if urlsplit(url).hostname not in allowed:
            raise SourceBlocked("Property acquisition link leaves its configured source host")
        response = transport.fetch(url, allowed_hosts=allowed)
        batch["pages"].append({"url": response.url, "purpose": purpose, "fetched_at": stamp(), "content_hash": hashlib.sha256(response.body).hexdigest(), "bytes": len(response.body)})
        return response

    try:
        response = fetch(spec["directory_url"], "directory")
        directory = parse_directory(response.body, response.url, kind=spec["kind"], profile_paths=spec.get("profile_paths"))
        batch["policy_discovery"] = directory["policy_urls"]
        batch["access_status"] = "accessible"
        if not directory["records"]:
            raise SourceBlocked("No internal tenant/property profiles parsed; not treated as an empty market")
        policy_urls = [url for url in sorted(set(directory["policy_urls"] + ([spec["terms_url"]] if spec.get("terms_url") else []))) if urlsplit(url).hostname in allowed][:3]
        for policy_url in policy_urls:
            try:
                policy_response = fetch(policy_url, "policy")
                policy_text = _text(_document(policy_response.body))
                restriction = POLICY_RESTRICTION.search(policy_text)
                batch["policy_observations"].append({"url": policy_response.url, "status": "inspected", "content_hash": hashlib.sha256(policy_response.body).hexdigest(), "explicit_automation_restriction": bool(restriction), "supporting_excerpt": policy_text[max(0, restriction.start()-60):restriction.end()+60][:350] if restriction else "Privacy/terms page inspected; no open bulk-reuse licence established."})
                if restriction:
                    batch["reuse_status"] = "automation_restricted"
                    raise SourceBlocked("Source policy restricts automated/bulk use; retain source lead only")
            except SourceBlocked as exc:
                if batch["reuse_status"] == "automation_restricted":
                    raise
                batch["policy_observations"].append({"url": policy_url, "status": "unavailable", "error": str(exc)})
                if re.search(r"disclaimer|terms|conditions", policy_url, re.I):
                    batch["reuse_status"] = "policy_review_required"
        if batch["reuse_status"] == "policy_review_required":
            batch["records"] = directory["records"]
            raise SourceBlocked("Linked source terms/disclaimer could not be reviewed; keep directory candidates held for reuse review")
        batch["reuse_status"] = "limited_factual_review_only"
        if spec["kind"] == "mall_directory":
            property_record = {"name": spec["name"], "source_url": response.url, "address": None, "city": None, "property_type": "shopping_centre", "supporting_excerpt": directory["title"], "address_evidence_url": None}
            if spec.get("info_url"):
                try:
                    info = response if spec["info_url"] == spec["directory_url"] else fetch(spec["info_url"], "property_address")
                    text = _text(_document(info.body))
                    candidate = spec.get("address_candidate")
                    city = spec.get("city")
                    if candidate and normalise(candidate) in normalise(text) and city and normalise(city) in normalise(text):
                        position = text.casefold().find(candidate.casefold())
                        excerpt = text[max(0, position-50):position+len(candidate)+120] if position >= 0 else candidate
                        property_record.update({"address": candidate, "city": city, "address_evidence_url": info.url, "address_content_hash": hashlib.sha256(info.body).hexdigest(), "supporting_excerpt": excerpt[:250]})
                    else:
                        batch["errors"].append({"url": info.url, "reason": "Property street/city not corroborated in source page; kept unknown"})
                except SourceBlocked as exc:
                    batch["errors"].append({"url": spec["info_url"], "reason": str(exc)})
            batch["property"] = property_record
        for index, record in enumerate(directory["records"]):
            if index < profile_limit:
                try:
                    profile_response = fetch(record["profile_url"], "profile_sample")
                    record["profile"] = parse_profile(profile_response.body, profile_response.url)
                except SourceBlocked as exc:
                    record["profile_error"] = str(exc)
            if spec["kind"] == "project_portfolio":
                record.update(_project_address(record, record.get("profile")))
            batch["records"].append(record)
        batch["status"] = "factual_observations_collected"
        batch["source_coverage"] = "Published internal directory links on this page; not all properties, businesses or verified leases/contracts."
    except (SourceBlocked, BudgetExceeded) as exc:
        batch["status"] = "policy_review_required" if batch["reuse_status"] == "policy_review_required" else ("blocked" if isinstance(exc, SourceBlocked) else "partial_budget")
        batch["errors"].append({"url": spec["directory_url"], "reason": str(exc)})
        if batch["reuse_status"] == "automation_restricted":
            batch["records"] = []
    after = transport.metrics()
    batch["metrics"] = {key: after[key]-before[key] for key in ("requests", "bytes_fetched", "cache_hits")}
    batch["metrics"].update({"paid_service_calls": 0, "estimated_cost": 0, "useful_pages": len(batch["pages"])})
    batch["robots_checked"] = {key: value for key, value in after["robots_checked"].items() if key in allowed}
    return batch


def apply_property_batch(store, batch):
    """Apply an explicit saved factual-review batch; never fetch or campaign."""
    spec = batch["source"]
    source_id = spec["id"]
    status = batch.get("status")
    store.upsert_source({"id": source_id, "name": spec["name"] + " first-party " + spec["kind"], "publisher": spec["name"], "source_url": spec["directory_url"], "source_type": "shopping_centre_tenant_directory" if spec["kind"] == "mall_directory" else "contractor_projects", "geography_scope": [spec["city"]] if spec.get("city") else ["Ontario"], "sector_scope": ["retail"] if spec["kind"] == "mall_directory" else ["commercial_property"], "access_method": "bounded_first_party_factual_review", "retrieval_status": "accessible" if status == "factual_observations_collected" else "blocked", "rights_status": "limited_factual_review_only" if batch.get("reuse_status") == "limited_factual_review_only" else "unreviewed", "terms_url": spec.get("terms_url"), "robots_checked_at": batch.get("robots_checked", {}).get(urlsplit(spec["directory_url"]).hostname, {}).get("checked_at"), "last_checked_at": batch["observed_at"], "adapter_name": "property_sources", "notes": "Public factual directory observations only. Bulk-reuse rights unverified; no franchise-owner, current-lease, vendor-approval or current-contract inference."})
    unavailable_terms = any(item.get("status") == "unavailable" and re.search(r"disclaimer|terms|conditions", item.get("url", ""), re.I) for item in batch.get("policy_observations", []))
    if status != "factual_observations_collected" or batch.get("reuse_status") != "limited_factual_review_only" or unavailable_terms:
        run_id = stable_id("held-property-batch", source_id, batch["observed_at"], batch.get("errors"))
        previous = store.db.execute("SELECT result_json FROM source_runs WHERE id=?", (run_id,)).fetchone()
        if previous:
            return {**json.loads(previous[0]), "source_id": source_id, "run_id": run_id, "replayed": True}
        return store.record_run_failure(source_id, dumps(batch.get("errors") or [{"reason": "Property source batch not eligible for factual observation import"}]), run_metadata={**batch.get("metrics", {}), "run_id": run_id, "started_at": batch["observed_at"], "observed_at": batch["observed_at"]}, status="blocked")
    observed_at = batch["observed_at"]
    result = {"source_id": source_id, "properties_added": 0, "organisations_added": 0, "relationships_added": 0, "property_source_status": "source_listed_unverified"}
    from .geography import resolve_geography, municipality_for

    def property_record(record, record_key):
        identifier = stable_id("first-party-property", source_id, record_key)
        url = record.get("address_evidence_url") or record.get("profile_url") or record.get("source_url") or spec["directory_url"]
        property_observed_at = record.get("observed_at") or observed_at
        evidence_id = store.record_evidence(source_id, record, url, property_observed_at, source_record_id="property:" + record_key, excerpt=record.get("supporting_excerpt") or record.get("listing_label"))
        locality = resolve_geography(store, record.get("city")) if record.get("city") else None
        municipality = municipality_for(store, locality) if locality else None
        exists = store.db.execute("SELECT * FROM properties WHERE id=?", (identifier,)).fetchone()
        store.db.execute("INSERT OR IGNORE INTO properties(id,property_name,address,municipality_id,property_type) VALUES(?,?,?,?,?)", (identifier, record.get("name"), record.get("address"), municipality, record.get("property_type") or "commercial_project"))
        if exists:
            if not exists["address"] and record.get("address"):
                store.db.execute("UPDATE properties SET address=? WHERE id=? AND address IS NULL", (record["address"], identifier))
            elif exists["address"] and record.get("address") and normalise(exists["address"]) != normalise(record["address"]):
                store.add_review("property_address_changed", [identifier], [evidence_id], "A new first-party property address differs; retain both assertions and review before changing the canonical address")
            if not exists["municipality_id"] and municipality:
                store.db.execute("UPDATE properties SET municipality_id=? WHERE id=? AND municipality_id IS NULL", (municipality, identifier))
        for field in ("name", "address", "city", "property_type"):
            store.assert_field(identifier, "property", field, record.get(field), evidence_id, property_observed_at, review_status="source_listed_unverified")
        result["properties_added"] += int(exists is None)
        return identifier, evidence_id

    with store.transaction():
        if spec["kind"] == "mall_directory":
            property_id, property_evidence = property_record(batch["property"], "shopping-centre")
            property_city = batch["property"].get("city")
            rows = []
            for record in batch["records"]:
                profile = record.get("profile") or {}
                rows.append({"source_record_id": record["profile_url"], "source_url": spec["directory_url"], "name": record["name"], "website": profile.get("website"), "phone": profile.get("phone") or record.get("phone"), "city": property_city, "address": None, "province": "ON" if property_city else None, "country": "CA" if property_city else "unknown", "location_name": record["name"] + " at " + spec["name"], "location_type": "retail", "categories": ["Shopping centre source-listed business"], "observed_at": observed_at, "supporting_excerpt": f"{spec['name']} directory lists {record['listing_label']}.", "raw_payload": {"directory_observation": record, "property_evidence_id": property_evidence, "address_basis": "Property street address is represented on the property only; individual tenant unit/address unknown", "franchise_owner": "unknown"}})
            ingestion = store.ingest(source_id, rows, run_metadata={"adapter_name": "property_sources", "parser_version": "1", "observed_at": observed_at, "coverage_complete": False, **batch["metrics"]})
            result["organisations_added"] += ingestion["inserted_count"]
            result["ingestion"] = ingestion
            for record in batch["records"]:
                identity = store.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, record["profile_url"])).fetchone()
                if not identity:
                    continue
                predicate = {"listed_future": "listed_future_tenant_at", "listed_closed": "formerly_listed_tenant_at"}.get(record["listing_status"], "tenant_at")
                relation_id = stable_id("tenant-property-observation", source_id, record["profile_url"], property_id, observed_at, predicate)
                existed = store.db.execute("SELECT 1 FROM relationships WHERE id=?", (relation_id,)).fetchone()
                store.db.execute("INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (relation_id, identity["organisation_id"], "organisation", predicate, property_id, "property", source_id, identity["last_evidence_id"], None, observed_at, "source_listed_unverified"))
                result["relationships_added"] += int(existed is None)
        else:
            publisher_row = {"source_record_id": "publisher", "source_url": spec["directory_url"], "name": spec["name"], "website": "https://" + urlsplit(spec["directory_url"]).hostname, "country": "unknown", "province": None, "observed_at": observed_at, "supporting_excerpt": "Official source publisher lists these property/project pages; specific current contracts and ownership are unverified."}
            ingestion = store.ingest(source_id, [publisher_row], run_metadata={"adapter_name": "property_sources", "parser_version": "1", "observed_at": observed_at, "coverage_complete": False, **batch["metrics"]})
            result["organisations_added"] += ingestion["inserted_count"]
            result["ingestion"] = ingestion
            publisher = store.db.execute("SELECT organisation_id FROM source_identities WHERE source_id=? AND source_record_id='publisher'", (source_id,)).fetchone()[0]
            for record in batch["records"]:
                property_id, evidence_id = property_record(record, record["profile_url"])
                relation_id = stable_id("source-listed-project", source_id, record["profile_url"], observed_at)
                existed = store.db.execute("SELECT 1 FROM relationships WHERE id=?", (relation_id,)).fetchone()
                store.db.execute("INSERT OR IGNORE INTO relationships(id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?)", (relation_id, property_id, "property", "listed_project_of", publisher, "organisation", source_id, evidence_id, None, observed_at, "source_listed_unverified"))
                result["relationships_added"] += int(existed is None)
    return result


def acquire_property_sources(output, *, specs=None, max_pages=20, profile_limit=5, max_requests=100, max_bytes=15_000_000):
    specs = specs or DEFAULT_SPECS
    destination = Path(output)
    destination.mkdir(parents=True, exist_ok=True)
    transport = Transport(max_requests=max_requests, max_bytes=max_bytes, retries=1, min_interval=.35, allowed_hosts=[urlsplit(s["directory_url"]).hostname for s in specs])
    batches = []
    for spec in specs:
        batch = inspect_property_source(transport, spec, max_pages=max_pages, profile_limit=profile_limit)
        batches.append(batch)
        (destination / (spec["id"] + ".json")).write_text(json.dumps(batch, indent=2))
        print(json.dumps({"source": spec["id"], "status": batch["status"], "records": len(batch["records"]), "metrics": batch["metrics"], "errors": batch["errors"]}), flush=True)
    manifest = {"at": stamp(), "batches": [spec["id"] + ".json" for spec in specs], "metrics": transport.metrics(), "records_observed": sum(len(b["records"]) for b in batches), "blocked_sources": [b["source"]["id"] for b in batches if b["status"] != "factual_observations_collected"], "limitations": ["Short first-party factual observations only; no open bulk-reuse licence assumed.", "Mall listings do not verify franchisees, current leases or purchasing authority.", "Project portfolio pages do not verify current contracts, ownership or unnamed tenants.", "Individual tenant units/street addresses stay unknown; property addresses have separate evidence."]}
    (destination / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return manifest


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--profile-limit", type=int, default=5)
    parser.add_argument("--max-pages", type=int, default=20)
    parser.add_argument("--max-requests", type=int, default=100)
    parser.add_argument("--max-bytes", type=int, default=15_000_000)
    parser.add_argument("--source", action="append", help="Select configured source IDs for a bounded supplemental review")
    args = parser.parse_args()
    specs = [spec for spec in DEFAULT_SPECS if not args.source or spec["id"] in args.source]
    if not specs:
        parser.error("No configured source selected")
    print(json.dumps(acquire_property_sources(args.output, specs=specs, max_pages=args.max_pages, profile_limit=args.profile_limit, max_requests=args.max_requests, max_bytes=args.max_bytes)))


if __name__ == "__main__":
    main()

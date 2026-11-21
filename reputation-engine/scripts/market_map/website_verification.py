"""Bounded public-site observations for the versioned verification pilot.

No inventory writes, guessed emails, contact messages, or paid lookups. A title
match is labelled self-identification evidence, not verified legal ownership.
"""
from __future__ import annotations

import argparse
import gzip
import hashlib
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from urllib.parse import unquote, urljoin, urlsplit

from lxml import html

from .relationships import canonical_url, excluded, identity_supported
from .transport import Transport, SourceBlocked, BudgetExceeded
from .verification_pilot import file_hash, stamp, encode, storage_guard, website_candidate

VERSION = "ssm-website-observations/1"
INTERESTING = re.compile(r"contact|about|locations?|facilities|procurement|purchas|vendor|supplier", re.I)
PARKED = re.compile(r"\b(?:this domain is for sale|buy this domain|domain (?:name )?has expired)\b", re.I)


def page_facts(body, url):
    document = html.fromstring(body, base_url=url)
    for node in document.xpath("//script|//style|//noscript"):
        node.drop_tree()
    title = " ".join(" ".join(document.xpath("//title/text() | //h1//text()")).split())[:800]
    text = " ".join(" ".join(document.itertext()).split())
    emails, phones, links = set(), set(), []
    for anchor in document.xpath("//a[@href]"):
        href = anchor.get("href", "").strip()
        label = " ".join(anchor.text_content().split())[:180]
        if href.lower().startswith("mailto:"):
            address = unquote(href[7:].split("?", 1)[0]).strip()
            if re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", address):
                emails.add(address)
        elif href.lower().startswith("tel:"):
            phones.add(unquote(href[4:]).strip())
        elif INTERESTING.search(label + " " + href):
            candidate = canonical_url(href, url)
            if candidate:
                links.append({"label": label, "url": candidate,
                              "relationship_status": "published_link_only"})
    # Only selected business facts and short excerpts are retained.
    return {"url": url, "content_sha256": hashlib.sha256(body).hexdigest(),
            "title": title, "short_excerpt": text[:400],
            "published_mailto_addresses": sorted(emails), "published_tel_values": sorted(phones),
            "relevant_links": sorted({item["url"]: item for item in links}.values(), key=lambda item: item["url"]),
            "parked_or_expired_phrase_found": bool(PARKED.search(text[:30000]))}


def prepare_jobs(pilot_path):
    pilot_path = Path(pilot_path)
    manifest = json.loads((pilot_path / "manifest.json").read_text())
    record_artifact = next(item for item in manifest["artifacts"] if item["path"] == "pilot-records.jsonl.gz")
    if file_hash(pilot_path / record_artifact["path"]) != record_artifact["sha256"]:
        raise ValueError("Pilot artifact hash mismatch")
    jobs = {}
    with gzip.open(pilot_path / record_artifact["path"], "rt", encoding="utf-8") as stream:
        for line in stream:
            row = json.loads(line)
            candidate = website_candidate(row.get("website_candidate_url"))
            if not candidate["url"]:
                continue
            host = urlsplit(candidate["url"]).hostname
            key = host.removeprefix("www.")
            job = jobs.setdefault(key, {"job_id": hashlib.sha256(key.encode()).hexdigest(), "domain": key,
                                       "candidate_urls": set(), "organisations": [], "operational_areas": set()})
            job["candidate_urls"].add(candidate["url"])
            job["operational_areas"].update(row["operational_areas"])
            job["organisations"].append({"organisation_id": row["organisation_id"], "name": row["name"],
                                          "service_labels": row["service_labels"], "location_id": row["location_id"]})
    for job in jobs.values():
        job["candidate_urls"] = sorted(job["candidate_urls"], key=lambda value: (len(value), value))
        job["operational_areas"] = sorted(job["operational_areas"])
        job["organisations"].sort(key=lambda row: row["organisation_id"])
    return sorted(jobs.values(), key=lambda job: job["job_id"]), manifest


def balanced_jobs(jobs):
    buckets, chosen = defaultdict(list), {}
    for job in jobs:
        for area in job["operational_areas"] or ["unknown"]:
            buckets[area].append(job)
    for depth in range(max((len(rows) for rows in buckets.values()), default=0)):
        for area in sorted(buckets):
            if depth < len(buckets[area]):
                job = buckets[area][depth]
                chosen.setdefault(job["job_id"], job)
    return list(chosen.values())


def observe_job(job, transport, *, max_pages=2):
    url = job["candidate_urls"][0]
    host = urlsplit(url).hostname
    allowed = {host, host.removeprefix("www."), "www." + host.removeprefix("www.")}
    result = {"job_id": job["job_id"], "domain": job["domain"], "candidate_url": url,
              "observed_at": stamp(), "status": "pending", "pages": [], "issues": [],
              "organisations": job["organisations"], "operational_areas": job["operational_areas"],
              "legal_ownership_status": "not_checked", "branch_operating_status": "not_checked",
              "phone_reachability_status": "not_checked", "email_mailbox_status": "not_checked",
              "purchasing_authority_status": "not_checked"}
    for row in result["organisations"]:
        row.update(website_name_evidence="not_established", matching_page_urls=[], location_verified_by_this_check=False)
    if excluded(host):
        result["status"] = "third_party_presence_requires_review"
        return result
    pending, visited = [url], set()
    while pending and len(visited) < max_pages:
        current = pending.pop(0)
        if current in visited:
            continue
        visited.add(current)
        storage_guard(Path.cwd())
        try:
            response = transport.fetch(current, allowed_hosts=allowed)
            content_type = next((value for key, value in response.headers.items() if key.lower() == "content-type"), "")
            if content_type and "html" not in content_type.lower():
                result["issues"].append({"url": current, "status": "non_html_requires_review"})
                continue
            facts = page_facts(response.body, response.url)
            facts["checked_at"] = stamp()
            result["pages"].append(facts)
            # Follow only an actually published, same-origin useful link.
            for link in facts["relevant_links"]:
                if urlsplit(link["url"]).hostname == urlsplit(response.url).hostname and link["url"] not in visited:
                    pending.append(link["url"])
        except (SourceBlocked, BudgetExceeded, ValueError) as error:
            result["issues"].append({"url": current, "status": "access_or_budget_or_parse_review", "reason": str(error)[:500]})
            if isinstance(error, BudgetExceeded):
                break
    if not result["pages"]:
        result["status"] = "unresolved_access_or_content"
    elif any(page["parked_or_expired_phrase_found"] for page in result["pages"]):
        result["status"] = "parked_or_expired_phrase_requires_review"
    else:
        result["status"] = "public_pages_observed"
    for row in result["organisations"]:
        matches = [page["url"] for page in result["pages"] if identity_supported(row["name"], page)]
        row["website_name_evidence"] = "heading_self_identification_match" if matches else "not_established"
        row["matching_page_urls"] = matches
        row["location_verified_by_this_check"] = False
    return result


def run_checks(pilot_path, output, *, max_domains=24, max_pages=2, transport=None, progress=None):
    if not 1 <= max_domains <= 1000 or not 1 <= max_pages <= 5:
        raise ValueError("Explicit domain/page bounds required")
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    storage_guard(output)
    jobs, pilot_manifest = prepare_jobs(pilot_path)
    pilot_hash = file_hash(Path(pilot_path) / "manifest.json")
    plan = {"version": VERSION, "pilot_manifest_sha256": pilot_hash, "jobs": jobs}
    plan_path = output / "job-plan.json"
    if plan_path.exists() and json.loads(plan_path.read_text()) != plan:
        raise ValueError("Pilot changed; use a new website-observation output revision")
    if not plan_path.exists():
        plan_path.write_text(json.dumps(plan, indent=2) + "\n")
    result_path = output / "observations.jsonl"
    completed = {}
    if result_path.exists():
        for line in result_path.read_text().splitlines():
            row = json.loads(line)
            if row["job_id"] in completed:
                raise ValueError("Duplicate website job receipt")
            completed[row["job_id"]] = row
    pending = [job for job in balanced_jobs(jobs) if job["job_id"] not in completed][:max_domains]
    transport = transport or Transport(max_requests=max_domains * (max_pages + 3), max_bytes=40_000_000,
                                       max_response_bytes=2_000_000, timeout=10, min_interval=.5, retries=0)
    progress = progress or (lambda value: None)
    invocation = {"started_at": stamp(), "domain_limit": max_domains, "page_limit_per_domain": max_pages,
                  "jobs_attempted": 0, "database_writes": 0, "messages_sent": 0}
    with result_path.open("a", encoding="utf-8") as stream:
        for job in pending:
            storage_guard(output)
            row = observe_job(job, transport, max_pages=max_pages)
            stream.write(encode(row) + "\n")
            stream.flush()
            completed[row["job_id"]] = row
            invocation["jobs_attempted"] += 1
            progress({"stage": "website_observation", "domain": job["domain"], "status": row["status"],
                      "completed_jobs": len(completed), "total_jobs": len(jobs)})
            if transport.requests >= transport.max_requests or transport.bytes_fetched >= transport.max_bytes:
                break
    invocation["completed_at"] = stamp()
    invocation["transport"] = transport.metrics()
    receipt = "invocation-" + hashlib.sha256(encode(invocation).encode()).hexdigest()[:20] + ".json"
    (output / receipt).write_text(json.dumps(invocation, indent=2) + "\n")
    report = {"version": VERSION, "updated_at": stamp(), "pilot_manifest_sha256": pilot_hash,
              "pilot_records": pilot_manifest["pilot_records"], "website_jobs": len(jobs),
              "jobs_with_observation_or_review_receipt": len(completed), "jobs_pending": len(jobs) - len(completed),
              "status_counts": dict(Counter(row["status"] for row in completed.values())),
              "latest_invocation": receipt, "observations_sha256": file_hash(result_path),
              "main_database_writes": 0, "messages_sent": 0,
              "limitations": ["Observations cover candidate domains, not every physical branch.",
                              "Heading-name matches are publisher self-identification evidence, not independently verified ownership.",
                              "Published contact links do not establish mailbox validity, phone reachability, person authority or outreach eligibility.",
                              "An access error is unresolved, not proof a business is closed."]}
    (output / "status.json").write_text(json.dumps(report, indent=2) + "\n")
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pilot", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--max-domains", type=int, default=24)
    parser.add_argument("--max-pages", type=int, default=2)
    args = parser.parse_args()
    report = run_checks(args.pilot, args.output, max_domains=args.max_domains, max_pages=args.max_pages,
                        progress=lambda value: print(encode(value), flush=True))
    print(encode(report), flush=True)


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
from __future__ import annotations

import argparse
import csv
import json
import os
import re
import subprocess
import sys
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Iterable
from urllib.parse import urlencode

from pypdf import PdfReader


MONTH_RE = re.compile(
    r"^(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$",
    re.I,
)

SENDER_PATTERNS = [
    re.compile(r"^saturn star", re.I),
    re.compile(r"^1487 ouellette", re.I),
    re.compile(r"^windsor,\s*on\s+n[0-9a-z ]+$", re.I),
    re.compile(r"^\(?226\)?"),
    re.compile(r"@"),
]


@dataclass
class ContactRecord:
    id: str
    name: str
    company: str
    title: str
    email: str | None
    phone: str | None
    website: str | None
    address: str
    city: str
    province: str
    postal_code: str | None
    industry: str
    tier: str
    tracking_code: str
    stage: str
    notes: str
    source_csv: str
    last_touch_at: str | None
    next_follow_up: str | None
    owner_name: str | None
    owner_email: str | None
    priority: str
    account_status: str
    mailed_at: str | None
    mailed_by: str | None
    meeting_booked_at: str | None
    partnership_outcome: str | None
    partnership_outcome_at: str | None
    partnership_started_at: str | None
    last_inbound_at: str | None
    referred_lead_count: int
    created_at: str


def slug(text: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", text.lower()).strip("_")


def normalize(text: str | None) -> str:
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def infer_meta(filename: str) -> dict[str, str]:
    name = filename.lower()
    if re.match(r"^\d+_", filename):
      return {"industry": "Realtors", "tier": "A", "tracking_code": "REALTOR", "category": "Ranked Agent"}
    if "realtor" in name or "agent" in name:
        return {"industry": "Realtors", "tier": "A", "tracking_code": "REALTOR", "category": "Realtor"}
    if "lawyer" in name:
        return {"industry": "Lawyers", "tier": "A", "tracking_code": "LAWYER", "category": "Lawyer"}
    if "commercial_broker" in name:
        return {"industry": "Commercial Brokers", "tier": "A", "tracking_code": "COMMBROKER", "category": "Commercial Broker"}
    if "builder" in name:
        return {"industry": "Builders", "tier": "B", "tracking_code": "BUILDER", "category": "Builder"}
    if "property_manager" in name:
        return {"industry": "Property Managers", "tier": "B", "tracking_code": "PROPMGR", "category": "Property Manager"}
    if "condo" in name:
        return {"industry": "Condo / Property Management", "tier": "B", "tracking_code": "CONDO", "category": "Condo"}
    if "storage" in name:
        return {"industry": "Storage Providers", "tier": "B", "tracking_code": "STORAGE", "category": "Storage"}
    if "corporate_relocation" in name or "diageo" in name or "hmcs_hunter" in name:
        return {"industry": "Corporate Employers", "tier": "C", "tracking_code": "CORP", "category": "Corporate"}
    if "union" in name:
        return {"industry": "Unions", "tier": "C", "tracking_code": "UNION", "category": "Union"}
    if "health_medical" in name:
        return {"industry": "Health & Medical", "tier": "C", "tracking_code": "HEALTH", "category": "Health"}
    if "newcomer" in name:
        return {"industry": "Settlement Services", "tier": "D", "tracking_code": "SETTLEMENT", "category": "Settlement"}
    if "senior" in name:
        return {"industry": "Senior Homes", "tier": "E", "tracking_code": "SENIOR", "category": "Senior Homes"}
    if "envelopes" in name:
        return {"industry": "Partnership Outreach", "tier": "B", "tracking_code": "PARTNER", "category": "Envelope Batch"}
    return {"industry": "Partnership Outreach", "tier": "B", "tracking_code": "PARTNER", "category": "Imported"}


def extract_recipient_block(text: str) -> list[str]:
    lines = [line.strip() for line in text.splitlines()]
    cleaned: list[str] = []
    started = False
    for line in lines:
        if not line:
            continue
        if not started and any(pattern.search(line) for pattern in SENDER_PATTERNS):
            continue
        started = True
        if MONTH_RE.match(line) or line.lower().startswith("dear "):
            break
        if len(line) > 120:
            break
        cleaned.append(line)
        if len(cleaned) >= 5:
            break
    return cleaned


def split_name_title(raw: str) -> tuple[str, str]:
    if "," in raw:
        name, title = raw.split(",", 1)
        return name.strip(), title.strip()
    return raw.strip(), ""


def split_city(line: str) -> tuple[str, str, str | None]:
    match = re.match(r"^(.*?),\s*([A-Z]{2})\s*([A-Z]\d[A-Z]\s?\d[A-Z]\d)?$", line.strip(), re.I)
    if match:
      city = match.group(1).strip()
      province = match.group(2).upper()
      postal = match.group(3).upper().replace(" ", "") if match.group(3) else None
      return city, province, postal
    if "," in line:
      parts = [part.strip() for part in line.split(",")]
      if len(parts) >= 2:
        return parts[0], parts[1].upper(), None
    return line.strip(), "ON", None


def parse_page(text: str, source_name: str, sent_note: str) -> ContactRecord | None:
    block = extract_recipient_block(text)
    if len(block) < 2:
        return None
    if not any("," in line and re.search(r"\bON\b|[A-Z]{2}\b", line) for line in block[-2:]):
        return None

    meta = infer_meta(source_name)
    raw_name = block[0]
    name, title = split_name_title(raw_name)

    if len(block) == 2:
        company = ""
        address_lines = [block[1]]
    else:
        company = block[1]
        address_lines = block[2:]

    if len(address_lines) == 1 and company == name:
        company = ""

    if not address_lines:
        return None

    city_line = address_lines[-1]
    street = ", ".join(line.rstrip(",") for line in address_lines[:-1]) if len(address_lines) > 1 else address_lines[0].rstrip(",")
    city, province, postal = split_city(city_line)

    source_pdf = Path(source_name).name
    notes = f"{sent_note} Imported from {source_pdf}."

    return ContactRecord(
        id=str(uuid.uuid4()),
        name=name,
        company=company if company != name else company,
        title=title,
        email=None,
        phone=None,
        website=None,
        address=street,
        city=city,
        province=province,
        postal_code=postal,
        industry=meta["industry"],
        tier=meta["tier"],
        tracking_code=meta["tracking_code"],
        stage="mail_sent",
        notes=notes,
        source_csv=source_pdf,
        last_touch_at=None,
        next_follow_up=None,
        owner_name=None,
        owner_email=None,
        priority="normal",
        account_status="active",
        mailed_at=None,
        mailed_by="Envelope batch import",
        meeting_booked_at=None,
        partnership_outcome=None,
        partnership_outcome_at=None,
        partnership_started_at=None,
        last_inbound_at=None,
        referred_lead_count=0,
        created_at=datetime.now(timezone.utc).isoformat(),
    )


def dedupe(records: Iterable[ContactRecord]) -> list[ContactRecord]:
    merged: dict[str, ContactRecord] = {}
    for record in records:
        key = "|".join([
            normalize(record.company or record.name),
            normalize(record.address),
            normalize(record.city),
        ])
        existing = merged.get(key)
        if not existing:
            merged[key] = record
            continue
        sources = sorted(set(existing.source_csv.split("; ")) | set(record.source_csv.split("; ")))
        existing.source_csv = "; ".join(sources)
        if record.title and not existing.title:
            existing.title = record.title
        if len(record.notes) > len(existing.notes):
            existing.notes = record.notes
    return list(merged.values())


def request_json(method: str, url: str, key: str, payload: object | None = None) -> object:
    cmd = [
        "curl",
        "-sS",
        "-f",
        "-X",
        method,
        url,
        "-H",
        f"apikey: {key}",
        "-H",
        f"Authorization: Bearer {key}",
        "-H",
        "Content-Type: application/json",
    ]
    if method in {"POST", "PATCH", "DELETE"}:
        cmd.extend(["-H", "Prefer: return=representation"])
    if payload is not None:
        cmd.extend(["--data", json.dumps(payload)])
    result = subprocess.run(cmd, capture_output=True, text=True, check=True)
    raw = result.stdout.strip()
    return json.loads(raw) if raw else []


def backup_existing(base_url: str, key: str, backup_dir: Path) -> None:
    backup_dir.mkdir(parents=True, exist_ok=True)
    for table in ("market_contacts", "market_touches", "market_queue"):
        url = f"{base_url}/rest/v1/{table}?select=*"
        data = request_json("GET", url, key)
        (backup_dir / f"{table}.json").write_text(json.dumps(data, indent=2), encoding="utf-8")


def delete_existing(base_url: str, key: str) -> None:
    for table in ("market_touches", "market_queue", "market_contacts"):
        params = urlencode({"id": "not.is.null"})
        url = f"{base_url}/rest/v1/{table}?{params}"
        request_json("DELETE", url, key)


def insert_contacts(base_url: str, key: str, records: list[ContactRecord]) -> None:
    url = f"{base_url}/rest/v1/market_contacts"
    for idx in range(0, len(records), 100):
        payload = [asdict(record) for record in records[idx:idx + 100]]
        request_json("POST", url, key, payload)


def export_contacts(records: list[ContactRecord], out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "parsed_contacts.json").write_text(
        json.dumps([asdict(record) for record in records], indent=2),
        encoding="utf-8",
    )
    with (out_dir / "parsed_contacts.csv").open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=list(asdict(records[0]).keys()) if records else ["id"])
        writer.writeheader()
        for record in records:
            writer.writerow(asdict(record))


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("pdfs", nargs="+", help="Envelope or letter PDFs to import")
    parser.add_argument("--apply", action="store_true", help="Replace live market_contacts data")
    args = parser.parse_args()

    base_url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_KEY")
    if args.apply and (not base_url or not key):
        print("SUPABASE_URL and SUPABASE_KEY are required for --apply", file=sys.stderr)
        return 1

    sent_note = "Already mailed before import. Sent date pending confirmation."
    parsed: list[ContactRecord] = []

    for pdf in args.pdfs:
        path = Path(pdf)
        reader = PdfReader(str(path))
        for page in reader.pages:
            text = page.extract_text() or ""
            record = parse_page(text, path.name, sent_note)
            if record:
                parsed.append(record)

    deduped = dedupe(parsed)
    archive_root = Path("/Users/admin/Downloads/Mission Control/reputation-engine/reputation-engine/change-archives")
    batch_dir = archive_root / f"{datetime.now().strftime('%Y-%m-%d')}-sent-envelope-import"
    export_contacts(deduped, batch_dir)

    summary: dict[str, int] = {}
    for record in deduped:
        summary[record.industry] = summary.get(record.industry, 0) + 1

    print(json.dumps({
        "parsed_pages": len(parsed),
        "deduped_contacts": len(deduped),
        "categories": summary,
        "output_dir": str(batch_dir),
    }, indent=2))

    if args.apply:
        assert base_url and key
        backup_dir = batch_dir / "backup-before-replace"
        backup_existing(base_url, key, backup_dir)
        delete_existing(base_url, key)
        insert_contacts(base_url, key, deduped)
        print(json.dumps({"applied": True, "backup_dir": str(backup_dir)}, indent=2))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

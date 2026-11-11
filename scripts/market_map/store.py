"""Versioned local evidence store for the Ontario commercial market map.

The store deliberately has no CRM, campaign, network or paid-service client.
Canonical records are conservative research identities, not certified legal entities.
Every source assertion remains attached to an immutable raw observation.
"""
from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import unicodedata
import uuid
import zlib
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from .contact_normalization import parse_phone_candidate


NAMESPACE = uuid.UUID("a81f34e2-681e-46a7-aaab-a774c59a6aa1")
ASSERTION_INSERT = "INSERT OR IGNORE INTO field_assertions(id,entity_id,entity_type,field_name,value_json,evidence_id,observed_at,valid_from,valid_to,method,confidence,review_status) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)"


def stamp():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def dumps(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), default=str)


def stable_id(*parts):
    return str(uuid.uuid5(NAMESPACE, dumps(parts)))


def digest(value):
    return hashlib.sha256(dumps(value).encode("utf-8")).hexdigest()


def normalise(value):
    text = unicodedata.normalize("NFKD", str(value or "")).casefold()
    return "".join(c for c in text if c.isalnum() and not unicodedata.combining(c))


def domain(value):
    text = str(value or "").strip()
    if not text:
        return None
    try:
        parsed = urlsplit(text if "://" in text else "https://" + text)
        if parsed.scheme not in ("http", "https") or parsed.username or parsed.password:
            return None
        return (parsed.hostname or "").casefold().removeprefix("www.") or None
    except ValueError:
        return None


def postal_code(value):
    compact = re.sub(r"\s+", "", str(value or "")).upper()
    return compact[:3] + " " + compact[3:] if re.fullmatch(r"[A-Z]\d[A-Z]\d[A-Z]\d", compact) else (str(value).strip() if value else None)


def phone_number(value):
    return parse_phone_candidate(value)['e164']


def iso_time(value):
    if not value:
        return stamp()
    parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def nonempty(value):
    return value is not None and value != "" and value != [] and value != {}


class MarketMap:
    def __init__(self, path):
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(self.path, timeout=30)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA foreign_keys=ON")
        self.db.execute("PRAGMA busy_timeout=30000")
        self.db.execute("PRAGMA journal_mode=WAL")
        # UUID-backed evidence indexes exceed SQLite's small default cache once
        # real city-wide sources arrive. Keep durable commits while allowing a
        # bounded 256 MiB page cache and read-only mapping of existing DB pages.
        # The SQLite build may cap the requested 2 GiB mapping; PRAGMA mmap_size
        # exposes its actual limit. Neither option weakens FULL durable commits.
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.execute("PRAGMA cache_size=-262144")
        self.db.execute("PRAGMA mmap_size=2147483648")
        self.db.execute("CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY, applied_at TEXT NOT NULL, content_hash TEXT NOT NULL)")
        self.db.commit()
        for migration in sorted((Path(__file__).parent / "migrations").glob("*.sql")):
            sql = migration.read_text()
            content_hash = hashlib.sha256(sql.encode()).hexdigest()
            prior = self.db.execute("SELECT content_hash FROM schema_migrations WHERE version=?", (migration.name,)).fetchone()
            if prior:
                if prior[0] != content_hash:
                    raise RuntimeError("Applied migration changed: " + migration.name)
                continue
            try:
                self.db.executescript("BEGIN IMMEDIATE;\n" + sql)
                self.db.execute("INSERT INTO schema_migrations VALUES(?,?,?)", (migration.name, stamp(), content_hash))
                self.db.commit()
            except Exception:
                self.db.rollback()
                raise

    def close(self):
        self.db.close()

    @contextmanager
    def transaction(self):
        """Use a savepoint inside an existing caller-owned page transaction."""
        nested = self.db.in_transaction
        savepoint = "market_map_" + uuid.uuid4().hex
        self.db.execute("SAVEPOINT " + savepoint if nested else "BEGIN IMMEDIATE")
        try:
            yield
        except Exception:
            if nested:
                self.db.execute("ROLLBACK TO SAVEPOINT " + savepoint)
                self.db.execute("RELEASE SAVEPOINT " + savepoint)
            else:
                self.db.rollback()
            raise
        else:
            if nested:
                self.db.execute("RELEASE SAVEPOINT " + savepoint)
            else:
                self.db.commit()

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        self.close()

    def upsert_source(self, source):
        source = dict(source)
        if not source.get("source_url") or not source.get("name"):
            raise ValueError("Source needs name and source_url")
        source_id = str(source.get("id") or stable_id("source", source.get("publisher"), source["source_url"]))
        allowed = {r[1] for r in self.db.execute("PRAGMA table_info(sources)")}
        now = stamp()
        fields = {k: v for k, v in source.items() if k in allowed and k not in ("id", "created_at", "updated_at")}
        for field in ("geography_scope", "sector_scope", "config_json"):
            if field in fields and not isinstance(fields[field], str):
                fields[field] = dumps(fields[field])
        if "config" in source:
            fields["config_json"] = dumps(source["config"])
        fields["updated_at"] = now
        columns = ["id", "created_at", *fields]
        placeholders = ",".join("?" for _ in columns)
        updates = ",".join(f"{column}=excluded.{column}" for column in fields)
        with self.transaction():
            self.db.execute(f"INSERT INTO sources({','.join(columns)}) VALUES({placeholders}) ON CONFLICT(id) DO UPDATE SET {updates}", [source_id, now, *fields.values()])
        return source_id

    def add_review(self, issue_type, candidate_ids=(), evidence_ids=(), reason="", *, review_id=None):
        rid = review_id or stable_id("review", issue_type, sorted(candidate_ids), reason)
        self.db.execute(
            "INSERT OR IGNORE INTO review_queue(id,issue_type,candidate_ids,evidence_ids,reason,created_at) VALUES(?,?,?,?,?,?)",
            (rid, issue_type, dumps(list(candidate_ids)), dumps(list(evidence_ids)), reason, stamp()),
        )
        # A repeated conflict adds evidence without erasing an existing resolution.
        existing = self.db.execute("SELECT evidence_ids FROM review_queue WHERE id=?", (rid,)).fetchone()
        if existing:
            merged = sorted(set(json.loads(existing[0])) | set(evidence_ids))
            self.db.execute("UPDATE review_queue SET evidence_ids=? WHERE id=?", (dumps(merged), rid))
        return rid

    @contextmanager
    def _buffer_field_assertions(self):
        """Group one batch's immutable assertions before its transaction commits.

        Identity resolution never reads field_assertions while ingesting a batch.
        A single ordered write pass improves primary-index locality without
        changing assertion IDs, values, provenance, constraints or commit scope.
        Standalone assertion helpers remain immediately visible to their caller.
        """
        previous = getattr(self, "_assertion_buffer", None)
        previous_fresh = getattr(self, "_fresh_assertion_evidence", None)
        previous_geographies = getattr(self, "_geography_resolution_cache", None)
        previous_geography_ids = getattr(self, "_known_municipality_ids", None)
        pending = []
        self._assertion_buffer = pending
        self._fresh_assertion_evidence = set()
        self._geography_resolution_cache = {}
        self._known_municipality_ids = set()
        try:
            yield
            if pending:
                self._flush_assertion_groups(pending)
        finally:
            if previous_fresh is not None:
                # A nested buffer may already have materialised assertions for
                # evidence created by the outer buffer. The outer flush must
                # then read and extend that existing group, rather than replace
                # its JSON fields under the fresh-evidence fast path.
                previous_fresh.difference_update(value[5] for value in pending)
            self._assertion_buffer = previous
            self._fresh_assertion_evidence = previous_fresh
            self._geography_resolution_cache = previous_geographies
            self._known_municipality_ids = previous_geography_ids

    def _flush_assertion_groups(self, pending):
        """Share lineage metadata without changing a single field assertion ID.

        Ingest-generated IDs encode their entity and evidence. Checking existing
        IDs within this indexed lineage preserves INSERT OR IGNORE semantics and
        avoids a random index/FK write for every field. Same-field competing
        values are retained in the legacy rows rather than overwriting JSON.
        """
        grouped = {}
        pending_ids = set()
        for parameters in pending:
            if parameters[0] in pending_ids:
                continue
            pending_ids.add(parameters[0])
            common = tuple(parameters[index] for index in (1, 2, 5, 6, 7, 8, 9, 10, 11))
            grouped.setdefault(common, []).append(parameters)
        writes = []
        fallbacks = []
        for common, assertions in grouped.items():
            entity_id, entity_type, evidence_id = common[:3]
            group_id = stable_id("field-assertion-group", *common)
            fresh = evidence_id in (getattr(self, "_fresh_assertion_evidence", None) or ())
            existing_groups = [] if fresh else self.db.execute("SELECT id,fields_json FROM field_assertion_groups WHERE entity_id=? AND evidence_id=?", (entity_id, evidence_id)).fetchall()
            fields = {}
            known = set()
            for existing in existing_groups:
                values = json.loads(existing["fields_json"])
                known.update(value["id"] for value in values.values())
                if existing["id"] == group_id:
                    fields = values
            if not fresh:
                known.update(row[0] for row in self.db.execute("SELECT id FROM field_assertions_rows WHERE entity_id=? AND entity_type=? AND evidence_id=?", (entity_id, entity_type, evidence_id)))
            changed = False
            for parameters in assertions:
                assertion_id, field_name, value_json = parameters[0], parameters[3], parameters[4]
                if assertion_id in known:
                    continue
                known.add(assertion_id)
                if field_name in fields and fields[field_name]["id"] != assertion_id:
                    fallbacks.append(parameters)
                    continue
                fields[field_name] = {"id": assertion_id, "value_json": value_json}
                changed = True
            if changed:
                writes.append((group_id, *common, dumps(fields)))
        if writes:
            self.db.executemany("INSERT INTO field_assertion_groups(id,entity_id,entity_type,evidence_id,observed_at,valid_from,valid_to,method,confidence,review_status,fields_json) VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET fields_json=excluded.fields_json", sorted(writes, key=lambda value: value[0]))
        if fallbacks:
            self.db.executemany(ASSERTION_INSERT, fallbacks)

    def assert_field(self, entity_id, entity_type, field_name, value, evidence_id, observed_at=None, *, method="source_assertion", confidence=None, review_status="unverified", valid_from=None, valid_to=None):
        if not nonempty(value):
            return None
        aid = stable_id("assertion", entity_id, entity_type, field_name, value, evidence_id)
        parameters = (aid, entity_id, entity_type, field_name, dumps(value), evidence_id, iso_time(observed_at), valid_from, valid_to, method, confidence, review_status)
        pending = getattr(self, "_assertion_buffer", None)
        if pending is None:
            self.db.execute(ASSERTION_INSERT, parameters)
        else:
            pending.append(parameters)
        return aid

    def _raw_evidence(self, source_id, run_id, row, record_key, observed_at, parser_version=None, excerpt=None):
        payload_json = dumps(row)
        original = payload_json.encode("utf-8")
        payload_hash = hashlib.sha256(original).hexdigest()
        raw_id = stable_id("raw", run_id, record_key, payload_hash)
        source_url = str(row.get("source_url") or self.db.execute("SELECT source_url FROM sources WHERE id=?", (source_id,)).fetchone()[0])
        compressed = len(original) > 2048
        reference = "sqlite:compressed_raw_payloads/" + raw_id if compressed else "sqlite:raw_records/" + raw_id
        stored_payload = dumps(self._payload_reference(raw_id, len(original), payload_hash)) if compressed else payload_json
        inserted = self.db.execute(
            "INSERT OR IGNORE INTO raw_records(id,source_id,run_id,source_record_id,source_page_url,fetched_at,source_published_at,payload_hash,original_payload_reference,parser_version,payload_json) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
            (raw_id, source_id, run_id, record_key, source_url, observed_at, row.get("source_published_at") or row.get("source_date"), payload_hash, reference, parser_version, stored_payload),
        )
        if compressed and inserted.rowcount:
            self.db.execute("INSERT INTO compressed_raw_payloads(raw_record_id,encoding,compressed_payload,original_bytes,original_hash) VALUES(?,?,?,?,?)", (raw_id, "zlib", zlib.compress(original, 6), len(original), payload_hash))
        evidence_id = stable_id("evidence", raw_id)
        if excerpt is None:
            excerpt = row.get("supporting_excerpt") or row.get("description") or " | ".join(str(row.get(k) or "") for k in ("name", "address", "city", "categories"))
        inserted_evidence = self.db.execute(
            "INSERT OR IGNORE INTO evidence(id,source_url,fetched_at,short_supporting_excerpt,content_hash,source_date,raw_record_id) VALUES(?,?,?,?,?,?,?)",
            (evidence_id, source_url, observed_at, str(excerpt)[:1500], payload_hash, row.get("source_published_at") or row.get("source_date"), raw_id),
        )
        fresh = getattr(self, "_fresh_assertion_evidence", None)
        if inserted_evidence.rowcount and fresh is not None:
            # Foreign keys prohibit an older assertion referencing evidence
            # which did not exist before this transaction's buffered write.
            fresh.add(evidence_id)
        return raw_id, evidence_id, payload_hash

    @staticmethod
    def _payload_reference(raw_record_id, original_bytes, original_hash):
        return {"$market_map_payload": "compressed_raw_payloads", "raw_record_id": raw_record_id,
                "encoding": "zlib", "original_bytes": original_bytes, "sha256": original_hash}

    def get_raw_payload(self, raw_record_id):
        """Return the complete original JSON row, checking its stored SHA-256."""
        raw = self.db.execute("SELECT payload_json,payload_hash,original_payload_reference FROM raw_records WHERE id=?", (raw_record_id,)).fetchone()
        if not raw:
            raise KeyError("Unknown raw record: " + str(raw_record_id))
        if raw["original_payload_reference"].startswith("sqlite:compressed_raw_payloads/"):
            payload = self.db.execute("SELECT * FROM compressed_raw_payloads WHERE raw_record_id=?", (raw_record_id,)).fetchone()
            if not payload or payload["encoding"] != "zlib":
                raise ValueError("Missing or unsupported compressed raw payload: " + str(raw_record_id))
            original = zlib.decompress(payload["compressed_payload"])
            if len(original) != payload["original_bytes"] or hashlib.sha256(original).hexdigest() != payload["original_hash"]:
                raise ValueError("Compressed raw payload integrity check failed: " + str(raw_record_id))
            if payload["original_hash"] != raw["payload_hash"]:
                raise ValueError("Compressed payload does not match original raw-record hash")
        else:
            original = raw["payload_json"].encode("utf-8")
        if hashlib.sha256(original).hexdigest() != raw["payload_hash"]:
            raise ValueError("Original raw payload hash mismatch: " + str(raw_record_id))
        return json.loads(original)

    def compact_existing_raw(self, *, batch_size=1000, threshold_bytes=2048, max_batches=None):
        """Losslessly compress existing large rows in independently durable batches.

        No VACUUM or duplicate DB copy is needed. Updated rows release pages for
        reuse by subsequent imports. Re-running safely skips compressed records.
        Hash mismatches remain untouched and enter review instead of being erased.
        """
        if not 1 <= batch_size <= 10000 or threshold_bytes < 256 or (max_batches is not None and max_batches < 1):
            raise ValueError("Invalid compaction bounds")
        if self.db.in_transaction:
            raise RuntimeError("Compaction requires its own short batch transactions")
        result = {"scanned_rows": 0, "compressed_rows": 0, "original_bytes": 0, "compressed_bytes": 0,
                  "reference_bytes": 0, "batches": 0, "hash_mismatches": [], "complete": False}
        cursor = 0
        while max_batches is None or result["batches"] < max_batches:
            rows = self.db.execute("SELECT rowid,id,payload_json,payload_hash FROM raw_records WHERE rowid>? AND LENGTH(CAST(payload_json AS BLOB))>? AND original_payload_reference NOT LIKE 'sqlite:compressed_raw_payloads/%' ORDER BY rowid LIMIT ?", (cursor, threshold_bytes, batch_size)).fetchall()
            if not rows:
                result["complete"] = True
                break
            with self.transaction():
                for row in rows:
                    cursor = row["rowid"]
                    result["scanned_rows"] += 1
                    original = row["payload_json"].encode("utf-8")
                    actual_hash = hashlib.sha256(original).hexdigest()
                    if actual_hash != row["payload_hash"]:
                        result["hash_mismatches"].append(row["id"])
                        self.add_review("raw_payload_hash_mismatch", [row["id"]], [], "Stored raw payload does not match its original hash; preserve unchanged for investigation")
                        continue
                    packed = zlib.compress(original, 6)
                    reference = dumps(self._payload_reference(row["id"], len(original), actual_hash))
                    self.db.execute("INSERT OR IGNORE INTO compressed_raw_payloads(raw_record_id,encoding,compressed_payload,original_bytes,original_hash) VALUES(?,?,?,?,?)", (row["id"], "zlib", packed, len(original), actual_hash))
                    self.db.execute("UPDATE raw_records SET payload_json=?,original_payload_reference=? WHERE id=?", (reference, "sqlite:compressed_raw_payloads/" + row["id"], row["id"]))
                    result["compressed_rows"] += 1
                    result["original_bytes"] += len(original)
                    result["compressed_bytes"] += len(packed)
                    result["reference_bytes"] += len(reference.encode("utf-8"))
            result["batches"] += 1
        result["last_rowid"] = cursor
        result["logical_bytes_saved"] = result["original_bytes"] - result["compressed_bytes"] - result["reference_bytes"]
        return result

    def record_evidence(self, source_id, payload, source_url=None, observed_at=None, run_id=None, source_record_id=None, excerpt=None):
        """Store a bounded page/excerpt observation for relationship extractors.

        Callers should use ``with store.db:`` to group this with their assertions.
        Payloads must contain only the permitted source material needed for evidence.
        """
        row = dict(payload) if isinstance(payload, dict) else {"payload": payload}
        if source_url:
            row["source_url"] = source_url
        observed = iso_time(observed_at or row.get("observed_at"))
        record_key = str(source_record_id or row.get("source_record_id") or row.get("source_url") or digest(row))
        run_id = run_id or stable_id("evidence-run", source_id, record_key, row, observed)
        self.db.execute(
            "INSERT OR IGNORE INTO source_runs(id,source_id,started_at,completed_at,status,fetched_count,parsed_count,fingerprint) VALUES(?,?,?,?,?,?,?,?)",
            (run_id, source_id, observed, observed, "evidence_only", 1, 1, digest(row)),
        )
        return self._raw_evidence(source_id, run_id, row, record_key, observed, excerpt=excerpt)[1]

    @staticmethod
    def _identity(row):
        return {
            "name": normalise(row.get("legal_name") or row.get("name") or row.get("trading_name")),
            "domain": domain(row.get("website") or row.get("primary_domain")),
            "address": normalise(row.get("address") or row.get("address_raw")),
            "city": normalise(row.get("city") or row.get("city_raw")),
            "unit": normalise(row.get("unit")),
            "postal_code": normalise(row.get("postal_code")),
            "registration_id": normalise(row.get("registration_id")),
            "registration_jurisdiction": normalise(row.get("registration_jurisdiction")),
        }

    @staticmethod
    def _record_key(row):
        for field in ("source_record_id", "external_id"):
            if nonempty(row.get(field)):
                return str(row[field])
        # A directory's root URL is commonly shared by all its rows. Composite
        # fallbacks prevent one URL from collapsing unrelated companies.
        identity = MarketMap._identity(row)
        return "composite:" + digest({"url": row.get("source_url"), **identity})

    def _find_identity(self, source_id, record_key, row, identity, evidence_id):
        linked = self.db.execute("SELECT * FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, record_key)).fetchone()
        if linked:
            before = json.loads(linked["identity_json"])
            conflicts = [k for k in identity if before.get(k) and identity.get(k) and before[k] != identity[k]]
            if conflicts:
                self.add_review("source_identity_changed", [linked["organisation_id"]], [linked["first_evidence_id"], evidence_id], "Source record identity changed: " + ", ".join(conflicts), review_id=stable_id("identity-conflict", source_id, record_key))
                return linked["organisation_id"], linked["location_id"], "quarantined", "Source identity changed; canonical record retained"
            return linked["organisation_id"], linked["location_id"], "existing", "Stable source-scoped identifier"
        # Registration IDs require their jurisdiction. Domain, company name,
        # address or phone alone never resolves an organisation.
        if identity["registration_id"] and identity["registration_jurisdiction"]:
            matches = self.db.execute("SELECT id FROM organisations WHERE registration_id=? AND registration_jurisdiction=?", (identity["registration_id"], identity["registration_jurisdiction"])).fetchall()
            if len(matches) == 1:
                return matches[0][0], None, "matched", "Matching registration identifier and jurisdiction"
        matches = []
        if not row.get("force_separate") and row.get("entity_type") not in ("franchisee", "brand") and all(identity[k] for k in ("name", "domain", "address", "city")):
            matches = self.db.execute(
                "SELECT DISTINCT o.id FROM organisations o JOIN locations l ON l.organisation_id=o.id WHERE o.name_normalized=? AND o.primary_domain=? AND l.address_normalized=? AND l.city_normalized=? AND COALESCE(l.unit,'')=? AND o.entity_type NOT IN ('franchisee','brand')",
                (identity["name"], identity["domain"], identity["address"], identity["city"], str(row.get("unit") or "")),
            ).fetchall()
            if len(matches) == 1:
                return matches[0][0], None, "matched", "Exact source name, domain, full address, locality and unit corroboration"
        possible = self.db.execute(
            "SELECT DISTINCT o.id FROM organisations o LEFT JOIN locations l ON l.organisation_id=o.id WHERE o.name_normalized=? AND ((o.primary_domain=? AND ? IS NOT NULL) OR (l.city_normalized=? AND ?<>'')) LIMIT 20",
            (identity["name"], identity["domain"], identity["domain"], identity["city"], identity["city"]),
        ).fetchall()
        org_id = stable_id("organisation", source_id, record_key)
        if possible or len(matches) > 1:
            self.add_review("ambiguous_identity", [org_id, *[r[0] for r in possible]], [evidence_id], "Possible related organisation/site; insufficient evidence for a merge")
        return org_id, None, "new", "Independent provisional identity; no sufficient cross-source match"

    def _ensure_location(self, organisation_id, row, identity, observed_at, evidence_id, preferred_id=None, *, new_organisation=False):
        # No physical-location record is fabricated from a company name alone.
        if not any(nonempty(row.get(k)) for k in ("address", "address_raw", "city", "city_raw", "postal_code", "latitude", "longitude")):
            return None, False
        location = self.db.execute("SELECT * FROM locations WHERE id=?", (preferred_id,)).fetchone() if preferred_id else None
        if not location and not new_organisation:
            candidates = self.db.execute(
                "SELECT * FROM locations WHERE organisation_id=? AND COALESCE(address_normalized,'')=? AND COALESCE(city_normalized,'')=? AND COALESCE(unit,'')=?",
                (organisation_id, identity["address"], identity["city"], str(row.get("unit") or "")),
            ).fetchall()
            if len(candidates) == 1:
                location = candidates[0]
        municipality_id = row.get("municipality_id")
        city = row.get("city_raw") or row.get("city")
        geography_cache = getattr(self, "_geography_resolution_cache", None)
        known_municipalities = getattr(self, "_known_municipality_ids", None)
        if not municipality_id and city:
            try:
                from .geography import resolve_geography, municipality_for
                locality_name = row.get("municipality_name") or row.get("city") or city
                geography_key = (str(locality_name), str(row.get("region") or ""))
                municipality_id = geography_cache.get(geography_key) if geography_cache is not None else None
                if not municipality_id:
                    locality_id = resolve_geography(self, locality_name, region=row.get("region"))
                    municipality_id = municipality_for(self, locality_id) if locality_id else None
                    if municipality_id and geography_cache is not None:
                        geography_cache[geography_key] = municipality_id
                        known_municipalities.add(municipality_id)
            except ImportError:
                pass
        if municipality_id and (known_municipalities is None or municipality_id not in known_municipalities):
            if not self.db.execute("SELECT 1 FROM geographies WHERE id=?", (municipality_id,)).fetchone():
                self.add_review("unknown_geography_id", [organisation_id], [evidence_id], "Unknown geography identifier: " + str(municipality_id))
                municipality_id = None
            elif known_municipalities is not None:
                known_municipalities.add(municipality_id)
        fields = {
            "location_name": row.get("location_name"), "address_raw": row.get("address") or row.get("address_raw"),
            "street": row.get("street"), "unit": row.get("unit"), "city_raw": city,
            "municipality_id": municipality_id, "region": row.get("region"),
            "province": row.get("province") if "province" in row else ("ON" if row.get("country", "CA") in ("CA", "Canada") else None), "postal_code": postal_code(row.get("postal_code")),
            "country": (row.get("country") or None) if "country" in row else "CA", "latitude": row.get("latitude"), "longitude": row.get("longitude"),
            "coordinates_source": row.get("coordinates_source"),
        }
        if location:
            location_id = location["id"]
            # Only fill unknowns. Verified/manual values are never overwritten.
            if not location["manually_verified"]:
                updates = {k: v for k, v in fields.items() if nonempty(v) and not nonempty(location[k])}
                updates.update({"address_normalized": identity["address"] or location["address_normalized"], "city_normalized": identity["city"] or location["city_normalized"]})
                self.db.execute("UPDATE locations SET " + ",".join(k + "=?" for k in updates) + " WHERE id=?", [*updates.values(), location_id])
            self.db.execute("UPDATE locations SET first_seen_at=MIN(first_seen_at,?),last_seen_at=MAX(last_seen_at,?) WHERE id=?", (observed_at, observed_at, location_id))
            return location_id, False
        location_id = stable_id("location", organisation_id, identity["address"], identity["city"], identity["unit"], identity["postal_code"])
        columns = ["id", "organisation_id", "location_type", "first_seen_at", "last_seen_at", "address_normalized", "city_normalized", *fields]
        self.db.execute("INSERT INTO locations(" + ",".join(columns) + ") VALUES(" + ",".join("?" for _ in columns) + ")", [location_id, organisation_id, row.get("location_type") or "unknown", observed_at, observed_at, identity["address"], identity["city"], *fields.values()])
        return location_id, True

    def _assert_row(self, org_id, location_id, row, evidence_id, observed_at, quarantined=False):
        status = "conflicting" if quarantined else "unverified"
        for field in ("name", "legal_name", "trading_name", "description", "website", "entity_type", "organisation_size_band", "size_evidence", "registration_id", "registration_jurisdiction", "country"):
            self.assert_field(org_id, "organisation", field, row.get(field), evidence_id, observed_at, review_status=status)
        for field in ("address", "address_raw", "street", "unit", "city", "city_raw", "postal_code", "province", "region", "municipality_id", "municipality_name", "latitude", "longitude", "coordinates_source", "location_type"):
            if location_id:
                self.assert_field(location_id, "location", field, row.get(field), evidence_id, observed_at, review_status=status)
        if quarantined:
            return
        aliases = [row.get("name"), row.get("legal_name"), row.get("trading_name"), *row.get("aliases", [])]
        for alias in filter(None, aliases):
            self.db.execute("INSERT OR IGNORE INTO organisation_aliases(id,organisation_id,alias,alias_type,evidence_id) VALUES(?,?,?,?,?)", (stable_id("alias", org_id, alias, evidence_id), org_id, str(alias), "source_name", evidence_id))
        found_domain = domain(row.get("website") or row.get("primary_domain"))
        if found_domain:
            self.db.execute("INSERT OR IGNORE INTO domains VALUES(?,?,?,?,?)", (stable_id("domain", org_id, found_domain, evidence_id), found_domain, org_id, "source_reported", evidence_id))
        categories = row.get("categories") or []
        categories = [categories] if isinstance(categories, str) else categories
        for category in categories:
            if not nonempty(category):
                continue
            self.db.execute("INSERT OR IGNORE INTO classifications(id,entity_id,entity_type,taxonomy,category,classification_method,confidence,evidence_id,review_status) VALUES(?,?,?,?,?,?,?,?,?)", (stable_id("classification", org_id, category, evidence_id), org_id, "organisation", row.get("taxonomy") or "source_category", str(category), "source_assertion", None, evidence_id, "unverified"))
        naics = row.get("naics") or row.get("naics_code")
        if naics:
            taxonomy = row.get("naics_taxonomy") or ("NAICS-" + str(row["naics_version"]) if row.get("naics_version") else "NAICS-unspecified-version")
            self.db.execute("INSERT OR IGNORE INTO classifications(id,entity_id,entity_type,taxonomy,category,classification_method,confidence,evidence_id,review_status) VALUES(?,?,?,?,?,?,?,?,?)", (stable_id("naics", org_id, naics, evidence_id), org_id, "organisation", taxonomy, str(naics), "source_assertion", None, evidence_id, "unverified"))
        channels = []
        phone_candidates = []
        for field, kind in (("email", "email"), ("phone", "phone"), ("published_emails", "email"), ("published_phones", "phone")):
            values = (row.get('phone_raw', row.get(field)) if field == 'phone' else row.get(field)) or []
            values = [values] if isinstance(values, (str, int, dict)) else values
            for value in values:
                if kind == 'phone':
                    observation = value if isinstance(value, dict) else {'raw_value': value}
                    raw = observation.get('raw_value', observation.get('phone', observation.get('value', '')))
                    parsed = parse_phone_candidate(raw)
                    extension = str(observation.get('extension') or (row.get('phone_extension') if field == 'phone' else '') or '')
                    if extension:
                        if not re.fullmatch(r'[0-9]{1,10}', extension) or (parsed['extension'] and parsed['extension'] != extension):
                            parsed.update(e164=None, status='invalid', reason='invalid_or_conflicting_extension')
                        elif not parsed['extension']:
                            parsed['extension'] = extension
                    phone_kind = observation.get('kind', 'phone')
                    if phone_kind not in ('phone', 'fax'):
                        parsed.update(e164=None, status='unsupported', reason='unsupported_channel_kind')
                    phone_candidates.append((parsed, str(phone_kind)))
                    continue
                value = str(value).strip()
                if kind == "email":
                    value = value.removeprefix("mailto:").split("?", 1)[0].strip().casefold()
                    if not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", value):
                        self.add_review("invalid_contact_channel", [org_id], [evidence_id], "Invalid published email value retained in raw evidence")
                        continue
                if value:
                    channels.append((kind, value))
        source_url = self.db.execute("SELECT source_url FROM evidence WHERE id=?", (evidence_id,)).fetchone()[0]
        for kind, value in set(channels):
            self.db.execute("INSERT OR IGNORE INTO contact_channels(id,organisation_id,location_id,channel_type,value,published_context,source_url,observed_at,verification_status,outreach_eligibility,suppression_status,evidence_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (stable_id("channel", org_id, location_id, kind, value, evidence_id), org_id, location_id, kind, value, row.get("published_context") or "Published source listing; relevance and permission unverified", source_url, observed_at, "source_reported", "research_only", row.get("suppression_status") or "unknown", evidence_id))
        for parsed, kind in phone_candidates:
            channel_id = None
            if parsed['e164']:
                parts = ('channel', org_id, location_id, kind, parsed['e164'], evidence_id)
                channel_id = stable_id(*parts, 'extension', parsed['extension']) if parsed['extension'] else stable_id(*parts)
                self.db.execute("INSERT OR IGNORE INTO contact_channels(id,organisation_id,location_id,channel_type,value,published_context,source_url,observed_at,verification_status,outreach_eligibility,suppression_status,evidence_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
                    (channel_id, org_id, location_id, kind, parsed['e164'], row.get('published_context') or 'Published source listing; relevance and permission unverified', source_url, observed_at, 'source_reported', 'research_only', row.get('suppression_status') or 'unknown', evidence_id))
                self.db.execute('INSERT OR IGNORE INTO phone_channel_details VALUES(?,?,?,?,?,?)',
                    (channel_id, parsed['raw_value'], parsed['e164'], parsed['extension'], parsed['status'], parsed['normalization_version']))
            else:
                self.add_review('invalid_contact_channel', [org_id], [evidence_id], 'Published phone retained for review: ' + parsed['reason'])
            self.db.execute('INSERT OR IGNORE INTO phone_observations VALUES(?,?,?,?,?,?,?,?,?,?)',
                (stable_id('phone-observation', org_id, evidence_id, parsed, kind), org_id, evidence_id, channel_id,
                 parsed['raw_value'], parsed['extension'], parsed['status'], parsed['reason'], parsed['normalization_version'], kind))

    def ingest(self, source_id, rows, *, run_metadata=None):
        """Atomically ingest one bounded batch; replaying it preserves entity IDs.

        An explicit observation timestamp represents a fresh observation even
        when the content is unchanged. With no fresh timestamp, identical input
        is a replay. Persisted cursor checkpoints describe this committed batch.
        """
        source = self.db.execute("SELECT * FROM sources WHERE id=?", (source_id,)).fetchone()
        if not source:
            raise ValueError("Unknown source: " + str(source_id))
        rows = list(rows)
        if not all(isinstance(row, dict) for row in rows):
            raise ValueError("Rows must be dictionaries")
        metadata = dict(run_metadata or {})
        if float(metadata.get("estimated_cost") or 0) < 0:
            raise ValueError("Negative estimated cost")
        # Transport meters do not turn a cache replay into fresh evidence.
        identity_meta = {k: metadata[k] for k in ("observed_at", "captured_at", "started_at", "source_date", "adapter_name", "parser_version", "cursor_checkpoint", "batch_id", "attempt_id") if k in metadata}
        fingerprint = digest({"source": source_id, "rows": sorted(rows, key=dumps), "metadata": identity_meta})
        run_id = str(metadata.get("run_id") or stable_id("source-run", source_id, fingerprint))
        old = self.db.execute("SELECT * FROM source_runs WHERE id=?", (run_id,)).fetchone()
        if old:
            if old["fingerprint"] != fingerprint:
                raise ValueError("run_id already belongs to a different batch; use a new batch_id/run_id")
            if old["status"] in ("completed", "partial", "ingested", "fixture", "replayed"):
                return {**json.loads(old["result_json"]), "replayed": True}
        observed_default = iso_time(metadata.get("observed_at") or metadata.get("captured_at") or metadata.get("started_at"))
        result = {
            "run_id": run_id, "source_id": source_id, "status": metadata.get("status") or "completed",
            "fetched_count": len(rows), "parsed_count": len(rows), "candidate_count": 0,
            "inserted_count": 0, "updated_count": 0, "duplicate_count": 0, "quarantined_count": 0,
            "error_count": 0, "new_locations": 0, "matched_count": 0,
            "requests": int(metadata.get("requests") or 0), "bytes_fetched": int(metadata.get("bytes_fetched") or 0),
            "estimated_cost": float(metadata.get("estimated_cost") or 0),
            "coverage_complete": bool(metadata.get("coverage_complete", False)), "cursor_checkpoint": metadata.get("cursor_checkpoint"),
        }
        with self.transaction(), self._buffer_field_assertions():
            self.db.execute("INSERT OR REPLACE INTO source_runs(id,source_id,started_at,status,cursor_checkpoint,bytes_fetched,estimated_cost,requests,browser_pages,token_count,model_tokens,elapsed_seconds,runtime_seconds,coverage_complete,expected_count,adapter_name,parser_version,fingerprint,metadata_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (run_id, source_id, observed_default, "running", dumps(metadata.get("cursor_checkpoint")) if metadata.get("cursor_checkpoint") is not None else None, result["bytes_fetched"], result["estimated_cost"], result["requests"], int(metadata.get("browser_pages") or 0), int(metadata.get("token_count") or metadata.get("model_tokens") or 0), int(metadata.get("model_tokens") or metadata.get("token_count") or 0), metadata.get("elapsed_seconds") or metadata.get("runtime_seconds"), metadata.get("runtime_seconds") or metadata.get("elapsed_seconds"), int(result["coverage_complete"]), metadata.get("expected_count"), metadata.get("adapter_name") or source["adapter_name"], metadata.get("parser_version"), fingerprint, dumps(metadata)))
            seen = set()
            orgs = set()
            locations = set()
            for original_row in rows:
                row = dict(original_row)
                row.setdefault("raw_payload", dict(original_row))
                row["name"] = str(row.get("name") or row.get("trading_name") or row.get("legal_name") or "").strip()
                record_key = self._record_key(row)
                observed_at = iso_time(row.get("observed_at") or row.get("checked_at") or metadata.get("observed_at") or metadata.get("captured_at") or observed_default)
                raw_id, evidence_id, payload_hash = self._raw_evidence(source_id, run_id, row, record_key, observed_at, metadata.get("parser_version"))
                if (record_key, payload_hash) in seen:
                    result["duplicate_count"] += 1
                    continue
                seen.add((record_key, payload_hash))
                if not row["name"] or row.get("status") == "fetch_error":
                    self.add_review("invalid_source_record", [], [evidence_id], "Missing organisation name or failed source fetch")
                    self.db.execute("INSERT INTO source_run_items VALUES(?,?,?,?,?,?,?)", (run_id, record_key, payload_hash, raw_id, None, None, "quarantined"))
                    result["quarantined_count"] += 1
                    continue
                result["candidate_count"] += 1
                identity = self._identity(row)
                org_id, location_id, outcome, reason = self._find_identity(source_id, record_key, row, identity, evidence_id)
                if outcome == "new":
                    self.db.execute("INSERT INTO organisations(id,legal_name,trading_name,description,entity_type,organisation_size_band,size_evidence,primary_domain,country,first_seen_at,last_seen_at,name_normalized,registration_id,registration_jurisdiction) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)", (org_id, row.get("legal_name"), row["name"], row.get("description"), row.get("entity_type") or "company", row.get("organisation_size_band"), row.get("size_evidence"), identity["domain"], (row.get("country") or None) if "country" in row else "CA", observed_at, observed_at, identity["name"], identity["registration_id"] or None, identity["registration_jurisdiction"] or None))
                    result["inserted_count"] += 1
                elif outcome == "quarantined":
                    self._assert_row(org_id, location_id, row, evidence_id, observed_at, quarantined=True)
                    self.db.execute("INSERT INTO source_run_items VALUES(?,?,?,?,?,?,?)", (run_id, record_key, payload_hash, raw_id, org_id, location_id, outcome))
                    result["quarantined_count"] += 1
                    continue
                else:
                    org = self.db.execute("SELECT * FROM organisations WHERE id=?", (org_id,)).fetchone()
                    if not org["manually_verified"]:
                        fills = {k: row.get(k) for k in ("legal_name", "description", "organisation_size_band", "size_evidence") if nonempty(row.get(k)) and not nonempty(org[k])}
                        if identity["domain"] and not org["primary_domain"]:
                            fills["primary_domain"] = identity["domain"]
                        if fills:
                            self.db.execute("UPDATE organisations SET " + ",".join(k + "=?" for k in fills) + " WHERE id=?", [*fills.values(), org_id])
                    result["updated_count"] += 1
                    result["matched_count"] += int(outcome == "matched")
                location_id, is_new_location = self._ensure_location(org_id, row, identity, observed_at, evidence_id, location_id, new_organisation=outcome == "new")
                result["new_locations"] += int(is_new_location)
                self.db.execute("UPDATE organisations SET first_seen_at=MIN(first_seen_at,?),last_seen_at=MAX(last_seen_at,?) WHERE id=?", (observed_at, observed_at, org_id))
                existing = self.db.execute("SELECT identity_json FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, record_key)).fetchone()
                prior_identity = json.loads(existing[0]) if existing else {}
                combined_identity = {k: prior_identity.get(k) or v for k, v in identity.items()}
                self.db.execute("INSERT INTO source_identities VALUES(?,?,?,?,?,?,?) ON CONFLICT(source_id,source_record_id) DO UPDATE SET location_id=COALESCE(source_identities.location_id,excluded.location_id),identity_json=excluded.identity_json,last_evidence_id=excluded.last_evidence_id", (source_id, record_key, org_id, location_id, dumps(combined_identity), evidence_id, evidence_id))
                self.db.execute("INSERT OR IGNORE INTO external_ids VALUES(?,?,?,?,?,?)", (stable_id("external", source_id, record_key), org_id, "organisation", source_id, record_key, evidence_id))
                self._assert_row(org_id, location_id, row, evidence_id, observed_at)
                if outcome in ("new", "matched"):
                    self.db.execute("INSERT OR IGNORE INTO identity_audit(id,action,entity_id,evidence_id,reason,after_json,observed_at) VALUES(?,?,?,?,?,?,?)", (stable_id("identity", evidence_id, org_id), "created" if outcome == "new" else "source_linked", org_id, evidence_id, reason, dumps(identity), observed_at))
                self.db.execute("INSERT INTO source_run_items VALUES(?,?,?,?,?,?,?)", (run_id, record_key, payload_hash, raw_id, org_id, location_id, outcome))
                orgs.add(org_id)
                if location_id:
                    locations.add(location_id)
            result["unique_organisations"] = len(orgs)
            result["unique_locations"] = len(locations)
            result["net_new_yield"] = result["inserted_count"] / result["candidate_count"] if result["candidate_count"] else None
            expected = metadata.get("expected_count")
            if expected is not None and metadata.get("coverage_complete") and len(seen) != int(expected):
                result["coverage_complete"] = False
                result["status"] = "partial"
                self.add_review("source_count_mismatch", [], [], f"Source {source_id} reported {expected} records; batch contained {len(seen)} unique source records")
            if result["quarantined_count"] and result["status"] == "completed":
                result["status"] = "partial"
            self.db.execute("UPDATE source_runs SET completed_at=?,status=?,fetched_count=?,parsed_count=?,candidate_count=?,inserted_count=?,updated_count=?,duplicate_count=?,quarantined_count=?,error_count=?,coverage_complete=?,result_json=? WHERE id=?", (stamp(), result["status"], result["fetched_count"], result["parsed_count"], result["candidate_count"], result["inserted_count"], result["updated_count"], result["duplicate_count"], result["quarantined_count"], result["error_count"], int(result["coverage_complete"]), dumps(result), run_id))
            self.db.execute("UPDATE sources SET last_checked_at=?,last_success_at=?,retrieval_status=?,updated_at=? WHERE id=?", (observed_default, observed_default, "ingested" if result["coverage_complete"] else "partially_ingested", stamp(), source_id))
        return result

    def record_run_failure(self, source_id, error, *, run_metadata=None, status="blocked"):
        metadata = dict(run_metadata or {})
        now = stamp()
        run_id = str(metadata.get("run_id") or uuid.uuid4())
        with self.transaction():
            self.db.execute("INSERT INTO source_runs(id,source_id,started_at,completed_at,status,error_count,error_message,requests,bytes_fetched,estimated_cost,cursor_checkpoint,metadata_json,result_json) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", (run_id, source_id, iso_time(metadata.get("started_at") or now), now, status, 1, str(error), int(metadata.get("requests") or 0), int(metadata.get("bytes_fetched") or 0), float(metadata.get("estimated_cost") or 0), dumps(metadata.get("cursor_checkpoint")), dumps(metadata), dumps({"status": status, "error": str(error)})))
            self.db.execute("UPDATE sources SET retrieval_status=?,last_checked_at=?,updated_at=? WHERE id=?", (status, now, now, source_id))
        return {"run_id": run_id, "source_id": source_id, "status": status, "error": str(error)}

    def record_resolution(self, left_id, right_id, decision, *, evidence_ids, reviewer, reason):
        """Append a reversible reviewed identity link; never delete either record.

        A same-organisation decision does not retroactively rewrite raw evidence,
        CRM links, source IDs or physical-location counts. Consumers may choose
        explicitly to group reviewed identities, with this decision as evidence.
        """
        decisions = {"same_organisation", "different_organisation", "same_parent", "same_site", "uncertain"}
        if decision not in decisions or left_id == right_id:
            raise ValueError("Invalid identity resolution")
        if not reviewer or not reason or not evidence_ids:
            raise ValueError("Identity resolution needs reviewer, reason and source evidence")
        for entity_id in (left_id, right_id):
            if not self.db.execute("SELECT 1 FROM organisations WHERE id=?", (entity_id,)).fetchone():
                raise ValueError("Unknown organisation: " + str(entity_id))
        for evidence_id in evidence_ids:
            if not self.db.execute("SELECT 1 FROM evidence WHERE id=?", (evidence_id,)).fetchone():
                raise ValueError("Unknown evidence: " + str(evidence_id))
        left_id, right_id = sorted((left_id, right_id))
        link_id = stable_id("reviewed-resolution", left_id, right_id, decision, sorted(evidence_ids), reviewer, reason)
        now = stamp()
        with self.transaction():
            self.db.execute("INSERT OR IGNORE INTO organisation_resolution_links(id,left_organisation_id,right_organisation_id,decision,evidence_ids,reviewer,reason,recorded_at) VALUES(?,?,?,?,?,?,?,?)", (link_id, left_id, right_id, decision, dumps(sorted(evidence_ids)), reviewer, reason, now))
            self.db.execute("INSERT OR IGNORE INTO identity_audit(id,action,entity_id,related_entity_id,evidence_id,reason,after_json,observed_at) VALUES(?,?,?,?,?,?,?,?)", (stable_id("resolution-audit", link_id), "reviewed_resolution", left_id, right_id, evidence_ids[0], reason, dumps({"link_id": link_id, "decision": decision, "reviewer": reviewer}), now))
        return link_id

    def reverse_resolution(self, resolution_id, *, reviewer, reason):
        if not reviewer or not reason:
            raise ValueError("Resolution reversal needs reviewer and reason")
        now = stamp()
        with self.transaction():
            link = self.db.execute("SELECT * FROM organisation_resolution_links WHERE id=?", (resolution_id,)).fetchone()
            if not link:
                raise ValueError("Unknown resolution link")
            if not link["active"]:
                return {"resolution_id": resolution_id, "replayed": True, "active": False}
            self.db.execute("UPDATE organisation_resolution_links SET active=0,reversed_at=?,reversed_by=?,reversal_reason=? WHERE id=?", (now, reviewer, reason, resolution_id))
            self.db.execute("UPDATE identity_audit SET reversed_at=?,reversal_reason=? WHERE id=?", (now, reason, stable_id("resolution-audit", resolution_id)))
            self.db.execute("INSERT INTO identity_audit(id,action,entity_id,related_entity_id,reason,before_json,after_json,observed_at) VALUES(?,?,?,?,?,?,?,?)", (str(uuid.uuid4()), "resolution_reversed", link["left_organisation_id"], link["right_organisation_id"], reason, dumps({"link_id": resolution_id, "active": True}), dumps({"active": False, "reviewer": reviewer}), now))
        return {"resolution_id": resolution_id, "active": False}

    def backfill_legacy(self, path):
        """Import V2 observations through a read-only connection, never its CRM state.

        IDs are retained as external mappings, and original source snapshots,
        observation times, run provenance and unknown historical costs survive.
        """
        legacy_path = Path(path).resolve()
        connection = sqlite3.connect(legacy_path.as_uri() + "?mode=ro", uri=True)
        connection.row_factory = sqlite3.Row
        results = []
        legacy_to_new = {}
        try:
            for legacy_run in connection.execute("SELECT * FROM runs ORDER BY captured_at,id").fetchall():
                source_id = "legacy-v2:" + str(legacy_run["source"])
                first_url = connection.execute("SELECT source_url FROM observations WHERE run_id=? LIMIT 1", (legacy_run["id"],)).fetchone()
                existing = self.db.execute("SELECT id FROM sources WHERE id=?", (source_id,)).fetchone()
                if not existing:
                    # A local capture timestamp is not a publisher revision.
                    # The legacy Overture source explicitly identifies its
                    # published release; other sources keep publication unknown.
                    publisher_date = None
                    release = re.search(r"(?i)^overture[:_-](20\d{2}-\d{2}-\d{2})\.\d+(?:$|[:_-])", str(legacy_run["source"]))
                    if release:
                        try:
                            publisher_date = datetime.strptime(release.group(1), "%Y-%m-%d").date().isoformat()
                        except ValueError:
                            pass
                    self.upsert_source({"id": source_id, "name": "Legacy V2: " + legacy_run["source"], "publisher": legacy_run["source"], "source_url": first_url[0] if first_url else "urn:legacy-source:" + legacy_run["source"], "source_type": legacy_run["family"], "geography_scope": [legacy_run["scope"]], "sector_scope": [legacy_run["category"]], "rights_status": "legacy_unreviewed", "access_method": "legacy_snapshot", "adapter_name": "legacy_v2", "source_date": publisher_date, "last_checked_at": legacy_run["captured_at"], "notes": "Historical evidence replay; no fresh source retrieval. Original collection costs unknown. Original capture: " + str(legacy_run["captured_at"]) + ". Publisher reference date is separate from this observation."})
                rows = []
                observation_ids = {}
                for observation in connection.execute("SELECT * FROM observations WHERE run_id=? ORDER BY id", (legacy_run["id"],)):
                    payload = json.loads(observation["payload"])
                    row = {**payload, "source_url": observation["source_url"], "source_record_id": "v2:" + observation["entity_id"], "observed_at": observation["captured_at"], "legacy_entity_id": observation["entity_id"], "legacy_observation_id": observation["id"], "legacy_run_id": legacy_run["id"], "raw_payload": payload}
                    rows.append(row)
                    observation_ids[observation["id"]] = observation["entity_id"]
                try:
                    legacy_result = json.loads(legacy_run["result"])
                except (TypeError, ValueError):
                    legacy_result = {}
                report = self.ingest(source_id, rows, run_metadata={"adapter_name": "legacy_v2", "parser_version": "1", "captured_at": legacy_run["captured_at"], "batch_id": legacy_run["id"], "coverage_complete": False, "requests": 0, "estimated_cost": 0, "legacy_run_id": legacy_run["id"], "legacy_run_kind": legacy_run["kind"], "historical_cost_known": False, "historical_result": legacy_result})
                results.append(report)
                with self.transaction():
                    for row in rows:
                        mapping = self.db.execute("SELECT organisation_id,last_evidence_id,location_id FROM source_identities WHERE source_id=? AND source_record_id=?", (source_id, row["source_record_id"])).fetchone()
                        if not mapping:
                            continue
                        legacy_id = row["legacy_entity_id"]
                        legacy_to_new[legacy_id] = mapping["organisation_id"]
                        self.db.execute("INSERT OR IGNORE INTO external_ids VALUES(?,?,?,?,?,?)", (stable_id("legacy-external", str(legacy_path), legacy_id), mapping["organisation_id"], "organisation", "legacy-v2:" + str(legacy_path), legacy_id, mapping["last_evidence_id"]))
            return {"legacy_database": str(legacy_path), "legacy_runs": len(results), "mapped_legacy_entities": len(legacy_to_new), "inserted_count": sum(r["inserted_count"] for r in results if not r.get("replayed")), "quarantined_count": sum(r["quarantined_count"] for r in results if not r.get("replayed")), "replayed_runs": sum(bool(r.get("replayed")) for r in results), "runs": results, "historical_costs": "unknown; replay itself makes no network/API calls"}
        finally:
            connection.close()

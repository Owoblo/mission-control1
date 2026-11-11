"""Bounded official-site discovery with evidence-backed, directional assertions.

No page can confer campaign eligibility. An external link or logo alone is
retained as an unverified association, never promoted to a current contract.
"""
from __future__ import annotations

import hashlib
import json
import re
import uuid
import time
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from urllib.parse import urljoin, urlsplit, urlunsplit, parse_qsl, urlencode

from lxml import html

from .transport import BudgetExceeded, SourceBlocked

EXCLUDED = {
    "facebook.com", "instagram.com", "twitter.com", "x.com", "youtube.com",
    "youtu.be", "linkedin.com", "google.com", "google.ca", "goo.gl", "g.page",
    "maps.app.goo.gl", "wix.com", "wixsite.com", "wordpress.com", "wordpress.org",
    "godaddy.com", "shopify.com", "myshopify.com", "squarespace.com", "microsoft.com",
    "apple.com", "adobe.com", "cloudflare.com", "doubleclick.net", "recaptcha.net",
    "gstatic.com", "fonts.googleapis.com", "pinterest.com", "tiktok.com", "vimeo.com",
    "whatsapp.com", "wa.me", "schema.org", "w3.org", "mozilla.org", "bootstrapmade.com",
}
RELEVANT = re.compile(r"partner|client|customer|project|case[-_ /]?stud|location|portfolio|supplier|dealer|distributor|tenant|sponsor|member|franchise|subsidiar|our brands|store[-_ /]?(?:locator|directory)|shopping[-_ /]?(?:centre|center)", re.I)
UTILITY = re.compile(r"privacy|cookie|terms|login|sign.?in|website (?:by|design)|designed by|powered by|web design|careers|share (?:on|this)", re.I)
ON_POSTAL = re.compile(r"\b[KLMNP]\d[A-CEGHJ-NPR-TV-Z][ -]?\d[A-CEGHJ-NPR-TV-Z]\d\b", re.I)


def now():
    return datetime.now(timezone.utc).isoformat()


@contextmanager
def atomic(db):
    """Nested writes must not commit the caller's page transaction."""
    savepoint = "relationship_" + uuid.uuid4().hex
    if db.in_transaction:
        db.execute("SAVEPOINT " + savepoint)
        try:
            yield
            db.execute("RELEASE SAVEPOINT " + savepoint)
        except Exception:
            db.execute("ROLLBACK TO SAVEPOINT " + savepoint)
            db.execute("RELEASE SAVEPOINT " + savepoint)
            raise
    else:
        with db:
            yield


def stable(*parts):
    return hashlib.sha256(json.dumps(parts, sort_keys=True).encode()).hexdigest()[:32]


def domain(url):
    try:
        return (urlsplit(url).hostname or "").lower().removeprefix("www.")
    except ValueError:
        return ""


def canonical_url(url, base=None):
    try:
        parsed = urlsplit(urljoin(base or "", url))
        if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password:
            return None
        if parsed.port not in (None, 80, 443):
            return None
        # Store/location/project IDs are semantic query parameters. Strip only
        # known tracking keys; removing all queries collapses distinct records.
        tracking = {"fbclid", "gclid", "msclkid", "mc_cid", "mc_eid", "_hsenc", "_hsmi"}
        query = [(key, value) for key, value in parse_qsl(parsed.query, keep_blank_values=True)
                 if not key.casefold().startswith("utm_") and key.casefold() not in tracking]
        return urlunsplit(("https", parsed.hostname.lower(), parsed.path or "/", urlencode(query), ""))
    except ValueError:
        return None


def excluded(host):
    return any(host == item or host.endswith("." + item) for item in EXCLUDED)


def text_of(node):
    return " ".join(node.text_content().split())


def named_tenant_property(title):
    """Require an actual source-named property, not a generic page heading."""
    patterns = [r"\btenants? at\s+([^|—]+)",
                r"\b([A-Z][\w '&.-]+?\s(?:Mall|Shopping Centre|Shopping Center|Tower|Plaza|Industrial Park|Business Park))\b"]
    for pattern in patterns:
        match = re.search(pattern, title)
        if match:
            value = match[1].strip(" -—:|")
            if len(value.split()) >= 2 and value.casefold() not in {"our tenants", "tenant directory"}:
                return value
    return None


def parse_page(body, page_url):
    """Extract useful internal pages and contextual external assertions only."""
    doc = html.fromstring(body, base_url=page_url)
    for node in doc.xpath("//script|//style|//noscript"):
        node.drop_tree()
    title = " ".join(doc.xpath("//title/text() | //h1//text()"))
    page_text = text_of(doc)
    page_label = urlsplit(page_url).path + " " + title
    links, assertions = [], []
    for anchor in doc.xpath("//a[@href]"):
        url = canonical_url(anchor.get("href"), page_url)
        if not url or re.search(r"\.(?:pdf|jpe?g|png|gif|svg|css|js|zip|mp[34])$", url, re.I):
            continue
        label = text_of(anchor)
        logo_only = not label and bool(anchor.xpath(".//img"))
        if not label:
            label = " ".join(anchor.xpath(".//img/@alt")).strip()
        if not label or len(label) > 180 or UTILITY.search(label) or label.casefold() in {
            "read more", "learn more", "click here", "visit website", "website", "view all", "logo", "image"}:
            continue
        host = domain(url)
        if excluded(host):
            continue
        if host == domain(page_url):
            if RELEVANT.search(label + " " + urlsplit(url).path):
                links.append(url)
            continue
        if anchor.xpath("ancestor::footer|ancestor::nav|ancestor::header"):
            continue
        block = anchor
        for parent in anchor.iterancestors():
            if parent.tag in ("p", "li", "article", "section", "div"):
                candidate = text_of(parent)
                if len(candidate) <= 700:
                    block = parent
                    break
        context = text_of(block)
        if UTILITY.search(context):
            continue
        if not RELEVANT.search(page_label + " " + context):
            continue
        predicate, direction, object_type = "unverified_association", "source_to_target", "organisation"
        # Explicit local claims outrank page labels. Page labels establish only
        # what this publisher claims, never a verified or current contract.
        if not logo_only:
            escaped = re.escape(label)
            if re.search(r"\b(?:we (?:are )?(?:a )?member(?:s)? of|member of)\s*(?:the\s+)?" + escaped, context, re.I):
                predicate = "member_of"
            elif re.search(r"\bsubsidiary of\s*(?:the\s+)?" + escaped, context, re.I):
                predicate = "subsidiary_of"
            elif re.search(r"\b(?:our subsidiaries|subsidiaries)\b", page_label, re.I):
                predicate, direction = "subsidiary_of", "target_to_source"
            elif re.search(r"\b(?:our franchisees|franchisees)\b", page_label, re.I):
                predicate, direction = "franchisee_of", "target_to_source"
            elif re.search(r"\b(?:we sponsor|proud(?:ly)? sponsor(?:s|ing)?(?: of)?)\s*(?:the\s+)?" + escaped, context, re.I):
                predicate = "sponsor_of"
            elif re.search(r"\b(?:we manage|managed propert(?:y|ies))\s*[:—-]?\s*" + escaped, context, re.I):
                predicate, object_type = "manages_property", "property"
            elif re.search(r"\b(?:general contractor|construction contractor)\s*[:—-]\s*" + escaped, context, re.I):
                predicate, direction, object_type = "contractor_on_project", "target_to_project", "property"
            elif re.search(r"\b(?:end client|project client)\s*[:—-]\s*" + escaped, context, re.I):
                predicate, direction, object_type = "client_on_project", "target_to_project", "property"
            elif re.search(r"\b(?:our clients|our customers|client list|clients|customers)\b", page_label, re.I):
                predicate, direction = "claimed_customer_of", "target_to_source"
            elif re.search(r"\btenants\b", page_label, re.I):
                if named_tenant_property(title):
                    predicate, direction, object_type = "tenant_at", "target_to_property", "property"
            elif re.search(r"\b(?:our sponsors|sponsors)\b", page_label, re.I):
                predicate, direction = "sponsor_of", "target_to_source"
            elif re.search(r"\b(?:our members|member directory|members)\b", page_label, re.I):
                predicate, direction = "member_of", "target_to_source"
            elif re.search(r"\b(?:partners|our partners)\b", page_label, re.I):
                predicate = "listed_partner_of"
        assertions.append({"name": label, "url": url, "domain": host,
                           "predicate": predicate, "direction": direction,
                           "object_type": object_type, "excerpt": context[:700],
                           "property_name": named_tenant_property(title) if direction == "target_to_property" else None,
                           "logo_only": logo_only, "page_title": title[:250]})
    return {"title": title, "text": page_text, "links": sorted(set(links)), "assertions": assertions}


def identity_supported(name, page):
    """Self-identification check; this is evidence, not legal-entity validation."""
    stop = {"the", "and", "inc", "ltd", "limited", "corporation", "company", "co", "llc", "corp", "of", "canada"}
    tokens = [x for x in re.findall(r"[a-z0-9]+", name.lower()) if x not in stop and len(x) > 1]
    heading = " ".join(re.findall(r"[a-z0-9]+", page["title"].lower()))
    return bool(tokens) and all(re.search(r"\b" + re.escape(token) + r"\b", heading) for token in tokens)


def ontario_evidence(page):
    # Require an Ontario indication paired with a Canadian postal address.
    value = page["text"]
    return bool(re.search(r"\bOntario\b|\bON\s*[, ]", value) and ON_POSTAL.search(value))


class RelationshipWave:
    def __init__(self, store, transport, *, max_depth=2, pages_per_domain=20, wave=1):
        if not 0 <= max_depth <= 10 or not 1 <= pages_per_domain <= 100:
            raise ValueError("Depth must be 0–10; pages per domain must be 1–100")
        self.store, self.db, self.transport = store, store.db, transport
        self.max_depth, self.pages_per_domain, self.wave = max_depth, pages_per_domain, wave
        self.db.executescript("""
        CREATE TABLE IF NOT EXISTS relationship_page_receipts(
          id TEXT PRIMARY KEY, queue_id TEXT UNIQUE NOT NULL REFERENCES discovery_queue(id),
          organisation_id TEXT NOT NULL REFERENCES organisations(id), domain TEXT NOT NULL,
          wave INTEGER NOT NULL, fetched_at TEXT NOT NULL, evidence_id TEXT REFERENCES evidence(id),
          outcome_json TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS relationship_domain_wave ON relationship_page_receipts(domain,wave);
        CREATE TABLE IF NOT EXISTS relationship_page_artifacts(
          queue_id TEXT PRIMARY KEY REFERENCES discovery_queue(id), url TEXT NOT NULL,
          observed_at TEXT NOT NULL, page_json TEXT NOT NULL, metrics_json TEXT NOT NULL);
        """)

    def enqueue(self, organisation_id, url, *, task_type="official_site_candidate", depth=0, evidence_id=None, metadata=None, priority=50):
        url = canonical_url(url)
        if not url or excluded(domain(url)):
            return None
        dedupe = stable("relationship", organisation_id, url, self.wave)
        status = "depth_limited" if depth > self.max_depth else "pending"
        with atomic(self.db):
            self.db.execute("""INSERT OR IGNORE INTO discovery_queue
                (id,target_url_or_query,task_type,discovered_from_entity_id,discovered_from_evidence_id,
                 traversal_depth,priority,status,attempts,dedupe_key,domain,wave,metadata_json,created_at,updated_at)
                VALUES(?,?,?,?,?,?,?,?,0,?,?,?,?,?,?)""",
                (dedupe, url, task_type, organisation_id, evidence_id, depth, priority, status, dedupe,
                 domain(url), self.wave, json.dumps(metadata or {}, sort_keys=True), now(), now()))
        return dedupe

    def seed(self, organisation_ids=None, limit=20):
        if not 1 <= limit <= 1000:
            raise ValueError("Seed limit must be 1–1000")
        rows = self.db.execute("""SELECT o.* FROM organisations o
            WHERE primary_domain IS NOT NULL AND primary_domain<>''
            AND EXISTS(SELECT 1 FROM locations l WHERE l.organisation_id=o.id AND l.province='ON')
            ORDER BY o.id""").fetchall()
        if organisation_ids:
            rows = [row for row in rows if row["id"] in organisation_ids]
        count = 0
        for row in rows[:limit]:
            if self.enqueue(row["id"], "https://" + row["primary_domain"] + "/", metadata={"ontario_seed": True}):
                count += 1
        return count

    def _claim(self):
        instant = now()
        with self.db:
            self.db.execute("BEGIN IMMEDIATE")
            self.db.execute("""UPDATE discovery_queue SET status='held',last_error='Attempt cap reached after interrupted fetch'
                WHERE task_type IN ('official_site_candidate','relationship_page','related_identity')
                AND status='running' AND lease_until<? AND attempts>=3""", (instant,))
            row = self.db.execute("""SELECT * FROM discovery_queue WHERE wave=?
                AND task_type IN ('official_site_candidate','relationship_page','related_identity')
                AND traversal_depth<=? AND attempts<3
                AND ((status IN ('pending','retry') AND (next_attempt_at IS NULL OR next_attempt_at<=?))
                     OR (status='running' AND lease_until<?))
                ORDER BY priority DESC,traversal_depth,id LIMIT 1""", (self.wave, self.max_depth, instant, instant)).fetchone()
            if row is None:
                return None
            token = uuid.uuid4().hex
            until = (datetime.now(timezone.utc) + timedelta(minutes=5)).isoformat()
            self.db.execute("UPDATE discovery_queue SET status='running',attempts=attempts+1,lease_token=?,lease_until=?,updated_at=? WHERE id=?",
                            (token, until, instant, row["id"]))
        return {**dict(row), "lease_token": token, "attempts": row["attempts"] + 1}

    def resume_limited(self):
        """Larger explicit wave limits can reopen the retained frontier."""
        with self.store.transaction():
            depths = self.db.execute("""UPDATE discovery_queue SET status='pending',last_error=NULL,updated_at=?
                WHERE wave=? AND status='depth_limited' AND traversal_depth<=?
                AND task_type IN ('official_site_candidate','relationship_page','related_identity')""",
                (now(), self.wave, self.max_depth)).rowcount
            pages = 0
            for job in self.db.execute("SELECT id,domain FROM discovery_queue WHERE wave=? AND status='page_limited'", (self.wave,)).fetchall():
                count = self.db.execute("SELECT COUNT(*) FROM relationship_page_receipts WHERE domain=? AND wave=?", (job["domain"], self.wave)).fetchone()[0]
                if count < self.pages_per_domain:
                    pages += self.db.execute("UPDATE discovery_queue SET status='pending',last_error=NULL,updated_at=? WHERE id=?", (now(), job["id"])).rowcount
        return {"depth_tasks_reopened": depths, "page_tasks_reopened": pages}

    def _finish(self, job, status, error=None, defer_seconds=0):
        with self.db:
            result = self.db.execute("""UPDATE discovery_queue SET status=?,last_error=?,lease_until=NULL,
                next_attempt_at=?,updated_at=? WHERE id=? AND lease_token=? AND status='running'""",
                (status, error, (datetime.now(timezone.utc) + timedelta(seconds=defer_seconds)).isoformat() if defer_seconds else None,
                 now(), job["id"], job["lease_token"]))
            if not result.rowcount:
                raise RuntimeError("Relationship task lease lost")

    def _source(self, host):
        return self.store.upsert_source({"id": "website-" + stable(host), "name": host + " public website",
            "publisher": host, "source_url": "https://" + host + "/", "source_type": "official_website_candidate",
            "geography_scope": [], "sector_scope": [], "access_method": "limited_public_evidence",
            "retrieval_status": "accessible", "rights_status": "limited_excerpt_review",
            "cost_model": "free", "adapter_name": "relationship_wave_v1",
            "notes": "Source-reported website; identity checked against homepage self-identification. Only short supporting excerpts retained; no bulk reuse licence assumed."})

    def _target(self, source_id, assertion, page_url, observed_at):
        source_record_id = "related-" + stable(assertion["name"], assertion["domain"])
        self.store.ingest(source_id, [{"name": assertion["name"], "website": assertion["url"],
            "source_record_id": source_record_id, "source_url": page_url,
            "country": "unknown", "province": None, "city": "", "address": "",
            "observed_at": observed_at, "raw_payload": {"relationship_assertion": assertion,
            "ontario_relevance": "unknown", "identity_status": "named_by_related_publisher"}}],
            run_metadata={"adapter_name": "relationship_wave_v1", "parser_version": "1", "coverage_complete": False})
        row = self.db.execute("SELECT organisation_id FROM source_identities WHERE source_id=? AND source_record_id=?",
                              (source_id, source_record_id)).fetchone()
        return row[0] if row else None

    def _process(self, job):
        receipt = self.db.execute("SELECT outcome_json FROM relationship_page_receipts WHERE queue_id=?", (job["id"],)).fetchone()
        if receipt:
            self._finish(job, "completed")
            return {**json.loads(receipt[0]), "replayed": True}
        count = self.db.execute("SELECT COUNT(*) FROM relationship_page_receipts WHERE domain=? AND wave=?",
                                (job["domain"], self.wave)).fetchone()[0]
        if count >= self.pages_per_domain:
            self._finish(job, "page_limited", "Per-domain wave page limit reached")
            with self.store.transaction():
                self.db.execute("UPDATE discovery_queue SET attempts=attempts-1 WHERE id=?", (job["id"],))
            return {"status": "page_limited", "queue_id": job["id"]}
        org = self.db.execute("SELECT * FROM organisations WHERE id=?", (job["discovered_from_entity_id"],)).fetchone()
        if org is None:
            self._finish(job, "held", "Organisation missing")
            return {"status": "held", "queue_id": job["id"]}
        cached = self.db.execute("SELECT * FROM relationship_page_artifacts WHERE queue_id=?", (job["id"],)).fetchone()
        if cached:
            page, observed_at, resolved_url = json.loads(cached["page_json"]), cached["observed_at"], cached["url"]
        else:
            before_metrics = self.transport.metrics()
            host = urlsplit(job["target_url_or_query"]).hostname
            response = self.transport.fetch(job["target_url_or_query"], allowed_hosts=[host, "www." + domain(job["target_url_or_query"])])
            content_type = response.headers.get("content-type", response.headers.get("Content-Type", ""))
            if "html" not in content_type.lower():
                raise SourceBlocked("Relationship discovery requires an HTML page")
            page = parse_page(response.body, response.url)
            observed_at, resolved_url = now(), response.url
            page["ontario_evidence"] = ontario_evidence(page)
            page["content_hash"] = hashlib.sha256(response.body).hexdigest()
            # Persist extracted claims and short excerpts, not whole websites.
            page["text"] = page["text"][:700]
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO relationship_page_artifacts VALUES(?,?,?,?,?)",
                    (job["id"], resolved_url, observed_at, json.dumps(page), json.dumps({
                        "requests": self.transport.metrics().get("requests", 0) - before_metrics.get("requests", 0),
                        "bytes_fetched": self.transport.metrics().get("bytes_fetched", 0) - before_metrics.get("bytes_fetched", 0),
                        "scope": "this page fetch including its robots/access checks"})))
        source_id = self._source(job["domain"])
        # Recheck ownership before committing any page-derived assertions.
        lease = self.db.execute("SELECT lease_token,lease_until FROM discovery_queue WHERE id=?", (job["id"],)).fetchone()
        if lease[0] != job["lease_token"] or lease[1] < now():
            raise RuntimeError("Expired relationship lease")
        metadata = json.loads(job["metadata_json"] or "{}")
        own_identity = bool(metadata.get("identity_checked")) or identity_supported(org["trading_name"], page)
        eligible = own_identity and (job["task_type"] != "related_identity" or page.get("ontario_evidence", False))
        relationships = 0
        with self.db:
            evidence_id = self.store.record_evidence(source_id, {"title": page["title"], "url": resolved_url,
                "excerpt": page["text"][:700], "identity_self_identified": own_identity}, resolved_url, observed_at,
                source_record_id="page-" + stable(resolved_url), excerpt=page["text"][:700])
            if not own_identity:
                self.store.add_review("official_domain_identity", [org["id"]], [evidence_id],
                    "Homepage/title did not corroborate the publisher-reported organisation identity; traversal held.")
            if own_identity:
                self.db.execute("UPDATE domains SET relationship_to_organisation='self_identified_website' WHERE organisation_id=? AND domain=?",
                                (org["id"], job["domain"]))
            if eligible:
                for url in page["links"]:
                    self.enqueue(org["id"], url, task_type="relationship_page", depth=job["traversal_depth"],
                                 evidence_id=evidence_id, metadata={"identity_checked": True}, priority=60)
                for assertion in page["assertions"]:
                    aeid = self.store.record_evidence(source_id, assertion, resolved_url, observed_at,
                        source_record_id="assertion-" + stable(resolved_url, assertion), excerpt=assertion["excerpt"])
                    if assertion["predicate"] == "manages_property":
                        target = "property-" + stable(source_id, assertion["name"], assertion["url"])
                        self.db.execute("INSERT OR IGNORE INTO properties(id,property_name,property_type) VALUES(?,?,'unknown')", (target, assertion["name"]))
                        subject, obj, subject_type, object_type = org["id"], target, "organisation", "property"
                    else:
                        target = self._target(source_id, assertion, resolved_url, observed_at)
                        if not target:
                            continue
                        subject, obj, subject_type, object_type = org["id"], target, "organisation", "organisation"
                        if assertion["direction"] == "target_to_source":
                            subject, obj = target, org["id"]
                        elif assertion["direction"] in ("target_to_project", "target_to_property"):
                            project = "property-" + stable(resolved_url)
                            property_type = "project_site" if assertion["direction"] == "target_to_project" else "source_named_tenant_property"
                            self.db.execute("INSERT OR IGNORE INTO properties(id,property_name,property_type) VALUES(?,?,?)", (project, assertion.get("property_name") or page["title"] or resolved_url, property_type))
                            subject, obj, object_type = target, project, "property"
                        self.enqueue(target, "https://" + assertion["domain"] + "/", task_type="related_identity",
                                     depth=job["traversal_depth"] + 1, evidence_id=aeid,
                                     metadata={"ontario_relevance": "requires_homepage_evidence"}, priority=30)
                    rid = "relationship-" + stable(subject, assertion["predicate"], obj, aeid)
                    inserted = self.db.execute("""INSERT OR IGNORE INTO relationships
                        (id,subject_id,subject_type,predicate,object_id,object_type,asserted_by_source_id,evidence_id,confidence,observed_at,review_status)
                        VALUES(?,?,?,?,?,?,?,?,NULL,?,?)""", (rid, subject, subject_type, assertion["predicate"], obj,
                        object_type, source_id, aeid, observed_at, "unverified" if assertion["predicate"] == "unverified_association" else "source_claimed"))
                    relationships += inserted.rowcount
                    if assertion["predicate"] == "unverified_association":
                        self.store.add_review("relationship_role_unknown", [subject, obj], [aeid],
                            "Logo/link or generic relationship context does not establish a specific current commercial role.")
            outcome = {"status": "completed", "queue_id": job["id"], "url": resolved_url,
                       "identity_supported": own_identity, "traversal_eligible": eligible,
                       "relationships_inserted": relationships, "useful_links": len(page["links"]),
                       "evidence_id": evidence_id}
            self.db.execute("INSERT OR IGNORE INTO relationship_page_receipts VALUES(?,?,?,?,?,?,?,?)",
                (stable(job["id"]), job["id"], org["id"], job["domain"], self.wave, observed_at, evidence_id, json.dumps(outcome)))
        self._finish(job, "completed")
        return outcome

    def run(self, max_jobs=20):
        if not 1 <= max_jobs <= 1000:
            raise ValueError("Job limit must be 1–1000")
        outcomes = []
        reopened = self.resume_limited()
        started_at, clock_start = now(), time.monotonic()
        before_metrics = self.transport.metrics()
        for _ in range(max_jobs):
            job = self._claim()
            if not job:
                break
            try:
                outcome = self._process(job)
            except BudgetExceeded as error:
                self._finish(job, "retry", str(error))
                with self.db:
                    self.db.execute("UPDATE discovery_queue SET attempts=attempts-1 WHERE id=?", (job["id"],))
                outcomes.append({"queue_id": job["id"], "status": "budget_paused", "reason": str(error)})
                break
            except SourceBlocked as error:
                self._finish(job, "held", str(error))
                outcome = {"queue_id": job["id"], "status": "held", "reason": str(error)}
            except Exception as error:
                status = "held" if job["attempts"] >= 3 else "retry"
                self._finish(job, status, str(error), defer_seconds=30 * 2 ** (job["attempts"] - 1))
                outcome = {"queue_id": job["id"], "status": status, "reason": str(error)}
            outcomes.append(outcome)
        metrics = self.transport.metrics()
        for counter in ("requests", "bytes_fetched", "cache_hits"):
            if counter in metrics:
                metrics[counter] -= before_metrics.get(counter, 0)
        metrics["elapsed_seconds"] = round(time.monotonic() - clock_start, 3)
        result = {"wave": self.wave, "outcomes": outcomes, "metrics": metrics, "reopened": reopened,
                "queue": [dict(row) for row in self.db.execute("SELECT status,COUNT(*) AS count FROM discovery_queue GROUP BY status")],
                "limits": {"max_depth": self.max_depth, "pages_per_domain": self.pages_per_domain, "max_jobs": max_jobs}}
        with self.store.transaction():
            self.db.execute("INSERT INTO relationship_invocations VALUES(?,?,?,?,?,?,?,?,?)",
                (uuid.uuid4().hex, started_at, now(), self.wave, metrics.get("requests", 0),
                 metrics.get("bytes_fetched", 0), metrics["elapsed_seconds"], 0, json.dumps(result)))
        return result

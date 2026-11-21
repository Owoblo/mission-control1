-- Persist bounded public-website waves separately from bulk source runs.
CREATE TABLE IF NOT EXISTS relationship_page_receipts (
 id TEXT PRIMARY KEY, queue_id TEXT UNIQUE NOT NULL REFERENCES discovery_queue(id),
 organisation_id TEXT NOT NULL REFERENCES organisations(id), domain TEXT NOT NULL,
 wave INTEGER NOT NULL, fetched_at TEXT NOT NULL, evidence_id TEXT REFERENCES evidence(id),
 outcome_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS relationship_domain_wave ON relationship_page_receipts(domain,wave);
CREATE TABLE IF NOT EXISTS relationship_page_artifacts (
 queue_id TEXT PRIMARY KEY REFERENCES discovery_queue(id), url TEXT NOT NULL,
 observed_at TEXT NOT NULL, page_json TEXT NOT NULL, metrics_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS relationship_invocations (
 id TEXT PRIMARY KEY, started_at TEXT NOT NULL, completed_at TEXT NOT NULL,
 wave INTEGER NOT NULL, requests INTEGER NOT NULL, bytes_fetched INTEGER NOT NULL,
 elapsed_seconds REAL NOT NULL, estimated_cost REAL NOT NULL DEFAULT 0,
 report_json TEXT NOT NULL
);

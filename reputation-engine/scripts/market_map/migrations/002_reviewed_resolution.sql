-- Reviewed identity decisions are links, not destructive record rewrites.
CREATE TABLE IF NOT EXISTS organisation_resolution_links (
 id TEXT PRIMARY KEY, left_organisation_id TEXT NOT NULL REFERENCES organisations(id),
 right_organisation_id TEXT NOT NULL REFERENCES organisations(id), decision TEXT NOT NULL,
 evidence_ids TEXT NOT NULL, reviewer TEXT NOT NULL, reason TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, recorded_at TEXT NOT NULL,
 reversed_at TEXT, reversed_by TEXT, reversal_reason TEXT,
 CHECK(left_organisation_id<>right_organisation_id),
 CHECK(decision IN ('same_organisation','different_organisation','same_parent','same_site','uncertain'))
);
CREATE INDEX IF NOT EXISTS organisation_resolution_pair
 ON organisation_resolution_links(left_organisation_id,right_organisation_id,active);

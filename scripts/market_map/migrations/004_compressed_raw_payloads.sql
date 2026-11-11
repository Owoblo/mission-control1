-- Lossless storage for repeated structured provenance. Raw IDs, payload hashes,
-- evidence links and observation times remain unchanged.
CREATE TABLE IF NOT EXISTS compressed_raw_payloads (
 raw_record_id TEXT PRIMARY KEY REFERENCES raw_records(id) ON DELETE CASCADE,
 encoding TEXT NOT NULL CHECK(encoding='zlib'), compressed_payload BLOB NOT NULL,
 original_bytes INTEGER NOT NULL CHECK(original_bytes>=0), original_hash TEXT NOT NULL
);

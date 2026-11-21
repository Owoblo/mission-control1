-- Region-aware postcard lifecycle tracking on the unified listings table.
-- Supports:
-- 1. inferring sold by disappearance from a fresh regional scrape
-- 2. tracking when each postcard batch was sent
-- 3. preparing multi-region automation from one shared pipeline

ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS region text,
  ADD COLUMN IF NOT EXISTS first_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS just_listed_postcard_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS sold_postcard_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_postcard_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_postcard_batch_id text,
  ADD COLUMN IF NOT EXISTS last_postcard_type_sent text;
CREATE INDEX IF NOT EXISTS idx_listings_region_status ON listings (region, status);
CREATE INDEX IF NOT EXISTS idx_listings_last_postcard_batch_id ON listings (last_postcard_batch_id);

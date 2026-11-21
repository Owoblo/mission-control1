-- Add furniture_needs_retry flag to listings
-- Used by postcard pipeline to re-scan listings that had exterior-only photos
-- on first scan (realtor hadn't uploaded interior photos yet)
ALTER TABLE listings
  ADD COLUMN IF NOT EXISTS furniture_needs_retry boolean DEFAULT false;
-- Index for efficient querying of retry listings
CREATE INDEX IF NOT EXISTS idx_listings_furniture_needs_retry
  ON listings (furniture_needs_retry)
  WHERE furniture_needs_retry = true;

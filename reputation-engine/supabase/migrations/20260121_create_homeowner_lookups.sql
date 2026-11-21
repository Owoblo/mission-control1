-- Create homeowner_lookups table to cache Batch Data API results
-- This saves money by avoiding duplicate API calls for the same property

CREATE TABLE IF NOT EXISTS homeowner_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Link to listing (nullable since we might lookup addresses not in our listings table)
  zpid TEXT UNIQUE,

  -- Address components for lookup
  address_street TEXT NOT NULL,
  address_city TEXT NOT NULL,
  address_state TEXT NOT NULL,
  address_zip TEXT NOT NULL,
  address_hash TEXT NOT NULL,  -- MD5 hash of normalized address for deduplication

  -- Parsed owner information
  homeowner_first_name TEXT,
  homeowner_last_name TEXT,
  emails JSONB DEFAULT '[]'::jsonb,        -- Array of {email, tested} objects
  phone_numbers JSONB DEFAULT '[]'::jsonb, -- Array of {number, type, carrier, score, reachable, dnc, tested} objects

  -- Compliance flags
  is_litigator BOOLEAN DEFAULT FALSE,      -- TCPA litigator flag
  has_dnc_phone BOOLEAN DEFAULT FALSE,     -- Any phone on Do Not Call list

  -- Raw API response for future data extraction
  raw_response JSONB,

  -- Whether this was a successful lookup (API returned data)
  lookup_successful BOOLEAN DEFAULT FALSE,

  -- Metadata
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Index for fast lookups by zpid (most common case)
CREATE INDEX IF NOT EXISTS idx_homeowner_lookups_zpid ON homeowner_lookups(zpid);
-- Index for lookups by address hash (for properties not in our listings table)
CREATE INDEX IF NOT EXISTS idx_homeowner_lookups_address_hash ON homeowner_lookups(address_hash);
-- Index for finding lookups by city (useful for analytics)
CREATE INDEX IF NOT EXISTS idx_homeowner_lookups_city ON homeowner_lookups(address_city);
-- Enable Row Level Security
ALTER TABLE homeowner_lookups ENABLE ROW LEVEL SECURITY;
-- Policy: Allow all authenticated users to read homeowner lookups
-- (This is shared data - if one user looks up an address, others benefit from cache)
CREATE POLICY "Allow authenticated users to read homeowner lookups"
  ON homeowner_lookups
  FOR SELECT
  TO authenticated
  USING (true);
-- Policy: Only service role can insert/update (edge function uses service role)
CREATE POLICY "Only service role can insert homeowner lookups"
  ON homeowner_lookups
  FOR INSERT
  TO service_role
  WITH CHECK (true);
CREATE POLICY "Only service role can update homeowner lookups"
  ON homeowner_lookups
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
-- Add comment for documentation
COMMENT ON TABLE homeowner_lookups IS 'Cache for Batch Data Property Skip Trace API results. Stores homeowner contact information to avoid duplicate API calls.';
COMMENT ON COLUMN homeowner_lookups.address_hash IS 'MD5 hash of normalized address (lowercase, trimmed) for fast deduplication';
COMMENT ON COLUMN homeowner_lookups.is_litigator IS 'True if homeowner is known TCPA litigator - use caution when contacting';
COMMENT ON COLUMN homeowner_lookups.has_dnc_phone IS 'True if any phone number is on the Do Not Call registry';

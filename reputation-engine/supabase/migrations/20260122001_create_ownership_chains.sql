-- Create ownership_chains table for buyer-seller chain detection
-- Tracks when a property buyer still owns another property = guaranteed move lead

CREATE TABLE IF NOT EXISTS ownership_chains (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- The sold property (trigger)
  sold_listing_id UUID REFERENCES listings(id) ON DELETE SET NULL,
  sold_address TEXT NOT NULL,
  sold_city TEXT,
  sold_state TEXT,
  sold_zip TEXT,
  sale_date DATE,
  sale_price DECIMAL(12, 2),

  -- Buyer info (from deed/transaction data)
  buyer_name TEXT NOT NULL,
  buyer_name_normalized TEXT, -- lowercase, no middle initials for matching
  buyer_mailing_address TEXT,

  -- The owned property (the lead - guaranteed move)
  owned_property_address TEXT NOT NULL,
  owned_property_city TEXT,
  owned_property_state TEXT,
  owned_property_zip TEXT,
  owned_property_id UUID REFERENCES listings(id) ON DELETE SET NULL, -- if we have it in our system

  -- Chain metadata
  confidence_score INTEGER DEFAULT 0 CHECK (confidence_score >= 0 AND confidence_score <= 100),
  match_signals JSONB DEFAULT '{}'::jsonb, -- what matched: {nameMatch: true, mailingMismatch: true, sameMetro: true}
  chain_status TEXT DEFAULT 'detected' CHECK (chain_status IN ('detected', 'contacted', 'listed', 'sold', 'expired', 'invalid')),

  -- Timestamps
  detected_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '90 days'), -- chains expire after 90 days
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_chains_status ON ownership_chains(chain_status);
CREATE INDEX IF NOT EXISTS idx_chains_confidence ON ownership_chains(confidence_score DESC);
CREATE INDEX IF NOT EXISTS idx_chains_buyer_normalized ON ownership_chains(buyer_name_normalized);
CREATE INDEX IF NOT EXISTS idx_chains_detected_at ON ownership_chains(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_chains_sold_city ON ownership_chains(sold_city);
CREATE INDEX IF NOT EXISTS idx_chains_owned_city ON ownership_chains(owned_property_city);
-- Composite index for finding active high-confidence chains
CREATE INDEX IF NOT EXISTS idx_chains_active_quality ON ownership_chains(chain_status, confidence_score DESC)
  WHERE chain_status = 'detected';
-- Enable Row Level Security
ALTER TABLE ownership_chains ENABLE ROW LEVEL SECURITY;
-- Policy: Allow authenticated users to read chains
CREATE POLICY "Allow authenticated users to read ownership chains"
  ON ownership_chains
  FOR SELECT
  TO authenticated
  USING (true);
-- Policy: Only service role can insert (edge function uses service role)
CREATE POLICY "Only service role can insert ownership chains"
  ON ownership_chains
  FOR INSERT
  TO service_role
  WITH CHECK (true);
-- Policy: Only service role can update
CREATE POLICY "Only service role can update ownership chains"
  ON ownership_chains
  FOR UPDATE
  TO service_role
  USING (true)
  WITH CHECK (true);
-- Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ownership_chains_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER trigger_ownership_chains_updated_at
  BEFORE UPDATE ON ownership_chains
  FOR EACH ROW
  EXECUTE FUNCTION update_ownership_chains_updated_at();
-- Table to track chain reveals (separate from regular listing reveals)
CREATE TABLE IF NOT EXISTS chain_reveals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chain_id UUID NOT NULL REFERENCES ownership_chains(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  credit_cost INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ DEFAULT NOW(),

  UNIQUE(chain_id, user_id) -- prevent duplicate reveals
);
CREATE INDEX IF NOT EXISTS idx_chain_reveals_user ON chain_reveals(user_id);
CREATE INDEX IF NOT EXISTS idx_chain_reveals_chain ON chain_reveals(chain_id);
-- RLS for chain_reveals
ALTER TABLE chain_reveals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Users can read their own chain reveals"
  ON chain_reveals
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);
CREATE POLICY "Authenticated users can insert chain reveals"
  ON chain_reveals
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);
-- Documentation
COMMENT ON TABLE ownership_chains IS 'Buyer-seller chain detection: tracks when a property buyer still owns another property, indicating a guaranteed move';
COMMENT ON COLUMN ownership_chains.confidence_score IS 'Match confidence 0-100. 80+ is high confidence, 60-79 is medium';
COMMENT ON COLUMN ownership_chains.match_signals IS 'JSON object indicating what matched: nameMatch, mailingMismatch, sameMetro, recentSale';
COMMENT ON COLUMN ownership_chains.chain_status IS 'detected=new lead, contacted=user reached out, listed=owned property now listed, sold=chain complete, expired=too old, invalid=false positive';
COMMENT ON TABLE chain_reveals IS 'Tracks which users have revealed (paid for) chain lead details';

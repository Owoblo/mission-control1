-- Add AI analysis columns to listings tables
-- This migration adds AI-powered furniture detection capabilities

-- Add AI analysis column to just_listed table
ALTER TABLE just_listed ADD COLUMN IF NOT EXISTS ai_analysis JSONB;
-- Add AI analysis column to sold_listings table  
ALTER TABLE sold_listings ADD COLUMN IF NOT EXISTS ai_analysis JSONB;
-- Add AI furniture filter preference to profiles table
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS ai_furniture_filter BOOLEAN DEFAULT false;
-- Create index for faster AI filter queries
CREATE INDEX IF NOT EXISTS idx_just_listed_ai_analysis ON just_listed USING GIN (ai_analysis);
CREATE INDEX IF NOT EXISTS idx_sold_listings_ai_analysis ON sold_listings USING GIN (ai_analysis);
-- Add comments for documentation
COMMENT ON COLUMN just_listed.ai_analysis IS 'AI analysis results including furniture detection and confidence scores';
COMMENT ON COLUMN sold_listings.ai_analysis IS 'AI analysis results including furniture detection and confidence scores';
COMMENT ON COLUMN profiles.ai_furniture_filter IS 'User preference to filter out properties without furniture using AI analysis';
-- Create a function to check if a property has furniture based on AI analysis
CREATE OR REPLACE FUNCTION has_furniture(analysis JSONB)
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if AI analysis exists and indicates furniture is present
  RETURN analysis IS NOT NULL 
    AND analysis->>'has_furniture' = 'true'
    AND COALESCE((analysis->>'confidence')::float, 0) > 0.5;
END;
$$ LANGUAGE plpgsql IMMUTABLE;
-- Create a function to get furniture confidence score
CREATE OR REPLACE FUNCTION furniture_confidence(analysis JSONB)
RETURNS FLOAT AS $$
BEGIN
  -- Return confidence score from AI analysis, default to 0 if not available
  RETURN COALESCE((analysis->>'confidence')::float, 0);
END;
$$ LANGUAGE plpgsql IMMUTABLE;

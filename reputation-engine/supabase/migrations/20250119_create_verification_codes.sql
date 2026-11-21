-- Create verification_codes table for email verification
CREATE TABLE IF NOT EXISTS verification_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  code TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  used BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_verification_codes_email ON verification_codes(email);
CREATE INDEX IF NOT EXISTS idx_verification_codes_email_code ON verification_codes(email, code);
-- Enable RLS
ALTER TABLE verification_codes ENABLE ROW LEVEL SECURITY;
-- Allow service role full access (for edge functions)
CREATE POLICY "Service role can manage verification codes"
  ON verification_codes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
-- Clean up old/used codes function
CREATE OR REPLACE FUNCTION cleanup_verification_codes()
RETURNS void AS $$
BEGIN
  DELETE FROM verification_codes
  WHERE expires_at < NOW() OR used = TRUE;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to create a verification code
CREATE OR REPLACE FUNCTION create_verification_code(p_email TEXT)
RETURNS TEXT AS $$
DECLARE
  v_code TEXT;
BEGIN
  -- Generate 6-digit code
  v_code := LPAD(FLOOR(RANDOM() * 1000000)::TEXT, 6, '0');

  -- Delete any existing unused codes for this email
  DELETE FROM verification_codes WHERE email = p_email AND used = FALSE;

  -- Insert new code with 10 minute expiration
  INSERT INTO verification_codes (email, code, expires_at)
  VALUES (p_email, v_code, NOW() + INTERVAL '10 minutes');

  RETURN v_code;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
-- Function to verify a code
CREATE OR REPLACE FUNCTION verify_email_code(p_email TEXT, p_code TEXT)
RETURNS BOOLEAN AS $$
DECLARE
  v_valid BOOLEAN;
BEGIN
  -- Check if valid unexpired code exists
  SELECT EXISTS (
    SELECT 1 FROM verification_codes
    WHERE email = p_email
      AND code = p_code
      AND used = FALSE
      AND expires_at > NOW()
  ) INTO v_valid;

  -- If valid, mark as used
  IF v_valid THEN
    UPDATE verification_codes
    SET used = TRUE
    WHERE email = p_email AND code = p_code;
  END IF;

  RETURN v_valid;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

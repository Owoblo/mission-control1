-- ============================================================
-- Orders System Migration
-- Creates tables for design products, orders, and coupons
-- ============================================================

-- Enable UUID extension if not already enabled
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
-- ============================================================
-- Design Products Table
-- Stores the product catalog for design services
-- ============================================================
CREATE TABLE IF NOT EXISTS design_products (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL CHECK (category IN ('postcard_design', 'letter_design', 'handwritten_card')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  features JSONB DEFAULT '[]'::jsonb,
  is_active BOOLEAN DEFAULT true,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Index for active products lookup
CREATE INDEX IF NOT EXISTS idx_design_products_active ON design_products(is_active, sort_order);
-- ============================================================
-- Coupons Table
-- Stores coupon codes for discounts
-- ============================================================
CREATE TABLE IF NOT EXISTS coupons (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL CHECK (discount_type IN ('percentage', 'fixed')),
  discount_value NUMERIC(10, 2) NOT NULL CHECK (discount_value > 0),
  valid_until TIMESTAMPTZ,
  max_uses INTEGER,
  current_uses INTEGER DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Index for coupon lookup
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code) WHERE is_active = true;
-- ============================================================
-- Design Orders Table
-- Stores customer orders for design services
-- ============================================================
CREATE TABLE IF NOT EXISTS design_orders (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_id UUID NOT NULL REFERENCES design_products(id) ON DELETE RESTRICT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'processing', 'completed', 'cancelled', 'refunded')),
  amount_cents INTEGER NOT NULL CHECK (amount_cents >= 0),
  coupon_code TEXT,
  discount_cents INTEGER DEFAULT 0,
  customer_name TEXT NOT NULL,
  customer_email TEXT NOT NULL,
  customer_phone TEXT,
  design_notes TEXT,
  e_signature TEXT,
  terms_agreed_at TIMESTAMPTZ,
  stripe_session_id TEXT,
  stripe_payment_intent_id TEXT,
  paid_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  delivery_files JSONB DEFAULT '[]'::jsonb,
  admin_notes TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
-- Indexes for order lookups
CREATE INDEX IF NOT EXISTS idx_design_orders_user_id ON design_orders(user_id);
CREATE INDEX IF NOT EXISTS idx_design_orders_status ON design_orders(status);
CREATE INDEX IF NOT EXISTS idx_design_orders_created ON design_orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_design_orders_stripe_session ON design_orders(stripe_session_id);
-- ============================================================
-- Row Level Security (RLS)
-- ============================================================

-- Enable RLS on all tables
ALTER TABLE design_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE design_orders ENABLE ROW LEVEL SECURITY;
-- Products: Anyone can view active products
CREATE POLICY "Anyone can view active products"
  ON design_products FOR SELECT
  USING (is_active = true);
-- Coupons: Anyone can view active coupons (for validation)
CREATE POLICY "Anyone can view active coupons"
  ON coupons FOR SELECT
  USING (is_active = true);
-- Orders: Users can view their own orders
CREATE POLICY "Users can view own orders"
  ON design_orders FOR SELECT
  USING (auth.uid() = user_id);
-- Orders: Users can create their own orders
CREATE POLICY "Users can create own orders"
  ON design_orders FOR INSERT
  WITH CHECK (auth.uid() = user_id);
-- Orders: Service role can update any order (for webhooks)
CREATE POLICY "Service role can manage all orders"
  ON design_orders FOR ALL
  USING (auth.jwt() ->> 'role' = 'service_role');
-- ============================================================
-- Triggers for updated_at
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS update_design_products_updated_at ON design_products;
CREATE TRIGGER update_design_products_updated_at
  BEFORE UPDATE ON design_products
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_coupons_updated_at ON coupons;
CREATE TRIGGER update_coupons_updated_at
  BEFORE UPDATE ON coupons
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_design_orders_updated_at ON design_orders;
CREATE TRIGGER update_design_orders_updated_at
  BEFORE UPDATE ON design_orders
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
-- ============================================================
-- Seed Data: Sample Products
-- ============================================================

INSERT INTO design_products (name, description, category, price_cents, features, sort_order) VALUES
(
  'Professional Postcard Design',
  'Eye-catching postcard design tailored for moving companies. Perfect for direct mail campaigns.',
  'postcard_design',
  14900,
  '["Custom branded design", "Print-ready files (PDF, PNG)", "2 revision rounds", "3-5 day delivery", "4x6 or 6x9 size options"]'::jsonb,
  1
),
(
  'Premium Letter Design',
  'Professional letter template with your branding. Great for personalized outreach to homeowners.',
  'letter_design',
  19900,
  '["Custom letterhead design", "Print-ready files", "2 revision rounds", "3-5 day delivery", "Envelope design included", "Multiple format options"]'::jsonb,
  2
),
(
  'Handwritten Card Design',
  'Authentic handwritten-style card design. Creates a personal touch that stands out.',
  'handwritten_card',
  24900,
  '["Authentic handwritten style", "Custom message templates", "Print-ready files", "2 revision rounds", "3-5 day delivery", "Multiple card sizes", "Envelope design included"]'::jsonb,
  3
)
ON CONFLICT DO NOTHING;
-- ============================================================
-- Seed Data: Sample Coupon
-- ============================================================

INSERT INTO coupons (code, discount_type, discount_value, max_uses) VALUES
('WELCOME20', 'percentage', 20, 100)
ON CONFLICT DO NOTHING;

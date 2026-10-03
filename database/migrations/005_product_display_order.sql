ALTER TABLE products
  ADD COLUMN IF NOT EXISTS display_order INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS products_display_order_idx
  ON products(display_order, created_at DESC);

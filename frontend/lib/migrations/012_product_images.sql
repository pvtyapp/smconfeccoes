-- ══════════════════════════════════════════════════════════════════
-- 012_product_images.sql
-- Portal do Cliente — Fase 2: fotos do catálogo transacional
-- Fonte única: LP e catálogo do cliente leem daqui (decisão 7 do plano)
-- ══════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_images (
  id            SERIAL PRIMARY KEY,
  product_id    UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color         TEXT,
  image_url     TEXT NOT NULL,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_images_product ON product_images(product_id);

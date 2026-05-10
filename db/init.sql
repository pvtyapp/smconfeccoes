-- SM Confecções — Schema inicial
-- Rodar no Railway PostgreSQL (psql ou Railway dashboard > Query)

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Catálogo da landing page
CREATE TABLE IF NOT EXISTS catalog_products (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  image_url     TEXT        NOT NULL,
  display_order INTEGER     NOT NULL DEFAULT 0,
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMP   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_active ON catalog_products (active, display_order ASC, created_at ASC);

-- ──────────────────────────────────────────────────────────────────────────────
-- Próximas tabelas (quando backend FastAPI for integrado):
-- products, product_variants, stock_movements, stock_balances,
-- operational_costs, production_orders, production_order_items
-- ──────────────────────────────────────────────────────────────────────────────

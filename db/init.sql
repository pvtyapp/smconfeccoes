-- SM Confecções — Schema completo
-- Rodar no Railway: Dashboard do projeto > Query

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Catálogo da Landing Page ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS catalog_products (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  image_url     TEXT         NOT NULL,
  display_order INTEGER      NOT NULL DEFAULT 0,
  active        BOOLEAN      NOT NULL DEFAULT true,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_catalog_active
  ON catalog_products (active, display_order ASC, created_at ASC);

-- ── Produtos pai ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS products (
  id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name               VARCHAR(255) NOT NULL,
  category           VARCHAR(100) NOT NULL DEFAULT '',
  description        TEXT,
  default_sale_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  average_cost       NUMERIC(10,2) NOT NULL DEFAULT 0,
  status             VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at         TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── Variações (unidade real de venda e estoque) ───────────────────────────────
CREATE TABLE IF NOT EXISTS product_variants (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id    UUID         NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  color         VARCHAR(100) NOT NULL DEFAULT '',
  size          VARCHAR(20)  NOT NULL DEFAULT '',
  sku           VARCHAR(100) UNIQUE NOT NULL,
  sale_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
  average_cost  NUMERIC(10,2) NOT NULL DEFAULT 0,
  min_stock     INTEGER      NOT NULL DEFAULT 0,
  target_stock  INTEGER      NOT NULL DEFAULT 0,
  status        VARCHAR(20)  NOT NULL DEFAULT 'active',
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_variants_product ON product_variants (product_id);

-- ── Custos operacionais ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS operational_costs (
  id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(255) NOT NULL,
  category      VARCHAR(100) NOT NULL DEFAULT '',
  type          VARCHAR(20)  NOT NULL DEFAULT 'fixed',
  monthly_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  active        BOOLEAN      NOT NULL DEFAULT true,
  notes         TEXT,
  created_at    TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── Ordens de produção ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_orders (
  id                    UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id            UUID         REFERENCES products(id) ON DELETE SET NULL,
  fabric_kg             NUMERIC(10,3) NOT NULL DEFAULT 0,
  fabric_cost_per_kg    NUMERIC(10,2) NOT NULL DEFAULT 0,
  sewing_cost_per_piece NUMERIC(10,2) NOT NULL DEFAULT 0,
  thread_cost           NUMERIC(10,2) NOT NULL DEFAULT 0,
  packaging_cost        NUMERIC(10,2) NOT NULL DEFAULT 0,
  other_costs           NUMERIC(10,2) NOT NULL DEFAULT 0,
  total_quantity        INTEGER      NOT NULL DEFAULT 0,
  total_cost            NUMERIC(10,2) NOT NULL DEFAULT 0,
  unit_cost             NUMERIC(10,2) NOT NULL DEFAULT 0,
  notes                 TEXT,
  created_at            TIMESTAMP    NOT NULL DEFAULT NOW()
);

-- ── Itens de ordem de produção ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS production_order_items (
  id                  UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
  production_order_id UUID    NOT NULL REFERENCES production_orders(id) ON DELETE CASCADE,
  variant_id          UUID    NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  quantity            INTEGER NOT NULL DEFAULT 0,
  created_at          TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ── Movimentações de estoque ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS stock_movements (
  id             UUID      PRIMARY KEY DEFAULT gen_random_uuid(),
  variant_id     UUID      NOT NULL REFERENCES product_variants(id) ON DELETE CASCADE,
  type           VARCHAR(10) NOT NULL CHECK (type IN ('in', 'out')),
  quantity       INTEGER   NOT NULL CHECK (quantity > 0),
  reason         VARCHAR(100) NOT NULL,
  channel        VARCHAR(50),
  reference_type VARCHAR(50),
  reference_id   UUID,
  notes          TEXT,
  created_at     TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_movements_variant ON stock_movements (variant_id);
CREATE INDEX IF NOT EXISTS idx_movements_date    ON stock_movements (created_at DESC);

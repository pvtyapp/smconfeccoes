-- ─────────────────────────────────────────────────────────────────────────────
-- 004_materia_prima.sql
-- Matéria Prima, Ordens de Produção (novo modelo), Revisão, Avarias
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Tipos de insumo (Moletom, Ribana, Cadarço…)
CREATE TABLE IF NOT EXISTS raw_materials (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL,
  unit       TEXT NOT NULL CHECK (unit IN ('kg', 'm')),
  unit_price NUMERIC(10,2) NOT NULL DEFAULT 0,
  status     TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Cada bobina / lote lançado
CREATE TABLE IF NOT EXISTS raw_material_entries (
  id                   SERIAL PRIMARY KEY,
  material_id          INTEGER NOT NULL REFERENCES raw_materials(id),
  number               TEXT NOT NULL UNIQUE,                         -- LOT-0001
  total_qty            NUMERIC(10,3) NOT NULL,                       -- kg ou metros
  unit_price           NUMERIC(10,2) NOT NULL,
  total_cost           NUMERIC(10,2) GENERATED ALWAYS AS (total_qty * unit_price) STORED,
  status               TEXT NOT NULL DEFAULT 'disponivel',           -- disponivel | usada | esgotada
  supplier             TEXT,
  notes                TEXT,
  total_pieces_produced INTEGER NOT NULL DEFAULT 0,                  -- acumula peças ao longo das ordens
  cost_per_piece       NUMERIC(10,4),                                -- calculado quando esgotada
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exhausted_at         TIMESTAMPTZ
);

-- 3. Ordens de produção (novo modelo, separado do legado production_orders)
CREATE TABLE IF NOT EXISTS prod_orders (
  id           SERIAL PRIMARY KEY,
  number       TEXT NOT NULL UNIQUE,                  -- OP-0001
  product_id   INTEGER REFERENCES products(id),
  product_name TEXT,                                  -- snapshot
  status       TEXT NOT NULL DEFAULT 'rascunho',      -- rascunho | em_producao | concluida | em_revisao | encerrada
  cost_status  TEXT NOT NULL DEFAULT 'pendente',      -- pendente | calculado
  unit_cost    NUMERIC(10,4),                         -- custo médio/peça (preenchido ao calcular)
  total_cost   NUMERIC(10,2),
  notes        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  concluded_at TIMESTAMPTZ
);

-- 4. Itens da ordem: variações + quantidades
CREATE TABLE IF NOT EXISTS prod_order_items (
  id           SERIAL PRIMARY KEY,
  order_id     INTEGER NOT NULL REFERENCES prod_orders(id) ON DELETE CASCADE,
  variant_id   UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name TEXT NOT NULL,
  color        TEXT NOT NULL,
  size         TEXT NOT NULL,
  qty_planned  INTEGER NOT NULL DEFAULT 0,
  qty_produced INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 5. Bobinas usadas por ordem
CREATE TABLE IF NOT EXISTS prod_order_materials (
  id               SERIAL PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES prod_orders(id) ON DELETE CASCADE,
  entry_id         INTEGER NOT NULL REFERENCES raw_material_entries(id),
  pieces_from_entry INTEGER NOT NULL DEFAULT 0,        -- peças desta ordem vindas desta bobina
  exhausted_here   BOOLEAN NOT NULL DEFAULT false,    -- esta ordem esgotou a bobina?
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Revisão por cor (gerado quando ordem vai para em_revisao)
CREATE TABLE IF NOT EXISTS prod_revision_batches (
  id               SERIAL PRIMARY KEY,
  order_id         INTEGER NOT NULL REFERENCES prod_orders(id) ON DELETE CASCADE,
  color            TEXT NOT NULL,
  qty_total        INTEGER NOT NULL DEFAULT 0,
  qty_approved     INTEGER,                           -- peças aprovadas na revisão
  qty_defect       INTEGER,                           -- avarias
  status           TEXT NOT NULL DEFAULT 'pendente',  -- pendente | concluido
  concluded_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. Estoque de avarias
CREATE TABLE IF NOT EXISTS defect_stock (
  id          SERIAL PRIMARY KEY,
  variant_id  UUID REFERENCES product_variants(id) ON DELETE SET NULL,
  product_name TEXT,
  color       TEXT,
  size        TEXT,
  qty         INTEGER NOT NULL DEFAULT 0,
  order_id    INTEGER REFERENCES prod_orders(id) ON DELETE SET NULL,
  disposition TEXT NOT NULL DEFAULT 'pendente',       -- pendente | reaproveitado | vendido | descartado
  notes       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Sequências
CREATE SEQUENCE IF NOT EXISTS prod_order_number_seq START 1;
CREATE SEQUENCE IF NOT EXISTS raw_material_entry_number_seq START 1;

-- Índices
CREATE INDEX IF NOT EXISTS idx_raw_material_entries_material ON raw_material_entries(material_id);
CREATE INDEX IF NOT EXISTS idx_raw_material_entries_status   ON raw_material_entries(status);
CREATE INDEX IF NOT EXISTS idx_prod_orders_status            ON prod_orders(status);
CREATE INDEX IF NOT EXISTS idx_prod_order_items_order        ON prod_order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_prod_order_materials_order    ON prod_order_materials(order_id);
CREATE INDEX IF NOT EXISTS idx_prod_order_materials_entry    ON prod_order_materials(entry_id);
CREATE INDEX IF NOT EXISTS idx_prod_revision_order           ON prod_revision_batches(order_id);
CREATE INDEX IF NOT EXISTS idx_defect_stock_variant          ON defect_stock(variant_id);

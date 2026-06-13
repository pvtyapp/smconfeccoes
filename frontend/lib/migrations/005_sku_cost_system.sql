-- ─────────────────────────────────────────────────────────────────────────────
-- 005_sku_cost_system.sql
-- Sistema de custo por SKU: BOM, pesos por tamanho, custo acumulado
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Variantes de cor dos insumos (filha — faltava no banco)
CREATE TABLE IF NOT EXISTS raw_material_variants (
  id           SERIAL PRIMARY KEY,
  material_id  INTEGER NOT NULL REFERENCES raw_materials(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,               -- "Cinza Mescla", "Preto", etc.
  auto_destock BOOLEAN NOT NULL DEFAULT false,
  min_qty      INTEGER,                     -- mínimo de bobinas para alerta
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(material_id, name)
);

-- 2. Liga lotes (raw_material_entries) às variantes de cor
ALTER TABLE raw_material_entries
  ADD COLUMN IF NOT EXISTS variant_id INTEGER REFERENCES raw_material_variants(id) ON DELETE SET NULL;

-- 3. Pesos por tamanho (NULL em product_id = padrão global)
--    Regra: se existe registro específico do produto usa ele,
--           senão cai no global (product_id IS NULL).
CREATE TABLE IF NOT EXISTS size_weights (
  id         SERIAL PRIMARY KEY,
  product_id INTEGER REFERENCES products(id) ON DELETE CASCADE,  -- NULL = global
  size       TEXT NOT NULL,
  weight     NUMERIC(6,4) NOT NULL,
  UNIQUE(product_id, size)
);

-- Defaults globais
INSERT INTO size_weights (product_id, size, weight) VALUES
  (NULL, 'PP',   0.75),
  (NULL, 'P',    0.85),
  (NULL, 'M',    1.00),
  (NULL, 'G',    1.15),
  (NULL, 'GG',   1.30),
  (NULL, 'XGG',  1.45),
  (NULL, 'XXXL', 1.60)
ON CONFLICT (product_id, size) DO NOTHING;

-- 4. BOM — Receita de produção por produto
--    qty_per_piece_base = quantidade do insumo por peça no tamanho M (base)
--    color_match:
--      'same'  → cor do produto = cor da variante do insumo (ex: Cinza Mescla)
--      'any'   → não importa a cor (ex: cadarço sempre preto independente da cor do produto)
CREATE TABLE IF NOT EXISTS product_bom (
  id                SERIAL PRIMARY KEY,
  product_id        INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  material_id       INTEGER NOT NULL REFERENCES raw_materials(id),
  material_name     TEXT NOT NULL,        -- snapshot
  qty_per_piece_base NUMERIC(10,4) NOT NULL,
  unit              TEXT NOT NULL,
  color_match       TEXT NOT NULL DEFAULT 'same' CHECK (color_match IN ('same','any')),
  variant_override  TEXT,                 -- quando color_match='any', qual variante usar (ex: 'Preto')
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, material_id)
);

-- 5. Registro de custo por SKU por ordem
--    Criado automaticamente ao concluir cada ordem.
--    É o log imutável; product_variant_costs agrega a partir daqui.
CREATE TABLE IF NOT EXISTS sku_cost_records (
  id             SERIAL PRIMARY KEY,
  order_id       INTEGER NOT NULL REFERENCES prod_orders(id) ON DELETE CASCADE,
  product_id     INTEGER REFERENCES products(id) ON DELETE SET NULL,
  product_name   TEXT NOT NULL,           -- snapshot
  color          TEXT NOT NULL,
  size           TEXT NOT NULL,
  qty_produced   INTEGER NOT NULL,
  size_weight    NUMERIC(6,4) NOT NULL,   -- peso usado no cálculo
  cost_material  NUMERIC(10,4) NOT NULL,
  cost_sewing    NUMERIC(10,4),           -- preenchido pelo módulo de costura
  cost_total     NUMERIC(10,4),           -- material + sewing + proporcional operacional
  calculated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 6. Custo acumulado por SKU (média ponderada sobre todas as ordens)
--    Atualizado automaticamente após cada ordem concluída.
CREATE TABLE IF NOT EXISTS product_variant_costs (
  id              SERIAL PRIMARY KEY,
  product_id      INTEGER REFERENCES products(id) ON DELETE CASCADE,
  product_name    TEXT NOT NULL,
  color           TEXT NOT NULL,
  size            TEXT NOT NULL,
  avg_material    NUMERIC(10,4),
  avg_sewing      NUMERIC(10,4),
  avg_total       NUMERIC(10,4),
  sample_count    INTEGER NOT NULL DEFAULT 0,  -- nº de ordens que alimentaram esta média
  last_updated    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(product_id, color, size)
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_raw_material_variants_material ON raw_material_variants(material_id);
CREATE INDEX IF NOT EXISTS idx_raw_material_entries_variant   ON raw_material_entries(variant_id);
CREATE INDEX IF NOT EXISTS idx_size_weights_product           ON size_weights(product_id);
CREATE INDEX IF NOT EXISTS idx_product_bom_product            ON product_bom(product_id);
CREATE INDEX IF NOT EXISTS idx_product_bom_material           ON product_bom(material_id);
CREATE INDEX IF NOT EXISTS idx_sku_cost_records_order         ON sku_cost_records(order_id);
CREATE INDEX IF NOT EXISTS idx_sku_cost_records_product       ON sku_cost_records(product_id, color, size);
CREATE INDEX IF NOT EXISTS idx_product_variant_costs_product  ON product_variant_costs(product_id, color, size);

-- ─── FUNÇÃO: calcular e persistir custo por SKU ao concluir ordem ─────────────
-- Chamada pelo backend após salvar prod_order_materials.
-- Parâmetros: p_order_id, p_sewing_cost_total (custo costura desta ordem)
CREATE OR REPLACE FUNCTION calculate_sku_costs(
  p_order_id         INTEGER,
  p_sewing_cost_total NUMERIC DEFAULT 0
) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
  v_product_id   INTEGER;
  v_product_name TEXT;
  v_total_material NUMERIC;
  v_row          RECORD;
  v_weight       NUMERIC;
  v_weight_total NUMERIC;
  v_cost_mat_per_wunit NUMERIC;
  v_cost_sew_per_wunit NUMERIC;
  v_cost_mat     NUMERIC;
  v_cost_sew     NUMERIC;
  v_cost_total   NUMERIC;
  v_old_avg_mat  NUMERIC;
  v_old_avg_sew  NUMERIC;
  v_old_count    INTEGER;
BEGIN
  -- Cabeçalho da ordem
  SELECT product_id, COALESCE(product_name,'') INTO v_product_id, v_product_name
  FROM prod_orders WHERE id = p_order_id;

  -- Custo total de material desta ordem
  -- (soma dos custos das bobinas × proporção de peças tiradas desta ordem)
  SELECT COALESCE(SUM(
    rme.unit_price * rme.total_qty *
    (pom.pieces_from_entry::NUMERIC / NULLIF(rme.total_pieces_produced,0))
  ), 0)
  INTO v_total_material
  FROM prod_order_materials pom
  JOIN raw_material_entries rme ON rme.id = pom.entry_id
  WHERE pom.order_id = p_order_id;

  -- Weighted total das peças da ordem (para distribuir custo por tamanho)
  SELECT COALESCE(SUM(
    poi.qty_produced *
    COALESCE(
      (SELECT sw.weight FROM size_weights sw WHERE sw.product_id = v_product_id AND sw.size = poi.size LIMIT 1),
      (SELECT sw.weight FROM size_weights sw WHERE sw.product_id IS NULL AND sw.size = poi.size LIMIT 1),
      1.0
    )
  ), 0)
  INTO v_weight_total
  FROM prod_order_items poi
  WHERE poi.order_id = p_order_id AND poi.qty_produced > 0;

  IF v_weight_total = 0 THEN RETURN; END IF;

  v_cost_mat_per_wunit := v_total_material  / v_weight_total;
  v_cost_sew_per_wunit := p_sewing_cost_total / v_weight_total;

  -- Para cada item (cor × tamanho) da ordem
  FOR v_row IN
    SELECT color, size, SUM(qty_produced) AS qty
    FROM prod_order_items
    WHERE order_id = p_order_id AND qty_produced > 0
    GROUP BY color, size
  LOOP
    -- Peso do tamanho
    SELECT COALESCE(
      (SELECT sw.weight FROM size_weights sw WHERE sw.product_id = v_product_id AND sw.size = v_row.size LIMIT 1),
      (SELECT sw.weight FROM size_weights sw WHERE sw.product_id IS NULL AND sw.size = v_row.size LIMIT 1),
      1.0
    ) INTO v_weight;

    v_cost_mat   := v_cost_mat_per_wunit * v_weight;
    v_cost_sew   := v_cost_sew_per_wunit * v_weight;
    v_cost_total := v_cost_mat + v_cost_sew;

    -- Insere registro imutável
    INSERT INTO sku_cost_records
      (order_id, product_id, product_name, color, size, qty_produced,
       size_weight, cost_material, cost_sewing, cost_total)
    VALUES
      (p_order_id, v_product_id, v_product_name, v_row.color, v_row.size, v_row.qty,
       v_weight, v_cost_mat, v_cost_sew, v_cost_total)
    ON CONFLICT DO NOTHING;

    -- Atualiza média acumulada (weighted running average)
    SELECT avg_material, avg_sewing, sample_count
    INTO v_old_avg_mat, v_old_avg_sew, v_old_count
    FROM product_variant_costs
    WHERE product_id = v_product_id AND color = v_row.color AND size = v_row.size;

    IF NOT FOUND THEN
      INSERT INTO product_variant_costs
        (product_id, product_name, color, size, avg_material, avg_sewing, avg_total, sample_count)
      VALUES
        (v_product_id, v_product_name, v_row.color, v_row.size,
         v_cost_mat, v_cost_sew, v_cost_total, v_row.qty);
    ELSE
      UPDATE product_variant_costs SET
        avg_material  = (v_old_avg_mat * v_old_count + v_cost_mat * v_row.qty) / (v_old_count + v_row.qty),
        avg_sewing    = (v_old_avg_sew * v_old_count + v_cost_sew * v_row.qty) / (v_old_count + v_row.qty),
        avg_total     = ((v_old_avg_mat + v_old_avg_sew) * v_old_count + v_cost_total * v_row.qty) / (v_old_count + v_row.qty),
        sample_count  = v_old_count + v_row.qty,
        last_updated  = NOW()
      WHERE product_id = v_product_id AND color = v_row.color AND size = v_row.size;
    END IF;
  END LOOP;
END;
$$;

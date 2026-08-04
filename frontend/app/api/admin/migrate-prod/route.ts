import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// POST /api/admin/migrate-prod
// Idempotent — safe to run multiple times.
// Creates: prod_order_logs, size_weights
// Alters:  prod_order_materials (adds color column)
//          raw_materials (product_id), raw_material_entries (ficha técnica da
//          bobina de tecido: tecido, tipo_tecido, peso_kg, gramatura, largura_m,
//          preco_kg) — fluxo novo de bobina nascendo na Programação de Produção
// Replaces: calculate_sku_costs() — custo de material passa a ser por cor
//          (cada cor tem sua bobina própria), custo de costura continua pool
//          da ordem inteira (tempo de costura não depende de qual bobina veio)
export async function POST() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS prod_order_logs (
        id         SERIAL PRIMARY KEY,
        order_id   INT NOT NULL,
        event      TEXT NOT NULL,
        payload    JSONB,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_prod_order_logs_order_id
        ON prod_order_logs (order_id)
    `)

    await pool.query(`
      CREATE TABLE IF NOT EXISTS size_weights (
        id         SERIAL PRIMARY KEY,
        product_id INT,
        size       TEXT NOT NULL,
        weight     NUMERIC NOT NULL DEFAULT 1.0,
        UNIQUE (product_id, size)
      )
    `)

    // Default global weights (product_id NULL = applies to all products)
    await pool.query(`
      INSERT INTO size_weights (product_id, size, weight) VALUES
        (NULL, 'PP',   0.85),
        (NULL, 'P',    1.00),
        (NULL, 'M',    1.10),
        (NULL, 'G',    1.20),
        (NULL, 'GG',   1.40),
        (NULL, 'XGG',  1.60),
        (NULL, 'XXXL', 1.80)
      ON CONFLICT DO NOTHING
    `)

    await pool.query(`
      ALTER TABLE prod_order_materials ADD COLUMN IF NOT EXISTS color TEXT
    `)

    // ── Bobina de tecido nascendo na Programação de Produção ──────────────────
    await pool.query(`ALTER TABLE raw_materials ADD COLUMN IF NOT EXISTS product_id UUID REFERENCES products(id)`)
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_raw_materials_product ON raw_materials(product_id)`)

    await pool.query(`ALTER TABLE raw_material_entries ADD COLUMN IF NOT EXISTS tecido TEXT`)
    await pool.query(`ALTER TABLE raw_material_entries ADD COLUMN IF NOT EXISTS tipo_tecido TEXT CHECK (tipo_tecido IN ('aberto','tubular'))`)
    await pool.query(`ALTER TABLE raw_material_entries ADD COLUMN IF NOT EXISTS peso_kg NUMERIC(10,3)`)
    await pool.query(`ALTER TABLE raw_material_entries ADD COLUMN IF NOT EXISTS gramatura NUMERIC(10,2)`)
    await pool.query(`ALTER TABLE raw_material_entries ADD COLUMN IF NOT EXISTS largura_m NUMERIC(6,3)`)
    await pool.query(`ALTER TABLE raw_material_entries ADD COLUMN IF NOT EXISTS preco_kg NUMERIC(10,2)`)

    // unit_price só tinha 2 casas decimais — ao recalcular total_cost (coluna
    // gerada = total_qty × unit_price) o arredondamento divergia alguns
    // centavos do peso×preço/kg original. Mais casas, menos deriva. Postgres não
    // deixa alterar o tipo de uma coluna usada por coluna gerada — precisa
    // dropar e recriar (idempotente: só corre se ainda estiver em 2 casas).
    const { rows: upScale } = await pool.query(`
      SELECT numeric_scale FROM information_schema.columns
      WHERE table_name='raw_material_entries' AND column_name='unit_price'
    `)
    if (upScale[0]?.numeric_scale < 4) {
      await pool.query(`ALTER TABLE raw_material_entries DROP COLUMN total_cost`)
      await pool.query(`ALTER TABLE raw_material_entries ALTER COLUMN unit_price TYPE NUMERIC(10,4)`)
      await pool.query(`ALTER TABLE raw_material_entries ADD COLUMN total_cost NUMERIC(10,2) GENERATED ALWAYS AS (total_qty * unit_price) STORED`)
    }

    // ── calculate_sku_costs: custo de material agora é por cor ────────────────
    // Antes: somava o custo de material de TODAS as bobinas da ordem num pote só
    // e distribuía por peso de tamanho pra todas as cores igual. Com 1 bobina por
    // cor isso ficava errado sempre que a ordem tinha 2+ cores com bobinas de
    // custo diferente. Agora o material é somado e distribuído só dentro de cada
    // cor; a costura continua sendo um pool da ordem inteira (tempo de costura
    // não muda conforme a bobina).
    await pool.query(`
      CREATE OR REPLACE FUNCTION calculate_sku_costs(
        p_order_id         INTEGER,
        p_sewing_cost_total NUMERIC DEFAULT 0
      ) RETURNS VOID LANGUAGE plpgsql AS $$
      DECLARE
        v_product_id   UUID;
        v_product_name TEXT;
        v_color        TEXT;
        v_total_material NUMERIC;
        v_row          RECORD;
        v_weight       NUMERIC;
        v_weight_total_color NUMERIC;
        v_weight_total_order NUMERIC;
        v_cost_mat_per_wunit NUMERIC;
        v_cost_sew_per_wunit NUMERIC;
        v_cost_mat     NUMERIC;
        v_cost_sew     NUMERIC;
        v_cost_total   NUMERIC;
        v_old_avg_mat  NUMERIC;
        v_old_avg_sew  NUMERIC;
        v_old_count    INTEGER;
      BEGIN
        SELECT product_id, COALESCE(product_name,'') INTO v_product_id, v_product_name
        FROM prod_orders WHERE id = p_order_id;

        -- Weighted total da ordem inteira (usado só pra ratear custo de costura)
        SELECT COALESCE(SUM(
          poi.qty_produced *
          COALESCE(
            (SELECT sw.weight FROM size_weights sw WHERE sw.product_id = v_product_id AND sw.size = poi.size LIMIT 1),
            (SELECT sw.weight FROM size_weights sw WHERE sw.product_id IS NULL AND sw.size = poi.size LIMIT 1),
            1.0
          )
        ), 0)
        INTO v_weight_total_order
        FROM prod_order_items poi
        WHERE poi.order_id = p_order_id AND poi.qty_produced > 0;

        IF v_weight_total_order = 0 THEN RETURN; END IF;

        v_cost_sew_per_wunit := p_sewing_cost_total / v_weight_total_order;

        -- Para cada cor da ordem, separado
        FOR v_color IN
          SELECT DISTINCT color FROM prod_order_items
          WHERE order_id = p_order_id AND qty_produced > 0
        LOOP
          -- Custo de material só das bobinas ligadas a ESSA cor
          SELECT COALESCE(SUM(
            rme.unit_price * rme.total_qty *
            (pom.pieces_from_entry::NUMERIC / NULLIF(rme.total_pieces_produced,0))
          ), 0)
          INTO v_total_material
          FROM prod_order_materials pom
          JOIN raw_material_entries rme ON rme.id = pom.entry_id
          WHERE pom.order_id = p_order_id AND pom.color = v_color;

          -- Weighted total só dessa cor (pra ratear o material dela)
          SELECT COALESCE(SUM(
            poi.qty_produced *
            COALESCE(
              (SELECT sw.weight FROM size_weights sw WHERE sw.product_id = v_product_id AND sw.size = poi.size LIMIT 1),
              (SELECT sw.weight FROM size_weights sw WHERE sw.product_id IS NULL AND sw.size = poi.size LIMIT 1),
              1.0
            )
          ), 0)
          INTO v_weight_total_color
          FROM prod_order_items poi
          WHERE poi.order_id = p_order_id AND poi.color = v_color AND poi.qty_produced > 0;

          v_cost_mat_per_wunit := CASE WHEN v_weight_total_color > 0 THEN v_total_material / v_weight_total_color ELSE 0 END;

          FOR v_row IN
            SELECT size, SUM(qty_produced) AS qty
            FROM prod_order_items
            WHERE order_id = p_order_id AND color = v_color AND qty_produced > 0
            GROUP BY size
          LOOP
            SELECT COALESCE(
              (SELECT sw.weight FROM size_weights sw WHERE sw.product_id = v_product_id AND sw.size = v_row.size LIMIT 1),
              (SELECT sw.weight FROM size_weights sw WHERE sw.product_id IS NULL AND sw.size = v_row.size LIMIT 1),
              1.0
            ) INTO v_weight;

            v_cost_mat   := v_cost_mat_per_wunit * v_weight;
            v_cost_sew   := v_cost_sew_per_wunit * v_weight;
            v_cost_total := v_cost_mat + v_cost_sew;

            INSERT INTO sku_cost_records
              (order_id, product_id, product_name, color, size, qty_produced,
               size_weight, cost_material, cost_sewing, cost_total)
            VALUES
              (p_order_id, v_product_id, v_product_name, v_color, v_row.size, v_row.qty,
               v_weight, v_cost_mat, v_cost_sew, v_cost_total)
            ON CONFLICT DO NOTHING;

            SELECT avg_material, avg_sewing, sample_count
            INTO v_old_avg_mat, v_old_avg_sew, v_old_count
            FROM product_variant_costs
            WHERE product_id = v_product_id AND color = v_color AND size = v_row.size;

            IF NOT FOUND THEN
              INSERT INTO product_variant_costs
                (product_id, product_name, color, size, avg_material, avg_sewing, avg_total, sample_count)
              VALUES
                (v_product_id, v_product_name, v_color, v_row.size,
                 v_cost_mat, v_cost_sew, v_cost_total, v_row.qty);
            ELSE
              UPDATE product_variant_costs SET
                avg_material  = (v_old_avg_mat * v_old_count + v_cost_mat * v_row.qty) / (v_old_count + v_row.qty),
                avg_sewing    = (v_old_avg_sew * v_old_count + v_cost_sew * v_row.qty) / (v_old_count + v_row.qty),
                avg_total     = ((v_old_avg_mat + v_old_avg_sew) * v_old_count + v_cost_total * v_row.qty) / (v_old_count + v_row.qty),
                sample_count  = v_old_count + v_row.qty,
                last_updated  = NOW()
              WHERE product_id = v_product_id AND color = v_color AND size = v_row.size;
            END IF;
          END LOOP;
        END LOOP;
      END;
      $$
    `)

    const { rows: dbInfo } = await pool.query(`SELECT current_database() AS db, inet_server_addr()::text AS host`)
    const { rows: cols } = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name='raw_material_entries' AND column_name IN ('tecido','tipo_tecido','peso_kg','gramatura','largura_m','preco_kg')
      ORDER BY column_name
    `)

    return NextResponse.json({
      success: true, message: "Migração concluída",
      diag: { db: dbInfo[0], colunasNovas: cols.map(c => c.column_name) },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

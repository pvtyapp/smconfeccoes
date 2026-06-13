import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

export async function POST() {
  const client = await pool.connect()
  try {
    await client.query("BEGIN")

    // metros pode ser nulo (pedidos criados via chat não têm metragem inicial)
    await client.query(`ALTER TABLE dtf_pedidos ALTER COLUMN metros DROP NOT NULL`)

    // dtf_pedidos — new columns
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS contact_id    INT REFERENCES wa_contacts(id)`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS status        TEXT NOT NULL DEFAULT 'concluido'`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS source        TEXT NOT NULL DEFAULT 'manual'`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS metros_finais NUMERIC(10,2)`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS largura_cm    NUMERIC(6,1)`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS number        TEXT`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS due_date      DATE`)
    await client.query(`ALTER TABLE dtf_pedidos ADD COLUMN IF NOT EXISTS concluded_at  TIMESTAMPTZ`)

    // Sequence for DTF order numbers
    await client.query(`CREATE SEQUENCE IF NOT EXISTS dtf_order_number_seq START 1`)

    // Backfill number for existing rows
    await client.query(`
      UPDATE dtf_pedidos
      SET number = 'DTF-' || LPAD(id::text, 4, '0')
      WHERE number IS NULL
    `)

    // Unique index on number
    await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_dtf_pedidos_number ON dtf_pedidos(number) WHERE number IS NOT NULL
    `)

    // dtf_order_attachments
    await client.query(`
      CREATE TABLE IF NOT EXISTS dtf_order_attachments (
        id         SERIAL PRIMARY KEY,
        pedido_id  INT NOT NULL REFERENCES dtf_pedidos(id) ON DELETE CASCADE,
        blob_url   TEXT NOT NULL,
        filename   TEXT,
        mime_type  TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `)

    // app_settings — seed default keys
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('pix_key', '') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('dtf_preco_por_metro', '0') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('nome_empresa', 'SM Confecções') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('endereco_retirada', 'Av. Santa Cruz, 3088') ON CONFLICT (key) DO NOTHING`)

    // Cron re-engagement message templates
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('ausente_d7_msg',  '{nome}, tudo bem? Faz uns dias que não nos falamos. Quando precisar de estoque é só chamar!') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('ausente_d15_msg', 'Estamos com estoque renovado, {nome}. Quando precisar é só chamar.') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('ausente_d30_msg', '{nome}, novidade no estoque! Me chama quando quiser dar uma olhada.') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('curioso_c7_msg',  'Oi {nome}! Ainda temos aquele produto disponível. Quer confirmar o pedido?') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('curioso_c14_msg', '{nome}, esse produto tá saindo bastante. Me chama antes de acabar o estoque!') ON CONFLICT (key) DO NOTHING`)
    await client.query(`INSERT INTO app_settings (key, value) VALUES ('curioso_c21_msg', 'Última chamada, {nome} — estoque limitado nessa peça. Me chama hoje!') ON CONFLICT (key) DO NOTHING`)

    await client.query("COMMIT")
    return NextResponse.json({ ok: true })
  } catch (err) {
    await client.query("ROLLBACK")
    return NextResponse.json({ error: String(err) }, { status: 500 })
  } finally {
    client.release()
  }
}

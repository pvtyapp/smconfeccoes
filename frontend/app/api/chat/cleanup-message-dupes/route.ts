import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// One-shot, disparado manualmente pelo operador (não é chamado por nenhuma tela):
// remove duplicatas de wa_messages já existentes hoje, causadas pelos pontos que
// gravavam mensagem automática sem message_id (corrigido no código). Duas linhas
// do mesmo contact_id+direction+content dentro de 60s são consideradas a mesma
// mensagem; mantém a que já tem message_id preenchido (ou a mais antiga, se as
// duas tiverem ou as duas não tiverem).
export async function POST() {
  try {
    const { rows: preview } = await pool.query(`
      SELECT COUNT(*)::int AS n FROM wa_messages dup
      WHERE EXISTS (
        SELECT 1 FROM wa_messages keep
        WHERE keep.contact_id = dup.contact_id
          AND keep.direction  = dup.direction
          AND keep.content    = dup.content
          AND keep.id <> dup.id
          AND keep.created_at BETWEEN dup.created_at - INTERVAL '60 seconds' AND dup.created_at + INTERVAL '60 seconds'
          AND (
            keep.message_id IS NOT NULL AND dup.message_id IS NULL
            OR (keep.message_id IS NULL) = (dup.message_id IS NULL) AND keep.id < dup.id
          )
      )
    `)

    const { rowCount } = await pool.query(`
      DELETE FROM wa_messages dup
      WHERE EXISTS (
        SELECT 1 FROM wa_messages keep
        WHERE keep.contact_id = dup.contact_id
          AND keep.direction  = dup.direction
          AND keep.content    = dup.content
          AND keep.id <> dup.id
          AND keep.created_at BETWEEN dup.created_at - INTERVAL '60 seconds' AND dup.created_at + INTERVAL '60 seconds'
          AND (
            keep.message_id IS NOT NULL AND dup.message_id IS NULL
            OR (keep.message_id IS NULL) = (dup.message_id IS NULL) AND keep.id < dup.id
          )
      )
    `)

    return NextResponse.json({ ok: true, previewCount: preview[0]?.n ?? 0, deleted: rowCount ?? 0 })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

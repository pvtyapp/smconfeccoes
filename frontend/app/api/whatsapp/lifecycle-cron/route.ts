import { NextResponse } from "next/server"
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"

// Vercel Cron: 0 11-23 * * * (08h–20h Brasília, de hora em hora)
//
// Separado do /api/whatsapp/cron (roda 1x/dia, cobrança/limpeza/watchdog) de
// propósito: antes o lifecycle mandava até 12 mensagens (3 por etapa x 4
// etapas) tudo junto às 9h, em menos de 1 minuto — padrão óbvio de bot. Agora
// manda no máximo 1 mensagem por hora, entre 08h e 20h — a própria grade do
// cron já impõe o espaçamento, sem precisar de trava por timestamp.
export async function GET(req: Request) {
  const auth = req.headers.get("authorization")
  if (!process.env.CRON_SECRET || auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const results = { novo: 0, ausente: 0, frio: 0, errors: 0 }

  // Cron do Vercel já limita a 08h-20h BRT (schedule "0 11-23 * * *"), esse
  // guard é só rede de segurança pra chamada manual/errada fora da janela.
  const brHour = new Date(Date.now() - 3 * 3600 * 1000).getUTCHours()
  if (brHour < 8 || brHour > 20) {
    return NextResponse.json({ ok: true, skipped: "fora da janela 08h-20h" })
  }

  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS last_marketing_sent_at TIMESTAMPTZ`).catch(() => {})
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS marketing_optout BOOLEAN DEFAULT FALSE`).catch(() => {})
  await pool.query(`ALTER TABLE wa_contacts ADD COLUMN IF NOT EXISTS linked_user_id INTEGER REFERENCES users(id)`).catch(() => {})

  const settingsRes = await pool.query("SELECT key, value FROM app_settings")
  const s: Record<string, string> = {}
  for (const row of settingsRes.rows) s[row.key] = row.value

  const chatbotAtivo    = s.chatbot_ativo !== "false"
  const lifecycleActive = s.lifecycle_ativo !== "false"

  function t(template: string, name: string) {
    return (template || "").replace(/\{nome\}/gi, name.split(" ")[0])
  }

  if (chatbotAtivo && lifecycleActive) {
    // No máximo 1 mensagem de lifecycle por chamada (= por hora) — tenta cada
    // etapa em ordem de prioridade, para na primeira que encontrar candidato.
    let sent = false

    // ── 1. Novo D2 — lead que não converteu em 48h ──────────────────────────
    try {
      if (!sent) {
        const rows = await pool.query(`
          SELECT id, jid, name, jid AS send_jid FROM wa_contacts
          WHERE lifecycle_state = 'new'
          AND linked_user_id IS NULL
            AND COALESCE(novo_seq, 0) = 0
            AND state = 'idle'
            AND created_at < NOW() - INTERVAL '2 days'
            AND NOT COALESCE(marketing_optout, false)
            AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
          LIMIT 1
        `)
        for (const c of rows.rows) {
          const cli = await pool.connect()
          try {
            await cli.query("BEGIN")
            await cli.query(`
              UPDATE wa_contacts
              SET novo_seq = 1, novo_last_sent_at = NOW(), last_marketing_sent_at = NOW(), updated_at = NOW()
              WHERE id = $1
            `, [c.id])
            {
              const msg = t(
                s.novo_d2_msg || "Oi {nome}! Quando quiser fazer um pedido é só me chamar — produto, cor e tamanho que eu registro na hora.",
                c.name
              )
              const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
              await cli.query(
                `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
                 VALUES ($1, $2, 'out', $3, NOW())
                 ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
                [c.id, result?.key?.id ?? null, msg]
              )
            }
            await cli.query("COMMIT")
            await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D2')`, [c.id]).catch(() => {})
            results.novo++
            sent = true
          } catch {
            await cli.query("ROLLBACK").catch(() => {})
            results.errors++
          } finally {
            cli.release()
          }
        }
      }
    } catch { results.errors++ }

    // ── 2. Novo → Frio (sem resposta por 7 dias após D2) ────────────────────
    try {
      const rows = await pool.query(`
        SELECT id FROM wa_contacts
        WHERE lifecycle_state = 'new'
        AND linked_user_id IS NULL
          AND COALESCE(novo_seq, 0) = 1
          AND state = 'idle'
          AND novo_last_sent_at < NOW() - INTERVAL '7 days'
      `)
      for (const c of rows.rows) {
        try {
          await pool.query(`UPDATE wa_contacts SET lifecycle_state = 'frio', lifecycle_updated_at = NOW() WHERE id = $1`, [c.id])
          results.frio++
        } catch { results.errors++ }
      }
    } catch { results.errors++ }

    // ── 3. Ativo → Ausente D15 ───────────────────────────────────────────────
    try {
      if (!sent) {
        const rows = await pool.query(`
          SELECT id, jid, name, jid AS send_jid FROM wa_contacts
          WHERE lifecycle_state = 'active'
          AND linked_user_id IS NULL
            AND last_order_at IS NOT NULL
            AND last_order_at < NOW() - INTERVAL '15 days'
            AND state NOT IN ('coletando','aguardando_menu','aguardando_cliente_1',
                              'dtf_verificando','dtf_coletando','cross_sell_dtf','cross_sell_produto')
            AND NOT COALESCE(marketing_optout, false)
            AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
          LIMIT 1
        `)
        for (const c of rows.rows) {
          const cli = await pool.connect()
          try {
            await cli.query("BEGIN")
            await cli.query(`
              UPDATE wa_contacts
              SET lifecycle_state = 'ausente', lifecycle_updated_at = NOW(),
                  ausente_seq = 1, ausente_last_sent_at = NOW(), last_marketing_sent_at = NOW()
              WHERE id = $1
            `, [c.id])
            {
              const msg = t(
                s.ausente_d15_msg || "Oi {nome}, faz um tempo! Estoque renovado aqui. Quando quiser pedir é só chamar.",
                c.name
              )
              const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
              await cli.query(
                `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
                 VALUES ($1, $2, 'out', $3, NOW())
                 ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
                [c.id, result?.key?.id ?? null, msg]
              )
            }
            await cli.query("COMMIT")
            await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D15')`, [c.id]).catch(() => {})
            results.ausente++
            sent = true
          } catch {
            await cli.query("ROLLBACK").catch(() => {})
            results.errors++
          } finally {
            cli.release()
          }
        }
      }
    } catch { results.errors++ }

    // ── 4. Ausente D30 ───────────────────────────────────────────────────────
    try {
      if (!sent) {
        const rows = await pool.query(`
          SELECT id, jid, name, jid AS send_jid FROM wa_contacts
          WHERE lifecycle_state = 'ausente'
          AND linked_user_id IS NULL
            AND ausente_seq = 1
            AND last_order_at IS NOT NULL
            AND last_order_at < NOW() - INTERVAL '30 days'
            AND NOT COALESCE(marketing_optout, false)
            AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
          LIMIT 1
        `)
        for (const c of rows.rows) {
          const cli = await pool.connect()
          try {
            await cli.query("BEGIN")
            await cli.query(`UPDATE wa_contacts SET ausente_seq = 2, ausente_last_sent_at = NOW(), last_marketing_sent_at = NOW() WHERE id = $1`, [c.id])
            {
              const msg = t(
                s.ausente_d30_msg || "{nome}, chegaram peças novas esse mês. Me chama quando precisar.",
                c.name
              )
              const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
              await cli.query(
                `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
                 VALUES ($1, $2, 'out', $3, NOW())
                 ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
                [c.id, result?.key?.id ?? null, msg]
              )
            }
            await cli.query("COMMIT")
            await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D30')`, [c.id]).catch(() => {})
            results.ausente++
            sent = true
          } catch {
            await cli.query("ROLLBACK").catch(() => {})
            results.errors++
          } finally {
            cli.release()
          }
        }
      }
    } catch { results.errors++ }

    // ── 5. Ausente D45 (última mensagem) ─────────────────────────────────────
    try {
      if (!sent) {
        const rows = await pool.query(`
          SELECT id, jid, name, jid AS send_jid FROM wa_contacts
          WHERE lifecycle_state = 'ausente'
          AND linked_user_id IS NULL
            AND ausente_seq = 2
            AND last_order_at IS NOT NULL
            AND last_order_at < NOW() - INTERVAL '45 days'
            AND NOT COALESCE(marketing_optout, false)
            AND (last_marketing_sent_at IS NULL OR last_marketing_sent_at < NOW() - INTERVAL '20 hours')
          LIMIT 1
        `)
        for (const c of rows.rows) {
          const cli = await pool.connect()
          try {
            await cli.query("BEGIN")
            await cli.query(`UPDATE wa_contacts SET ausente_seq = 3, ausente_last_sent_at = NOW(), last_marketing_sent_at = NOW() WHERE id = $1`, [c.id])
            {
              const msg = t(
                s.ausente_d45_msg || "Oi {nome}! Uma última mensagem — quando precisar de estoque, pode contar comigo.",
                c.name
              )
              const result = await sendWhatsApp(c.send_jid as string, msg) as { key?: { id?: string } }
              await cli.query(
                `INSERT INTO wa_messages (contact_id, message_id, direction, content, created_at)
                 VALUES ($1, $2, 'out', $3, NOW())
                 ON CONFLICT (message_id) WHERE message_id IS NOT NULL DO NOTHING`,
                [c.id, result?.key?.id ?? null, msg]
              )
            }
            await cli.query("COMMIT")
            await pool.query(`INSERT INTO lifecycle_executions (contact_id, stage) VALUES ($1, 'D45')`, [c.id]).catch(() => {})
            results.ausente++
            sent = true
          } catch {
            await cli.query("ROLLBACK").catch(() => {})
            results.errors++
          } finally {
            cli.release()
          }
        }
      }
    } catch { results.errors++ }

    // ── 6. Ausente → Frio (30 dias após D45 sem resposta) ───────────────────
    try {
      const rows = await pool.query(`
        SELECT id FROM wa_contacts
        WHERE lifecycle_state = 'ausente'
        AND linked_user_id IS NULL
          AND ausente_seq = 3
          AND ausente_last_sent_at < NOW() - INTERVAL '30 days'
      `)
      for (const c of rows.rows) {
        try {
          await pool.query(`UPDATE wa_contacts SET lifecycle_state = 'frio', lifecycle_updated_at = NOW() WHERE id = $1`, [c.id])
          results.frio++
        } catch { results.errors++ }
      }
    } catch { results.errors++ }
  }

  return NextResponse.json({ ok: true, ...results })
}

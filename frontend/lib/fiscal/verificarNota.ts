import { pool } from "@/lib/db"
import { processarResultadoNota } from "@/lib/fiscal/processarResultado"

// Processamento da nota independente de tela aberta (PIV 15/10). Antes, nota
// "processando" só andava se alguém estivesse com o Relatório de Vendas aberto
// (polling no navegador) — o webhook da Focus NFe nunca chegou de forma
// confiável, e nota pedida pelo portal ficava parada pra sempre (PED-3231 e
// PED-3178 ficaram autorizadas na Sefaz sem PDF salvo e sem WhatsApp).
// Agora: acompanharNota roda em segundo plano logo depois da emissão, e o cron
// /api/fiscal/verificar-cron pega qualquer uma que tenha sobrado.

type NotaRef = { id: number; ambiente: string; ref: string; status: string }

export async function focusConfig(ambiente: string) {
  const { rows } = await pool.query(`SELECT key, value FROM app_settings WHERE key LIKE 'fiscal_%'`)
  const s: Record<string, string> = {}
  for (const r of rows) s[r.key] = r.value
  const token = ambiente === "producao" ? s.fiscal_token_producao : s.fiscal_token_homologacao
  return {
    baseUrl: ambiente === "producao" ? "https://api.focusnfe.com.br" : "https://homologacao.focusnfe.com.br",
    auth: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
  }
}

async function lerNota(noteId: number): Promise<NotaRef | null> {
  const { rows } = await pool.query(`SELECT id, ambiente, ref, status FROM fiscal_notes WHERE id = $1`, [noteId])
  return rows[0] ?? null
}

// Pergunta pra Focus NFe e, se já tiver resultado, salva (autorizada: PDF/XML +
// WhatsApp; rejeitada: motivo). Devolve o status atual da nota no nosso banco.
export async function verificarNota(noteId: number): Promise<string> {
  const note = await lerNota(noteId)
  if (!note) return "nao_encontrada"
  if (note.status !== "processando") return note.status

  const { baseUrl, auth } = await focusConfig(note.ambiente)
  const res = await fetch(`${baseUrl}/v2/nfe/${encodeURIComponent(note.ref)}`, { headers: { Authorization: auth } })
  const data = await res.json().catch(() => ({}))
  if (data.status === "processando_autorizacao" || !data.status) return "processando"

  const r = await processarResultadoNota(note, data)
  return r.status
}

// Logo depois de emitir: confere a cada 5s por até ~1 min.
export async function acompanharNota(noteId: number) {
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000))
    const status = await verificarNota(noteId)
    if (status !== "processando") return status
  }
  return "processando"
}

// Todas as notas ainda "processando" (cron).
export async function verificarPendentes() {
  const { rows } = await pool.query(`SELECT id FROM fiscal_notes WHERE status = 'processando' ORDER BY id LIMIT 50`)
  const resultado: Record<number, string> = {}
  for (const r of rows) {
    resultado[r.id] = await verificarNota(r.id).catch(e => `erro: ${e instanceof Error ? e.message : e}`)
  }
  return resultado
}

// Cancela a nota na Sefaz via Focus NFe (só dá dentro de 24h da autorização).
export async function cancelarNotaNaFocus(noteId: number, justificativa: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const note = await lerNota(noteId)
  if (!note) return { ok: false, error: "Nota não encontrada" }
  const { baseUrl, auth } = await focusConfig(note.ambiente)
  const res = await fetch(`${baseUrl}/v2/nfe/${encodeURIComponent(note.ref)}`, {
    method: "DELETE",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ justificativa }),
  })
  const data = await res.json().catch(() => ({}))
  if (data.status !== "cancelado") {
    return { ok: false, error: data.mensagem_sefaz || data.mensagem || `Focus NFe não cancelou (${data.status ?? res.status})` }
  }
  await pool.query(
    `UPDATE fiscal_notes SET status = 'cancelada', cancelada_em = NOW(), motivo_rejeicao = $2 WHERE id = $1`,
    [noteId, `Cancelada: ${justificativa}`]
  )
  return { ok: true }
}

export type NotaAoCancelar =
  | { ok: true; aviso?: string }
  | { ok: false; httpStatus: number; error: string; code?: "confirmar_nota" }

// Antes de cancelar um pedido (PIV 15/10): se ele tem nota autorizada, cancela a
// nota na Sefaz junto (dentro de 24h). Fora das 24h, ou se a nota cobre outros
// pedidos também, só segue com `confirmado` (o operador confirmou na tela).
// Nunca cancela o pedido deixando pra trás uma nota que ainda dava pra cancelar.
export async function tratarNotaAoCancelarPedido(orderId: number, orderNumber: string, confirmado: boolean): Promise<NotaAoCancelar> {
  const { rows } = await pool.query(`
    SELECT fn.id, fn.status, fn.numero, fn.autorizado_em AS "autorizadoEm",
      ARRAY(
        SELECT o2.number FROM fiscal_note_orders f2 JOIN orders o2 ON o2.id = f2.order_id
        WHERE f2.fiscal_note_id = fn.id AND f2.order_id <> $1 AND o2.status <> 'cancelado'
      ) AS outros
    FROM fiscal_note_orders fno JOIN fiscal_notes fn ON fn.id = fno.fiscal_note_id
    WHERE fno.order_id = $1 AND fn.status IN ('processando', 'autorizada')
  `, [orderId])

  const avisos: string[] = []
  for (const n of rows as { id: number; status: string; numero: string | null; autorizadoEm: Date | null; outros: string[] }[]) {
    if (n.status === "processando") {
      const s = await verificarNota(n.id)
      if (s === "processando") {
        return { ok: false, httpStatus: 409, error: "A nota fiscal desse pedido ainda está processando na Sefaz. Tente cancelar de novo em 1 minuto." }
      }
      const atual = (await pool.query(`SELECT status, numero, autorizado_em FROM fiscal_notes WHERE id = $1`, [n.id])).rows[0]
      if (atual?.status !== "autorizada") continue
      n.numero = atual.numero
      n.autorizadoEm = atual.autorizado_em
    }

    const nome = n.numero ? `nº ${n.numero}` : `#${n.id}`
    const dentro24h = !!n.autorizadoEm && Date.now() - new Date(n.autorizadoEm).getTime() < 23.5 * 60 * 60 * 1000

    if (!dentro24h) {
      if (!confirmado) {
        return {
          ok: false, httpStatus: 409, code: "confirmar_nota",
          error: `A nota fiscal ${nome} desse pedido foi autorizada há mais de 24h e a Sefaz não deixa mais cancelar. Pra desfazer a venda no fiscal precisa emitir nota de devolução. Cancelar só o pedido mesmo assim (a nota continua valendo)?`,
        }
      }
      avisos.push(`Nota ${nome} continua valendo (fora das 24h): precisa de nota de devolução.`)
      continue
    }

    if (n.outros.length > 0 && !confirmado) {
      return {
        ok: false, httpStatus: 409, code: "confirmar_nota",
        error: `A nota fiscal ${nome} cobre também ${n.outros.join(", ")}. Cancelar este pedido cancela a nota inteira, e esses pedidos ficam sem nota (dá pra emitir de novo pra eles). Cancelar mesmo assim?`,
      }
    }

    const r = await cancelarNotaNaFocus(n.id, `Pedido ${orderNumber} cancelado pela loja, venda desfeita`)
    if (!r.ok) {
      return { ok: false, httpStatus: 502, error: `Não consegui cancelar a nota fiscal ${nome} na Sefaz: ${r.error}. O pedido NÃO foi cancelado.` }
    }
    avisos.push(`Nota ${nome} cancelada na Sefaz.`)
  }
  return { ok: true, aviso: avisos.join(" ") || undefined }
}

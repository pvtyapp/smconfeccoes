// Cortes terceirizados (PIV 14/11/2026): o cortador lança pelo celular em /corte (sem login,
// só o domínio), o grupo SM Administrativo recebe o aviso e quem aprova coloca preço do kg,
// largura e gramatura — pelo painel (/dashboard/cortes) ou respondendo a mensagem do aviso
// no grupo ("38,90 1,80 160"). O painel calcula o custo do tecido por peça.
import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"
import { ADMINISTRATIVO_GROUP_JID } from "@/lib/whatsapp/administrativoGroup"
import { calcularCorte, codigoCorte, kgDaCor, pecasDaCor, r2, type CorCorte, type MalhaCorte } from "@/lib/cortesCalc"

const SITE = "https://smconfeccoes.com.br"

export type Corte = {
  id: number
  codigo: string
  cortador: string
  productId: string | null
  productName: string
  sizes: string[]
  cores: CorCorte[]
  status: "esperando" | "aprovado" | "cancelado"
  malha: MalhaCorte
  custoPeca: number | null
  custoTotal: number | null
  aprovadoPor: string | null
  aprovadoEm: string | null
  createdAt: string
}

let pronto = false
export async function ensureCortes() {
  if (pronto) return
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cortes (
      id            SERIAL PRIMARY KEY,
      cortador      TEXT NOT NULL,
      product_id    TEXT,
      product_name  TEXT NOT NULL,
      sizes         TEXT[] NOT NULL DEFAULT '{}',
      cores         JSONB NOT NULL,
      status        TEXT NOT NULL DEFAULT 'esperando',
      preco_kg      NUMERIC(10,2),
      largura       NUMERIC(6,3),
      gramatura     NUMERIC(7,1),
      por_cor       BOOLEAN NOT NULL DEFAULT false,
      preco_cor     JSONB NOT NULL DEFAULT '{}',
      mao_corte     NUMERIC(10,2),
      custo_peca    NUMERIC(10,4),
      custo_total   NUMERIC(12,2),
      wa_message_id TEXT,
      aprovado_por  TEXT,
      aprovado_em   TIMESTAMPTZ,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)
  await pool.query(`CREATE INDEX IF NOT EXISTS cortes_wa_msg_idx ON cortes (wa_message_id)`)
  pronto = true
}

type Row = Record<string, unknown>
const num = (v: unknown) => (v == null ? null : Number(v))
function deRow(r: Row): Corte {
  return {
    id: Number(r.id),
    codigo: codigoCorte(Number(r.id)),
    cortador: String(r.cortador),
    productId: (r.product_id as string) ?? null,
    productName: String(r.product_name),
    sizes: (r.sizes as string[]) ?? [],
    cores: (r.cores as CorCorte[]) ?? [],
    status: r.status as Corte["status"],
    malha: {
      precoKg: num(r.preco_kg), largura: num(r.largura), gramatura: num(r.gramatura),
      porCor: Boolean(r.por_cor), precoCor: (r.preco_cor as Record<string, number | null>) ?? {}, maoCorte: num(r.mao_corte),
    },
    custoPeca: num(r.custo_peca),
    custoTotal: num(r.custo_total),
    aprovadoPor: (r.aprovado_por as string) ?? null,
    aprovadoEm: r.aprovado_em ? new Date(r.aprovado_em as string).toISOString() : null,
    createdAt: new Date(r.created_at as string).toISOString(),
  }
}

export async function listarCortes(limite = 100): Promise<Corte[]> {
  await ensureCortes()
  const { rows } = await pool.query(`SELECT * FROM cortes WHERE status <> 'cancelado' ORDER BY id DESC LIMIT $1`, [limite])
  return rows.map(deRow)
}

export async function buscarCorte(id: number): Promise<Corte | null> {
  await ensureCortes()
  const { rows } = await pool.query(`SELECT * FROM cortes WHERE id = $1`, [id])
  return rows[0] ? deRow(rows[0]) : null
}

// ── mensagens ───────────────────────────────────────────────
const brl = (v: number) => v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
const dec = (v: number, d = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: d, maximumFractionDigits: d })
const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).replace(",", " ·")

export function mensagemCorteNovo(c: Corte): string {
  const pecas = c.cores.reduce((s, x) => s + pecasDaCor(x), 0)
  const kg = c.cores.reduce((s, x) => s + kgDaCor(x), 0)
  const linhas = c.cores.map(x =>
    `${x.cor}: ${c.sizes.filter(t => (x.grade[t] ?? 0) > 0).map(t => `${t} ${x.grade[t]}`).join(" · ")} = *${pecasDaCor(x)}* · ${dec(kgDaCor(x))} kg (${x.bobinas.length} bob.)`
  ).join("\n")
  return `✂️ *Corte novo ${c.codigo}*\n${c.cortador} · ${quando(c.createdAt)}\n\n` +
    `*${c.productName}*: ${pecas} peças · ${dec(kg)} kg de malha\n${linhas}\n\n` +
    `💰 Falta o preço da malha. Abre pra aprovar:\n${SITE}/dashboard/cortes?c=${c.id}\n\n` +
    `Ou responde *esta mensagem* assim:\n*38,90 1,80 160*\n(preço do kg · largura em metros · gramatura)`
}

export function mensagemCorteAprovado(c: Corte): string {
  const ct = calcularCorte(c.cores, c.malha)
  const m = c.malha
  const porCor = ct.linhas.length > 1 ? "\n" + ct.linhas.map(l => `${l.cor}: ${l.porPeca != null ? brl(l.porPeca) : "–"}`).join("\n") : ""
  return `✅ *${c.codigo} aprovado*${c.aprovadoPor ? ` por ${c.aprovadoPor}` : ""}\n` +
    `${c.productName}: ${ct.porPeca != null ? brl(ct.porPeca) : "–"} por peça (tecido${m.maoCorte ? " + corte" : ""})${porCor}\n` +
    `${ct.pecas} peças · ${dec(ct.kg)} kg · malha ${ct.tecido != null ? brl(ct.tecido) : "–"}\n` +
    `Malha: ${m.porCor ? "preço por cor" : brl(m.precoKg ?? 0) + "/kg"} · ${dec(m.largura ?? 0, 2)} m · ${dec(m.gramatura ?? 0, 0)} g/m²` +
    (ct.metros != null ? ` · ${dec(ct.metros)} m de malha` : "")
}

async function mandarNoGrupo(texto: string): Promise<string | null> {
  const instance = await getAdminInstanceName()
  if (!instance) { console.error("[cortes] instância admin não configurada; aviso não enviado"); return null }
  try {
    const raw = await sendWhatsApp(ADMINISTRATIVO_GROUP_JID, texto, undefined, instance) as { key?: { id?: string } } | undefined
    return raw?.key?.id ?? null
  } catch (e) {
    console.error("[cortes] envio no grupo falhou:", e instanceof Error ? e.message : e)
    return null
  }
}

// ── criar (tela do cortador) ────────────────────────────────
export async function criarCorte(entrada: { cortador: string; productId: string; cores: CorCorte[] }, opts: { silencioso?: boolean } = {}): Promise<Corte> {
  await ensureCortes()
  const { rows: pr } = await pool.query(
    `SELECT id, name, COALESCE(size_list,'{}') AS sizes, COALESCE(color_list,'{}') AS colors FROM products WHERE id::text = $1`,
    [entrada.productId]
  )
  const p = pr[0]
  if (!p) throw new Error("Produto não encontrado")
  const sizes: string[] = p.sizes ?? []
  const colors: string[] = p.colors ?? []
  const cortador = entrada.cortador.trim().slice(0, 60)
  if (!cortador) throw new Error("Falta o seu nome")
  if (!entrada.cores?.length || entrada.cores.length > 30) throw new Error("Escolha as cores")

  const cores: CorCorte[] = entrada.cores.map(c => {
    if (!colors.includes(c.cor)) throw new Error(`Cor fora do cadastro: ${c.cor}`)
    const grade: Record<string, number> = {}
    for (const t of sizes) {
      const q = Math.round(Number(c.grade?.[t]) || 0)
      if (q < 0 || q > 100000) throw new Error("Quantidade inválida na grade")
      if (q > 0) grade[t] = q
    }
    const bobinas = (c.bobinas ?? []).map(Number).filter(v => Number.isFinite(v) && v > 0)
    if (!bobinas.length || bobinas.length > 60 || bobinas.some(v => v > 300)) throw new Error(`Peso das bobinas inválido em ${c.cor}`)
    const sobra = Math.max(0, Number(c.sobra) || 0)
    const cor = { cor: c.cor, grade, bobinas: bobinas.map(v => Math.round(v * 100) / 100), sobra: Math.round(sobra * 100) / 100 }
    if (pecasDaCor(cor) <= 0) throw new Error(`Falta a grade de ${c.cor}`)
    if (kgDaCor(cor) <= 0) throw new Error(`A sobra de ${c.cor} ficou maior que as bobinas`)
    return cor
  })

  const { rows } = await pool.query(
    `INSERT INTO cortes (cortador, product_id, product_name, sizes, cores) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [cortador, String(p.id), p.name, sizes, JSON.stringify(cores)]
  )
  const corte = deRow(rows[0])
  if (opts.silencioso) return corte   // teste feito por quem está logado no painel: não avisa o grupo
  const msgId = await mandarNoGrupo(mensagemCorteNovo(corte))
  if (msgId) await pool.query(`UPDATE cortes SET wa_message_id = $1 WHERE id = $2`, [msgId, corte.id])
  return corte
}

// ── aprovar (painel ou resposta no grupo) ───────────────────
export async function aprovarCorte(id: number, malha: MalhaCorte, quem: string | null, opts: { silencioso?: boolean } = {}): Promise<Corte> {
  await ensureCortes()
  const c = await buscarCorte(id)
  if (!c) throw new Error("Corte não encontrado")
  if (c.status !== "esperando") throw new Error(c.status === "aprovado" ? `${c.codigo} já foi aprovado` : `${c.codigo} foi cancelado`)
  const ct = calcularCorte(c.cores, malha)
  if (ct.porPeca == null) throw new Error("Falta o preço do kg")
  if (!malha.largura || !malha.gramatura) throw new Error("Falta a largura ou a gramatura")
  const { rows } = await pool.query(
    `UPDATE cortes SET status='aprovado', preco_kg=$2, largura=$3, gramatura=$4, por_cor=$5, preco_cor=$6, mao_corte=$7,
            custo_peca=$8, custo_total=$9, aprovado_por=$10, aprovado_em=NOW()
      WHERE id=$1 AND status='esperando' RETURNING *`,
    [id, malha.precoKg, malha.largura, malha.gramatura, malha.porCor, JSON.stringify(malha.precoCor ?? {}), malha.maoCorte,
     ct.porPeca, ct.total != null ? r2(ct.total) : null, quem]
  )
  if (!rows[0]) throw new Error(`${c.codigo} já foi aprovado`)
  const aprovado = deRow(rows[0])
  if (!opts.silencioso) await mandarNoGrupo(mensagemCorteAprovado(aprovado))
  return aprovado
}

export async function cancelarCorte(id: number): Promise<void> {
  await ensureCortes()
  await pool.query(`UPDATE cortes SET status='cancelado' WHERE id=$1 AND status='esperando'`, [id])
}

// Resposta no grupo SM Administrativo citando o aviso do corte: "38,90 1,80 160".
// Devolve true se a mensagem era sobre um corte (respondida aqui), false se não tem nada a ver.
export async function respostaCorteNoGrupo(quotedId: string | null, texto: string, quem: string | null): Promise<boolean> {
  if (!quotedId) return false
  await ensureCortes()
  const { rows } = await pool.query(`SELECT id FROM cortes WHERE wa_message_id = $1`, [quotedId])
  if (!rows[0]) return false
  const id = Number(rows[0].id)
  const nums = (texto.match(/\d+(?:[.,]\d+)?/g) ?? []).map(s => Number(s.replace(",", ".")))
  const [precoKg, largura, gramatura] = nums
  const ok = nums.length >= 3 && precoKg > 0 && precoKg < 1000 && largura > 0.2 && largura < 5 && gramatura >= 30 && gramatura <= 800
  if (!ok) {
    await mandarNoGrupo(`Não entendi o preço do ${codigoCorte(id)}. Responde o aviso assim: *38,90 1,80 160* (preço do kg · largura em metros · gramatura)`)
    return true
  }
  try {
    await aprovarCorte(id, { precoKg, largura, gramatura, porCor: false, precoCor: {}, maoCorte: null }, quem)
  } catch (e) {
    // Só mensagem operacional vai pro grupo (já aprovado, cancelado, falta dado); erro técnico fica no log.
    const msg = e instanceof Error ? e.message : ""
    if (/^C-\d+ |^Falta /.test(msg)) await mandarNoGrupo(msg)
    else { console.error("[cortes] aprovar pela resposta falhou:", msg); await mandarNoGrupo(`Não consegui aprovar o ${codigoCorte(id)} pela resposta. Aprova pelo painel: ${SITE}/dashboard/cortes?c=${id}`) }
  }
  return true
}

import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { createProdOrder } from "@/lib/prodOrders/createOrder"
import { updateProdOrderGrade } from "@/lib/prodOrders/updateGrade"
import { createRawMaterialEntry } from "@/lib/rawMaterials/createEntry"
import { createRawMaterialVariant } from "@/lib/rawMaterials/createVariant"
import { todayBR } from "@/lib/tz"

// ─── Bot administrativo — operadores cadastrados em Usuários conversando com o
// mesmo número do WhatsApp da loja, mas num universo totalmente separado do
// chatbot de atendimento ao cliente. Não usa wa_contacts, não salva em
// wa_messages, não passa pelos toggles de chatbot_ativo/silenciado — é uma
// ferramenta interna que só por acaso roda no mesmo número.
//
// Detecção: telefone de quem manda bate com users.phone (ativo)? Se sim, toda
// mensagem dele vira comando administrativo, nunca cai no fluxo de cliente.
// ────────────────────────────────────────────────────────────────────────────

type AdminUser = {
  id: number
  name: string
  isAdmin: boolean
  allowedPages: string[]
  waState: string | null
  waStateData: Record<string, unknown>
}

const VARIABLE_COST_CATEGORIES = ["Linhas", "Lanche", "Frete", "Gasolina", "Embalagem", "Material", "Manutenção", "Outros"]

async function reply(jid: string, text: string): Promise<void> {
  try {
    await sendWhatsApp(jid, text)
  } catch (e) {
    console.error("[adminBot] reply falhou:", jid, e instanceof Error ? e.message : e)
  }
}

async function setState(userId: number, state: string | null, data: Record<string, unknown> = {}): Promise<void> {
  await pool.query(
    `UPDATE users SET wa_state = $1, wa_state_data = $2::jsonb WHERE id = $3`,
    [state, JSON.stringify(data), userId]
  )
}

function hasPermission(user: AdminUser, href: string): boolean {
  return user.isAdmin || user.allowedPages.includes(href)
}

// Resolve se o telefone de quem mandou a mensagem é um operador cadastrado e ativo.
// Número @lid nem sempre traz o remoteJidAlt na mensagem (só a 1ª costuma trazer) —
// nesse caso cai pra buscar o phone_jid já resolvido antes em wa_contacts (mesmo
// contato pode ter mandado mensagem como "cliente" antes de virar operador).
export async function resolveAdminUser(jid: string, remoteJidAlt: string): Promise<AdminUser | null> {
  let phoneJid = jid
  if (jid.endsWith("@lid")) {
    if (remoteJidAlt.endsWith("@s.whatsapp.net")) {
      phoneJid = remoteJidAlt
    } else {
      const { rows: known } = await pool.query(
        `SELECT phone_jid FROM wa_contacts WHERE jid = $1 AND phone_jid IS NOT NULL LIMIT 1`,
        [jid]
      ).catch(() => ({ rows: [] as { phone_jid: string }[] }))
      if (known[0]?.phone_jid) phoneJid = known[0].phone_jid
    }
  }
  const phone = phoneJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  if (phone.length < 8) return null
  // users.phone é cadastrado no formato nacional (DDD + número, sem 55) — o
  // telefone que vem do JID do WhatsApp sempre tem o 55 na frente. Compara
  // com e sem o prefixo pra cobrir os dois formatos.
  const phoneNoCC = phone.startsWith("55") && phone.length >= 12 ? phone.slice(2) : phone

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_state TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_state_data JSONB NOT NULL DEFAULT '{}'`).catch(() => {})

  const { rows } = await pool.query(
    `SELECT id, name, is_admin AS "isAdmin", allowed_pages AS "allowedPages",
            wa_state AS "waState", wa_state_data AS "waStateData"
     FROM users WHERE active = true AND phone IN ($1, $2) LIMIT 1`,
    [phone, phoneNoCC]
  ).catch(() => ({ rows: [] as AdminUser[] }))

  return rows[0] ?? null
}

// Reseta pra neutro se ficou mais de 6h sem responder (mesma regra do chatbot de cliente)
async function resetIfStale(user: AdminUser): Promise<AdminUser> {
  const updatedAt = user.waStateData?.updatedAt as string | undefined
  if (user.waState && user.waState !== "idle" && updatedAt) {
    const staleHours = (Date.now() - new Date(updatedAt).getTime()) / 3_600_000
    if (staleHours > 6) {
      await setState(user.id, null, {})
      return { ...user, waState: null, waStateData: {} }
    }
  }
  return user
}

function withTimestamp(data: Record<string, unknown>): Record<string, unknown> {
  return { ...data, updatedAt: new Date().toISOString() }
}

function numberedList(items: string[]): string {
  return items.map((it, i) => `${i + 1}. ${it}`).join("\n")
}

function parseNumberList(text: string, max: number): number[] | null {
  const parts = text.split(",").map(s => s.trim()).filter(Boolean)
  const nums = parts.map(p => parseInt(p, 10))
  if (nums.some(n => isNaN(n) || n < 1 || n > max)) return null
  return [...new Set(nums)]
}

function fmtMoney(n: number): string {
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

const MENU_FOOTER = `\n\n_Digite *menu* pra ver as opções de novo._`

// ─── Definição do menu — cada item sabe checar permissão e iniciar seu fluxo ────
type MenuItem = {
  key: string
  label: string
  triggers: string[]
  permission: string
  start: (jid: string, user: AdminUser) => Promise<void>
}

async function startCriarOrdem(jid: string, user: AdminUser): Promise<void> {
  const { rows: products } = await pool.query(`
    SELECT id, name, size_list AS "sizeList", color_list AS "colorList"
    FROM products
    WHERE status = 'active' AND array_length(color_list, 1) > 0 AND array_length(size_list, 1) > 0
    ORDER BY name
  `)
  if (products.length === 0) {
    await reply(jid, "Nenhum produto com cores e tamanhos cadastrados encontrado." + MENU_FOOTER)
    return
  }
  await setState(user.id, "op_produto", withTimestamp({
    productsList: products.map(p => ({ id: p.id, name: p.name, sizeList: p.sizeList, colorList: p.colorList })),
  }))
  await reply(jid, `📦 *Criar Ordem de Produção*\n\nQual produto?\n\n${numberedList(products.map(p => p.name))}\n\n_Responda só o número. "cancelar" ou "menu" pra sair._`)
}

async function startCriarInsumo(jid: string, user: AdminUser): Promise<void> {
  const { rows: materials } = await pool.query(`
    SELECT id, name, unit FROM raw_materials WHERE status = 'active' ORDER BY name
  `)
  if (materials.length === 0) {
    await reply(jid, "Nenhum material cadastrado. Cadastre uma categoria pelo painel antes." + MENU_FOOTER)
    return
  }
  await setState(user.id, "insumo_material", withTimestamp({
    materialsList: materials.map(m => ({ id: m.id, name: m.name, unit: m.unit })),
  }))
  await reply(jid, `📦 *Nova Entrada de Matéria-Prima*\n\nQual material?\n\n${numberedList(materials.map(m => `${m.name} (${m.unit})`))}\n\n_Responda só o número. "cancelar" ou "menu" pra sair._`)
}

async function startEstoque(jid: string, user: AdminUser): Promise<void> {
  void user
  const { rows } = await pool.query(`
    SELECT p.name AS "productName", pv.color, pv.size,
           COALESCE(bal.qty, 0)::int AS "currentStock", pv.min_stock AS "minStock"
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN (
      SELECT variant_id, SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS qty
      FROM stock_movements GROUP BY variant_id
    ) bal ON bal.variant_id = pv.id
    WHERE pv.status = 'active' AND p.status = 'active'
      AND COALESCE(bal.qty, 0) <= COALESCE(pv.min_stock, 0)
    ORDER BY COALESCE(bal.qty, 0) ASC
    LIMIT 15
  `)
  if (rows.length === 0) {
    await reply(jid, "📦 *Estoque*\n\nNenhum item com estoque baixo ou zerado agora." + MENU_FOOTER)
    return
  }
  const linhas = rows.map(r =>
    `${Number(r.currentStock) <= 0 ? "🔴" : "🟡"} ${r.productName} ${r.color}/${r.size}: *${r.currentStock}* (mín ${r.minStock ?? 0})`
  )
  await reply(jid, `📦 *Estoque baixo/zerado* (${rows.length})\n\n${linhas.join("\n")}` + MENU_FOOTER)
}

async function startDespesa(jid: string, user: AdminUser): Promise<void> {
  await setState(user.id, "despesa_categoria", withTimestamp({}))
  await reply(jid, `💸 *Lançar Despesa Variável*\n\nQual categoria?\n\n${numberedList(VARIABLE_COST_CATEGORIES)}\n\n_Responda só o número. "cancelar" ou "menu" pra sair._`)
}

async function startClientesReceber(jid: string, user: AdminUser): Promise<void> {
  void user
  const { rows } = await pool.query(`
    SELECT o.number, o.total_value::float AS "totalValue", o.due_date::text AS "dueDate", c.name AS "contactName"
    FROM orders o JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.paid_at IS NULL AND o.status != 'cancelado' AND o.due_date IS NOT NULL
    UNION ALL
    SELECT p.number, p.preco_cobrado::float AS "totalValue", p.due_date::text AS "dueDate", COALESCE(c.name, p.cliente) AS "contactName"
    FROM dtf_pedidos p LEFT JOIN wa_contacts c ON c.id = p.contact_id
    WHERE p.paid_at IS NULL AND p.status != 'cancelado' AND p.due_date IS NOT NULL
    ORDER BY "dueDate" ASC NULLS LAST
  `)
  if (rows.length === 0) {
    await reply(jid, "💰 *Clientes a Receber*\n\nNada pendente agora." + MENU_FOOTER)
    return
  }
  const hoje = todayBR()
  const total = rows.reduce((s, r) => s + Number(r.totalValue), 0)
  const atrasados = rows.filter(r => r.dueDate && r.dueDate < hoje)
  let msg = `💰 *Clientes a Receber*\n\nTotal pendente: *${fmtMoney(total)}* (${rows.length} cobranças)`
  if (atrasados.length > 0) {
    msg += `\n\n🔴 Atrasados (${atrasados.length}):\n` + atrasados.slice(0, 15).map(r =>
      `${r.contactName ?? "?"} — ${fmtMoney(Number(r.totalValue))} (venceu ${r.dueDate})`
    ).join("\n")
  }
  await reply(jid, msg + MENU_FOOTER)
}

function periodoRange(kind: "hoje" | "mes"): Date {
  const now = new Date()
  if (kind === "hoje") return new Date(now.getFullYear(), now.getMonth(), now.getDate())
  return new Date(now.getFullYear(), now.getMonth(), 1)
}

async function startVendas(jid: string, user: AdminUser): Promise<void> {
  void user
  const desde = periodoRange("mes")
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(total_value), 0)::float AS receita
    FROM orders WHERE status != 'cancelado' AND source IN ('pdv','whatsapp','manual')
      AND number NOT LIKE 'COB-%' AND created_at >= $1
  `, [desde])
  const { rows: dtfRows } = await pool.query(`
    SELECT COUNT(*)::int AS pedidos, COALESCE(SUM(preco_cobrado), 0)::float AS receita
    FROM dtf_pedidos WHERE status != 'cancelado' AND created_at >= $1
  `, [desde])
  const totalPedidos = rows[0].pedidos + dtfRows[0].pedidos
  const totalReceita = rows[0].receita + dtfRows[0].receita
  await reply(
    jid,
    `📊 *Relatório de Vendas — mês atual*\n\nPedidos: *${totalPedidos}*\nReceita: *${fmtMoney(totalReceita)}*\n(Produto: ${fmtMoney(rows[0].receita)} · DTF: ${fmtMoney(dtfRows[0].receita)})` + MENU_FOOTER
  )
}

async function startFinanceiro(jid: string, user: AdminUser): Promise<void> {
  void user
  const desde = periodoRange("mes")
  const { rows } = await pool.query(`
    SELECT COALESCE(SUM(total_value), 0)::float AS receita
    FROM orders WHERE status != 'cancelado' AND source IN ('pdv','whatsapp','manual')
      AND number NOT LIKE 'COB-%' AND created_at >= $1
  `, [desde])
  const { rows: dtfRows } = await pool.query(`
    SELECT COALESCE(SUM(preco_cobrado), 0)::float AS receita
    FROM dtf_pedidos WHERE status != 'cancelado' AND created_at >= $1
  `, [desde])
  const { rows: custoRows } = await pool.query(`
    SELECT COALESCE(SUM(oi.qty * COALESCE(p.material_cost, 0)), 0)::float AS custo
    FROM order_items oi
    JOIN orders o ON o.id = oi.order_id
    LEFT JOIN products p ON LOWER(p.name) = LOWER(oi.product_name) AND p.status = 'active'
    WHERE o.status != 'cancelado' AND o.source IN ('pdv','whatsapp','manual')
      AND o.number NOT LIKE 'COB-%' AND o.created_at >= $1
  `, [desde])
  const { rows: despesaRows } = await pool.query(`
    SELECT COALESCE(SUM(amount), 0)::float AS despesas
    FROM variable_costs WHERE cost_date >= $1
  `, [desde])

  const receita   = rows[0].receita + dtfRows[0].receita
  const custo     = custoRows[0].custo
  const despesas  = despesaRows[0].despesas
  const resultado = receita - custo - despesas

  await reply(
    jid,
    `📈 *Relatório Financeiro — mês atual* (resumo simplificado)\n\n` +
    `Receita: *${fmtMoney(receita)}*\n` +
    `Custo de produto: -${fmtMoney(custo)}\n` +
    `Despesas variáveis: -${fmtMoney(despesas)}\n` +
    `Resultado: *${fmtMoney(resultado)}*\n\n` +
    `_Resumo simplificado — relatório completo com todos os canais e detalhes fica no painel._` + MENU_FOOTER
  )
}

const MENU_ITEMS: MenuItem[] = [
  { key: "criar_ordem",  label: "Criar ordem de produção",       triggers: ["criar ordem"],   permission: "/dashboard/programacao",     start: startCriarOrdem },
  { key: "criar_insumo", label: "Criar insumo (matéria-prima)",  triggers: ["criar insumo"],  permission: "/dashboard/materias-primas", start: startCriarInsumo },
  { key: "vendas",       label: "Relatório de vendas",           triggers: ["relatorio de vendas", "relatório de vendas", "vendas"], permission: "/dashboard/relatorio-vendas", start: startVendas },
  { key: "financeiro",   label: "Relatório financeiro",          triggers: ["relatorio financeiro", "relatório financeiro", "financeiro"], permission: "/dashboard/relatorio-financeiro", start: startFinanceiro },
  { key: "estoque",      label: "Relatório de estoque",          triggers: ["relatorio de estoque", "relatório de estoque", "estoque"], permission: "/dashboard/estoque", start: startEstoque },
  { key: "despesa",      label: "Lançar despesa variável",       triggers: ["lancar despesa", "lançar despesa", "despesa"], permission: "/dashboard/custo-variavel", start: startDespesa },
  { key: "receber",      label: "Clientes a receber",            triggers: ["clientes a receber", "receber"], permission: "/dashboard/clientes-a-receber", start: startClientesReceber },
]

async function showMenu(jid: string, user: AdminUser): Promise<void> {
  const items = MENU_ITEMS.filter(m => hasPermission(user, m.permission))
  if (items.length === 0) {
    await setState(user.id, null, {})
    await reply(jid, `Oi, ${user.name}! Você não tem nenhum comando administrativo liberado ainda.`)
    return
  }
  await setState(user.id, "idle", { menuMap: items.map(i => i.key) })
  await reply(
    jid,
    `Oi, ${user.name}! 👋 Assistente administrativo da SM Confecções.\n\n${numberedList(items.map(i => i.label))}\n\n_Responda o número ou o nome do comando._`
  )
}

// Retorna true se a mensagem foi tratada como comando administrativo (não deve
// cair no chatbot de cliente), false se não bateu com nenhum comando reconhecido
// e o operador estava em modo neutro (aí a mensagem segue pro fluxo de cliente
// normal — número cadastrado também pode simplesmente estar falando como cliente).
export async function handleAdminMessage(jid: string, text: string, userIn: AdminUser): Promise<boolean> {
  const user = await resetIfStale(userIn)
  const lower = text.toLowerCase().trim()

  if (lower === "menu") {
    await showMenu(jid, user)
    return true
  }

  if (lower === "cancelar" || lower === "sair") {
    if (user.waState && user.waState !== "idle") {
      await setState(user.id, null, {})
      await reply(jid, "Ok, cancelado. Se já tinha criado algo (ordem ou lote), continua no painel — pode completar por lá." + MENU_FOOTER)
    } else {
      await reply(jid, "Nada em andamento." + MENU_FOOTER)
    }
    return true
  }

  const state = user.waState ?? "idle"

  if (state === "idle") {
    // Número respondendo o último menu mostrado
    const menuMap = (user.waStateData?.menuMap as string[]) ?? []
    const n = parseInt(lower, 10)
    if (!isNaN(n) && n >= 1 && n <= menuMap.length) {
      const item = MENU_ITEMS.find(m => m.key === menuMap[n - 1])
      if (item) { await item.start(jid, user); return true }
    }
    // Comando por texto direto (atalho, não precisa ver o menu primeiro)
    const item = MENU_ITEMS.find(m => m.triggers.some(t => lower.includes(t)))
    if (item) {
      if (!hasPermission(user, item.permission)) {
        await reply(jid, `Você não tem permissão pra usar "${item.label}".` + MENU_FOOTER)
        return true
      }
      await item.start(jid, user)
      return true
    }
    await showMenu(jid, user)
    return true
  }

  const data = user.waStateData ?? {}

  // ── Escolhendo produto ──────────────────────────────────────────────────
  if (state === "op_produto") {
    const productsList = (data.productsList as { id: string; name: string; sizeList: string[]; colorList: string[] }[]) ?? []
    const n = parseInt(lower, 10)
    if (isNaN(n) || n < 1 || n > productsList.length) {
      await reply(jid, `Não entendi. Responda o número do produto (1 a ${productsList.length}).`)
      return true
    }
    const product = productsList[n - 1]
    await setState(user.id, "op_cores", withTimestamp({
      productId: product.id, productName: product.name, sizes: product.sizeList, colorsAll: product.colorList,
    }))
    await reply(jid, `Cores de *${product.name}* — quais entram nessa ordem?\n\n${numberedList(product.colorList)}\n\n_Pode escolher mais de uma, separado por vírgula (ex: 1,3). "cancelar" pra sair._`)
    return true
  }

  // ── Escolhendo cores ─────────────────────────────────────────────────────
  if (state === "op_cores") {
    const colorsAll = (data.colorsAll as string[]) ?? []
    const nums = parseNumberList(lower, colorsAll.length)
    if (!nums) {
      await reply(jid, `Não entendi. Responda os números das cores separados por vírgula (1 a ${colorsAll.length}).`)
      return true
    }
    const colorsChosen = nums.map(n => colorsAll[n - 1])
    const { rows: materials } = await pool.query(`
      SELECT rme.id, rme.number, rm.name AS "materialName", rmv.name AS "varianteName",
             rme.total_qty AS "totalQty", rm.unit
      FROM raw_material_entries rme
      JOIN raw_materials rm ON rm.id = rme.material_id
      LEFT JOIN raw_material_variants rmv ON rmv.id = rme.variant_id
      WHERE rme.status IN ('disponivel', 'usada')
      ORDER BY rme.created_at DESC
    `)
    if (materials.length === 0) {
      await setState(user.id, null, {})
      await reply(jid, "Não há nenhum lote de matéria-prima disponível no estoque agora. Cadastre um lote antes de criar a ordem." + MENU_FOOTER)
      return true
    }
    await setState(user.id, "op_material", withTimestamp({
      ...data, colorsChosen, colorIndex: 0,
      materialsList: materials.map(m => ({
        id: m.id,
        label: `${m.materialName}${m.varianteName ? " - " + m.varianteName : ""} (lote ${m.number}, ${Number(m.totalQty).toFixed(1)} ${m.unit})`,
      })),
    }))
    await reply(jid, `Cores escolhidas: ${colorsChosen.join(", ")}.\n\nQual lote de matéria-prima abastece *${colorsChosen[0]}*?\n\n${numberedList(materials.map(m => `${m.materialName}${m.varianteName ? " - " + m.varianteName : ""} (lote ${m.number}, ${Number(m.totalQty).toFixed(1)} ${m.unit})`))}\n\n_Pode escolher mais de um, separado por vírgula. "cancelar" pra sair._`)
    return true
  }

  // ── Escolhendo material — um turno por cor ──────────────────────────────
  if (state === "op_material") {
    const colorsChosen = (data.colorsChosen as string[]) ?? []
    const colorIndex   = (data.colorIndex as number) ?? 0
    const materialsList = (data.materialsList as { id: number; label: string }[]) ?? []
    const nums = parseNumberList(lower, materialsList.length)
    if (!nums) {
      await reply(jid, `Não entendi. Responda os números dos lotes separados por vírgula (1 a ${materialsList.length}).`)
      return true
    }
    const materialsByColor = (data.materialsByColor as Record<string, number[]>) ?? {}
    materialsByColor[colorsChosen[colorIndex]] = nums.map(n => materialsList[n - 1].id)

    const nextIndex = colorIndex + 1
    if (nextIndex < colorsChosen.length) {
      await setState(user.id, "op_material", withTimestamp({ ...data, materialsByColor, colorIndex: nextIndex }))
      await reply(jid, `Anotado. Qual lote abastece *${colorsChosen[nextIndex]}*?\n\n${numberedList(materialsList.map(m => m.label))}`)
      return true
    }

    // Todas as cores têm material — cria a ordem de verdade agora
    try {
      const entries = Object.entries(materialsByColor).flatMap(([color, ids]) =>
        (ids as number[]).map(entryId => ({ entryId, color }))
      )
      const created = await createProdOrder({
        productId: data.productId as string, selectedColors: colorsChosen, entries,
      })

      await setState(user.id, "op_quantidade", withTimestamp({
        ...data, materialsByColor, colorIndex: 0, orderId: created.id, orderNumber: created.number,
      }))
      const sizes = (data.sizes as string[]) ?? []
      await reply(
        jid,
        `✅ Ordem *${created.number}* criada!\n\nAgora a quantidade por tamanho. Pra *${colorsChosen[0]}*, manda no formato:\n${sizes.map(s => `${s}:0`).join(" ")}\n\n_Exemplo: ${sizes.map(s => `${s}:10`).join(" ")}_`
      )
    } catch (e) {
      console.error("[adminBot] criar ordem falhou:", e instanceof Error ? e.message : e)
      await setState(user.id, null, {})
      await reply(jid, "Deu erro ao criar a ordem. Tenta de novo em alguns instantes ou crie pelo painel." + MENU_FOOTER)
    }
    return true
  }

  // ── Preenchendo quantidade — um turno por cor ───────────────────────────
  if (state === "op_quantidade") {
    const colorsChosen = (data.colorsChosen as string[]) ?? []
    const colorIndex   = (data.colorIndex as number) ?? 0
    const sizes        = (data.sizes as string[]) ?? []
    const orderId      = data.orderId as number
    const orderNumber  = data.orderNumber as string
    const color        = colorsChosen[colorIndex]

    // Parse "P:10 M:20 G:15"
    const qtyBySize: Record<string, number> = {}
    const tokens = text.trim().split(/\s+/)
    for (const tok of tokens) {
      const [size, qtyStr] = tok.split(":")
      if (!size || qtyStr === undefined) continue
      const match = sizes.find(s => s.toLowerCase() === size.toLowerCase())
      const qty = parseInt(qtyStr, 10)
      if (match && !isNaN(qty) && qty >= 0) qtyBySize[match] = qty
    }
    const missing = sizes.filter(s => !(s in qtyBySize))
    if (Object.keys(qtyBySize).length === 0 || missing.length > 0) {
      await reply(jid, `Formato não reconhecido ou faltou tamanho. Manda todos: ${sizes.map(s => `${s}:qtd`).join(" ")}`)
      return true
    }

    try {
      await updateProdOrderGrade(orderId, color, qtyBySize)
    } catch (e) {
      console.error("[adminBot] salvar quantidade falhou:", e instanceof Error ? e.message : e)
      await reply(jid, "Deu erro ao salvar a quantidade. Tenta de novo.")
      return true
    }

    const nextIndex = colorIndex + 1
    if (nextIndex < colorsChosen.length) {
      await setState(user.id, "op_quantidade", withTimestamp({ ...data, colorIndex: nextIndex }))
      await reply(jid, `Anotado! Agora pra *${colorsChosen[nextIndex]}*:\n${sizes.map(s => `${s}:qtd`).join(" ")}`)
      return true
    }

    await setState(user.id, null, {})
    await reply(jid, `🎉 Ordem *${orderNumber}* completa! Já está em produção, segue o fluxo normal no painel.` + MENU_FOOTER)
    return true
  }

  // ── Nova entrada de matéria-prima: escolhendo material ──────────────────
  if (state === "insumo_material") {
    const materialsList = (data.materialsList as { id: number; name: string; unit: string }[]) ?? []
    const n = parseInt(lower, 10)
    if (isNaN(n) || n < 1 || n > materialsList.length) {
      await reply(jid, `Não entendi. Responda o número do material (1 a ${materialsList.length}).`)
      return true
    }
    const material = materialsList[n - 1]
    const { rows: variants } = await pool.query(
      `SELECT id, name FROM raw_material_variants WHERE material_id = $1 ORDER BY name`,
      [material.id]
    )
    await setState(user.id, "insumo_variante", withTimestamp({
      materialId: material.id, materialName: material.name, unit: material.unit,
      variantsList: variants.map(v => ({ id: v.id, name: v.name })),
    }))
    const novaOpcao = variants.length + 1
    await reply(
      jid,
      `Qual variação/cor de *${material.name}*?\n\n${numberedList(variants.map(v => v.name))}${variants.length ? "\n" : ""}${novaOpcao}. Nova variação...\n\n_"cancelar" pra sair._`
    )
    return true
  }

  // ── Nova entrada de matéria-prima: escolhendo ou criando variação ───────
  if (state === "insumo_variante") {
    const variantsList = (data.variantsList as { id: number; name: string }[]) ?? []
    const n = parseInt(lower, 10)
    const novaOpcao = variantsList.length + 1
    if (isNaN(n) || n < 1 || n > novaOpcao) {
      await reply(jid, `Não entendi. Responda um número de 1 a ${novaOpcao}.`)
      return true
    }
    if (n === novaOpcao) {
      await setState(user.id, "insumo_variante_nome", withTimestamp({ ...data }))
      await reply(jid, `Qual o nome da nova variação/cor?`)
      return true
    }
    const variant = variantsList[n - 1]
    await setState(user.id, "insumo_quantidade", withTimestamp({
      ...data, variantId: variant.id, varianteName: variant.name,
    }))
    await reply(jid, `Quantidade e preço por ${data.unit}? Formato: qtd preço (ex: 50 12.90)`)
    return true
  }

  // ── Nova entrada de matéria-prima: nome da variação nova ────────────────
  if (state === "insumo_variante_nome") {
    if (!text.trim()) {
      await reply(jid, "Manda o nome da variação.")
      return true
    }
    try {
      const variant = await createRawMaterialVariant(data.materialId as number, text.trim())
      await setState(user.id, "insumo_quantidade", withTimestamp({
        ...data, variantId: variant.id, varianteName: variant.name,
      }))
      await reply(jid, `Variação *${variant.name}* criada. Quantidade e preço por ${data.unit}? Formato: qtd preço (ex: 50 12.90)`)
    } catch (e) {
      console.error("[adminBot] criar variação falhou:", e instanceof Error ? e.message : e)
      await setState(user.id, null, {})
      await reply(jid, "Deu erro ao criar a variação. Tenta de novo ou crie pelo painel." + MENU_FOOTER)
    }
    return true
  }

  // ── Nova entrada de matéria-prima: quantidade e preço ───────────────────
  if (state === "insumo_quantidade") {
    const parts = text.trim().split(/\s+/)
    const qty = parseFloat((parts[0] ?? "").replace(",", "."))
    const price = parseFloat((parts[1] ?? "").replace(",", "."))
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
      await reply(jid, `Formato não reconhecido. Manda quantidade e preço separados por espaço (ex: 50 12.90).`)
      return true
    }
    try {
      const entry = await createRawMaterialEntry(
        data.materialId as number, data.variantId as number, qty, price
      )
      await setState(user.id, null, {})
      await reply(
        jid,
        `✅ Lote *${entry.number}* criado! ${entry.materialName} - ${entry.varianteName}: ${qty} ${entry.unit} a ${price}/${entry.unit}.` + MENU_FOOTER
      )
    } catch (e) {
      console.error("[adminBot] criar lote falhou:", e instanceof Error ? e.message : e)
      await setState(user.id, null, {})
      await reply(jid, "Deu erro ao criar o lote. Tenta de novo ou lance pelo painel." + MENU_FOOTER)
    }
    return true
  }

  // ── Lançar despesa: categoria ────────────────────────────────────────────
  if (state === "despesa_categoria") {
    const n = parseInt(lower, 10)
    if (isNaN(n) || n < 1 || n > VARIABLE_COST_CATEGORIES.length) {
      await reply(jid, `Não entendi. Responda o número da categoria (1 a ${VARIABLE_COST_CATEGORIES.length}).`)
      return true
    }
    await setState(user.id, "despesa_descricao", withTimestamp({ category: VARIABLE_COST_CATEGORIES[n - 1] }))
    await reply(jid, `Categoria *${VARIABLE_COST_CATEGORIES[n - 1]}*. Qual a descrição da despesa?`)
    return true
  }

  // ── Lançar despesa: descrição ────────────────────────────────────────────
  if (state === "despesa_descricao") {
    if (!text.trim()) {
      await reply(jid, "Manda a descrição da despesa.")
      return true
    }
    await setState(user.id, "despesa_valor", withTimestamp({ ...data, description: text.trim() }))
    await reply(jid, `Qual o valor? (ex: 45.90)`)
    return true
  }

  // ── Lançar despesa: valor e criação ──────────────────────────────────────
  if (state === "despesa_valor") {
    const amount = parseFloat(text.trim().replace(",", "."))
    if (isNaN(amount) || amount <= 0) {
      await reply(jid, "Valor não reconhecido. Manda só o número (ex: 45.90).")
      return true
    }
    try {
      await pool.query(`
        INSERT INTO variable_costs (description, category, amount, cost_date)
        VALUES ($1, $2, $3, (CURRENT_TIMESTAMP AT TIME ZONE 'America/Sao_Paulo')::date)
      `, [data.description, data.category, amount])
      await setState(user.id, null, {})
      await reply(jid, `✅ Despesa lançada! ${data.category} — ${data.description}: ${fmtMoney(amount)}.` + MENU_FOOTER)
    } catch (e) {
      console.error("[adminBot] lançar despesa falhou:", e instanceof Error ? e.message : e)
      await setState(user.id, null, {})
      await reply(jid, "Deu erro ao lançar a despesa. Tenta de novo ou lance pelo painel." + MENU_FOOTER)
    }
    return true
  }

  // Estado desconhecido/corrompido — reseta e engole a mensagem (não deixa
  // vazar pro fluxo de cliente no meio de um estado que não faz sentido).
  await setState(user.id, null, {})
  return true
}

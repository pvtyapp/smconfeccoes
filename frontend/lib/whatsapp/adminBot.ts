import { pool } from "@/lib/db"
import { sendWhatsApp } from "@/lib/whatsapp/send"
import { createProdOrder } from "@/lib/prodOrders/createOrder"
import { updateProdOrderGrade } from "@/lib/prodOrders/updateGrade"
import { createRawMaterialEntry } from "@/lib/rawMaterials/createEntry"
import { createRawMaterialVariant } from "@/lib/rawMaterials/createVariant"

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
export async function resolveAdminUser(jid: string, remoteJidAlt: string): Promise<AdminUser | null> {
  const phoneJid = jid.endsWith("@lid") && remoteJidAlt.endsWith("@s.whatsapp.net") ? remoteJidAlt : jid
  const phone = phoneJid.replace("@s.whatsapp.net", "").replace(/\D/g, "")
  if (phone.length < 8) return null

  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_state TEXT`).catch(() => {})
  await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS wa_state_data JSONB NOT NULL DEFAULT '{}'`).catch(() => {})

  const { rows } = await pool.query(
    `SELECT id, name, is_admin AS "isAdmin", allowed_pages AS "allowedPages",
            wa_state AS "waState", wa_state_data AS "waStateData"
     FROM users WHERE active = true AND phone = $1 LIMIT 1`,
    [phone]
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

export async function handleAdminMessage(jid: string, text: string, userIn: AdminUser): Promise<void> {
  const user = await resetIfStale(userIn)
  const lower = text.toLowerCase().trim()

  if (lower === "cancelar" || lower === "sair") {
    if (user.waState && user.waState !== "idle") {
      await setState(user.id, null, {})
      await reply(jid, "Ok, cancelado. Se já tinha criado algo (ordem ou lote), continua no painel — pode completar por lá.")
    } else {
      await reply(jid, "Nada em andamento.")
    }
    return
  }

  const state = user.waState ?? "idle"

  if (state === "idle") {
    if (lower.includes("criar ordem")) {
      if (!hasPermission(user, "/dashboard/programacao")) {
        await reply(jid, "Você não tem permissão pra criar ordem de produção.")
        return
      }
      const { rows: products } = await pool.query(`
        SELECT id, name, size_list AS "sizeList", color_list AS "colorList"
        FROM products
        WHERE status = 'active' AND array_length(color_list, 1) > 0 AND array_length(size_list, 1) > 0
        ORDER BY name
      `)
      if (products.length === 0) {
        await reply(jid, "Nenhum produto com cores e tamanhos cadastrados encontrado.")
        return
      }
      await setState(user.id, "op_produto", withTimestamp({
        productsList: products.map(p => ({ id: p.id, name: p.name, sizeList: p.sizeList, colorList: p.colorList })),
      }))
      await reply(jid, `📦 *Criar Ordem de Produção*\n\nQual produto?\n\n${numberedList(products.map(p => p.name))}\n\n_Responda só o número. "cancelar" pra sair._`)
      return
    }
    if (lower.includes("criar insumo")) {
      if (!hasPermission(user, "/dashboard/materias-primas")) {
        await reply(jid, "Você não tem permissão pra dar entrada de matéria-prima.")
        return
      }
      const { rows: materials } = await pool.query(`
        SELECT id, name, unit FROM raw_materials WHERE status = 'active' ORDER BY name
      `)
      if (materials.length === 0) {
        await reply(jid, "Nenhum material cadastrado. Cadastre uma categoria pelo painel antes.")
        return
      }
      await setState(user.id, "insumo_material", withTimestamp({
        materialsList: materials.map(m => ({ id: m.id, name: m.name, unit: m.unit })),
      }))
      await reply(jid, `📦 *Nova Entrada de Matéria-Prima*\n\nQual material?\n\n${numberedList(materials.map(m => `${m.name} (${m.unit})`))}\n\n_Responda só o número. "cancelar" pra sair._`)
      return
    }
    // Nenhum comando reconhecido — modo admin fica em silêncio (evita responder
    // ruído; comandos de relatório entram aqui numa próxima rodada)
    return
  }

  const data = user.waStateData ?? {}

  // ── Escolhendo produto ──────────────────────────────────────────────────
  if (state === "op_produto") {
    const productsList = (data.productsList as { id: string; name: string; sizeList: string[]; colorList: string[] }[]) ?? []
    const n = parseInt(lower, 10)
    if (isNaN(n) || n < 1 || n > productsList.length) {
      await reply(jid, `Não entendi. Responda o número do produto (1 a ${productsList.length}).`)
      return
    }
    const product = productsList[n - 1]
    await setState(user.id, "op_cores", withTimestamp({
      productId: product.id, productName: product.name, sizes: product.sizeList, colorsAll: product.colorList,
    }))
    await reply(jid, `Cores de *${product.name}* — quais entram nessa ordem?\n\n${numberedList(product.colorList)}\n\n_Pode escolher mais de uma, separado por vírgula (ex: 1,3). "cancelar" pra sair._`)
    return
  }

  // ── Escolhendo cores ─────────────────────────────────────────────────────
  if (state === "op_cores") {
    const colorsAll = (data.colorsAll as string[]) ?? []
    const nums = parseNumberList(lower, colorsAll.length)
    if (!nums) {
      await reply(jid, `Não entendi. Responda os números das cores separados por vírgula (1 a ${colorsAll.length}).`)
      return
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
      await reply(jid, "Não há nenhum lote de matéria-prima disponível no estoque agora. Cadastre um lote antes de criar a ordem.")
      return
    }
    await setState(user.id, "op_material", withTimestamp({
      ...data, colorsChosen, colorIndex: 0,
      materialsList: materials.map(m => ({
        id: m.id,
        label: `${m.materialName}${m.varianteName ? " - " + m.varianteName : ""} (lote ${m.number}, ${Number(m.totalQty).toFixed(1)} ${m.unit})`,
      })),
    }))
    await reply(jid, `Cores escolhidas: ${colorsChosen.join(", ")}.\n\nQual lote de matéria-prima abastece *${colorsChosen[0]}*?\n\n${numberedList(materials.map(m => `${m.materialName}${m.varianteName ? " - " + m.varianteName : ""} (lote ${m.number}, ${Number(m.totalQty).toFixed(1)} ${m.unit})`))}\n\n_Pode escolher mais de um, separado por vírgula. "cancelar" pra sair._`)
    return
  }

  // ── Escolhendo material — um turno por cor ──────────────────────────────
  if (state === "op_material") {
    const colorsChosen = (data.colorsChosen as string[]) ?? []
    const colorIndex   = (data.colorIndex as number) ?? 0
    const materialsList = (data.materialsList as { id: number; label: string }[]) ?? []
    const nums = parseNumberList(lower, materialsList.length)
    if (!nums) {
      await reply(jid, `Não entendi. Responda os números dos lotes separados por vírgula (1 a ${materialsList.length}).`)
      return
    }
    const materialsByColor = (data.materialsByColor as Record<string, number[]>) ?? {}
    materialsByColor[colorsChosen[colorIndex]] = nums.map(n => materialsList[n - 1].id)

    const nextIndex = colorIndex + 1
    if (nextIndex < colorsChosen.length) {
      await setState(user.id, "op_material", withTimestamp({ ...data, materialsByColor, colorIndex: nextIndex }))
      await reply(jid, `Anotado. Qual lote abastece *${colorsChosen[nextIndex]}*?\n\n${numberedList(materialsList.map(m => m.label))}`)
      return
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
      await reply(jid, "Deu erro ao criar a ordem. Tenta de novo em alguns instantes ou crie pelo painel.")
    }
    return
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
      return
    }

    try {
      await updateProdOrderGrade(orderId, color, qtyBySize)
    } catch (e) {
      console.error("[adminBot] salvar quantidade falhou:", e instanceof Error ? e.message : e)
      await reply(jid, "Deu erro ao salvar a quantidade. Tenta de novo.")
      return
    }

    const nextIndex = colorIndex + 1
    if (nextIndex < colorsChosen.length) {
      await setState(user.id, "op_quantidade", withTimestamp({ ...data, colorIndex: nextIndex }))
      await reply(jid, `Anotado! Agora pra *${colorsChosen[nextIndex]}*:\n${sizes.map(s => `${s}:qtd`).join(" ")}`)
      return
    }

    await setState(user.id, null, {})
    await reply(jid, `🎉 Ordem *${orderNumber}* completa! Já está em produção, segue o fluxo normal no painel.`)
    return
  }

  // ── Nova entrada de matéria-prima: escolhendo material ──────────────────
  if (state === "insumo_material") {
    const materialsList = (data.materialsList as { id: number; name: string; unit: string }[]) ?? []
    const n = parseInt(lower, 10)
    if (isNaN(n) || n < 1 || n > materialsList.length) {
      await reply(jid, `Não entendi. Responda o número do material (1 a ${materialsList.length}).`)
      return
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
    return
  }

  // ── Nova entrada de matéria-prima: escolhendo ou criando variação ───────
  if (state === "insumo_variante") {
    const variantsList = (data.variantsList as { id: number; name: string }[]) ?? []
    const n = parseInt(lower, 10)
    const novaOpcao = variantsList.length + 1
    if (isNaN(n) || n < 1 || n > novaOpcao) {
      await reply(jid, `Não entendi. Responda um número de 1 a ${novaOpcao}.`)
      return
    }
    if (n === novaOpcao) {
      await setState(user.id, "insumo_variante_nome", withTimestamp({ ...data }))
      await reply(jid, `Qual o nome da nova variação/cor?`)
      return
    }
    const variant = variantsList[n - 1]
    await setState(user.id, "insumo_quantidade", withTimestamp({
      ...data, variantId: variant.id, varianteName: variant.name,
    }))
    await reply(jid, `Quantidade e preço por ${data.unit}? Formato: qtd preço (ex: 50 12.90)`)
    return
  }

  // ── Nova entrada de matéria-prima: nome da variação nova ────────────────
  if (state === "insumo_variante_nome") {
    if (!text.trim()) {
      await reply(jid, "Manda o nome da variação.")
      return
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
      await reply(jid, "Deu erro ao criar a variação. Tenta de novo ou crie pelo painel.")
    }
    return
  }

  // ── Nova entrada de matéria-prima: quantidade e preço ───────────────────
  if (state === "insumo_quantidade") {
    const parts = text.trim().split(/\s+/)
    const qty = parseFloat((parts[0] ?? "").replace(",", "."))
    const price = parseFloat((parts[1] ?? "").replace(",", "."))
    if (isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
      await reply(jid, `Formato não reconhecido. Manda quantidade e preço separados por espaço (ex: 50 12.90).`)
      return
    }
    try {
      const entry = await createRawMaterialEntry(
        data.materialId as number, data.variantId as number, qty, price
      )
      await setState(user.id, null, {})
      await reply(
        jid,
        `✅ Lote *${entry.number}* criado! ${entry.materialName} - ${entry.varianteName}: ${qty} ${entry.unit} a ${price}/${entry.unit}.`
      )
    } catch (e) {
      console.error("[adminBot] criar lote falhou:", e instanceof Error ? e.message : e)
      await setState(user.id, null, {})
      await reply(jid, "Deu erro ao criar o lote. Tenta de novo ou lance pelo painel.")
    }
    return
  }
}

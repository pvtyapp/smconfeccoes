import { pool } from "@/lib/db"
import type { ParsedItem } from "@/lib/ai/parseOrder"

export type MatchedItem = ParsedItem & {
  variantId: string | null
  unitPrice: number | null
  sku: string | null
  matched: boolean
  productRecognized: boolean
  alternatives: string[]
  currentStock: number
  stockOk: boolean
}

function norm(s: string): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]/g, " ")
    .trim()
}

function wordMatch(a: string, b: string): boolean {
  return a === b || b.startsWith(a) || a.startsWith(b)
}

// Nome do produto continua por aproximação — é só pra achar a linha de
// produto certa (Camiseta Infantil vs Adulto), tem mais variação de escrita
// e menos risco de baixar estoque errado se ficar um pouco solto.
function nameScore(a: string, b: string): number {
  const na = norm(a)
  const nb = norm(b)
  if (na === nb) return 1
  const wa = na.split(/\s+/).filter(Boolean)
  const wb = nb.split(/\s+/).filter(Boolean)
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  if (shorter.length > 0 && shorter.every(w => longer.some(bw => wordMatch(w, bw)))) return 0.85
  const hits = wa.filter(w => w.length > 2 && wb.some(bw => wordMatch(w, bw))).length
  return hits / Math.max(wa.length, wb.length)
}

// Tamanho é categórico — ou é o mesmo tamanho, ou não é (não existe "tamanho
// parecido"). Antes usava a mesma pontuação por palavra do nome, que ignora
// token com 2 caracteres ou menos — "08" contra "8" nunca pontuava nada
// (nem contra o tamanho certo, nem contra os errados), e o desempate acabava
// caindo sempre no primeiro que o banco devolvesse. Com zero à esquerda
// removido antes de comparar, "08" e "8" são claramente o mesmo tamanho.
function sizeExact(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  if (/^\d+$/.test(na) && /^\d+$/.test(nb)) return parseInt(na, 10) === parseInt(nb, 10)
  return false
}

// Cor precisa bater com o cadastro de verdade — igual, ou o que o cliente
// disse claramente contido na cor real (ex: "verde" pra "Verde Militar").
// Antes bastava 1 palavra em comum de várias pra pontuar o suficiente —
// "rosa pink" "batia" com "Rosa Bebê" só por causa de "rosa", mesmo a cor
// dita pelo cliente não existindo no catálogo. Sem bater direito, retorna
// false e o item fica sem variante — melhor não vincular do que vincular
// errado (baixa estoque da cor/tamanho errado sem ninguém perceber).
function colorMatch(a: string, b: string): boolean {
  const na = norm(a)
  const nb = norm(b)
  if (!na || !nb) return false
  if (na === nb) return true
  const wa = na.split(/\s+/).filter(Boolean)
  const wb = nb.split(/\s+/).filter(Boolean)
  const [shorter, longer] = wa.length <= wb.length ? [wa, wb] : [wb, wa]
  return shorter.length > 0 && shorter.every(w => longer.some(bw => wordMatch(w, bw)))
}

type Variant = {
  id: string
  productId: string
  productName: string
  color: string
  size: string
  sku: string
  salePrice: number
  currentStock: number
}

export async function matchVariants(items: ParsedItem[]): Promise<MatchedItem[]> {
  const { rows: variants } = await pool.query<Variant>(`
    SELECT
      pv.id,
      pv.product_id   AS "productId",
      p.name          AS "productName",
      pv.color,
      pv.size,
      pv.sku,
      pv.sale_price   AS "salePrice",
      GREATEST(
        COALESCE(bal.qty, 0) - COALESCE(rsvd.qty_notified, 0),
        0
      )::int AS "currentStock"
    FROM product_variants pv
    JOIN products p ON p.id = pv.product_id
    LEFT JOIN (
      SELECT variant_id,
             SUM(CASE WHEN type = 'in' THEN quantity ELSE -quantity END) AS qty
      FROM stock_movements
      GROUP BY variant_id
    ) bal ON bal.variant_id = pv.id
    LEFT JOIN (
      SELECT variant_id, SUM(qty) AS qty_notified
      FROM product_reservations
      WHERE status = 'notified'
      GROUP BY variant_id
    ) rsvd ON rsvd.variant_id = pv.id
    WHERE pv.status = 'active' AND p.chatbot_enabled = true AND p.chatbot_disponivel = true
  `)

  return items.map(item => {
    const candidates = variants.filter(v => nameScore(item.productName, v.productName) > 0.5)

    // Se o cliente não disse cor (ou tamanho) e o produto tem mais de uma
    // opção real de cor (ou tamanho) no catálogo, não dá pra saber qual ele
    // quer — casar com a primeira que aparecer já causou baixa de estoque
    // errada sem ninguém perceber (pedido do Rafael, moletom sem variação
    // virou "Preto P" sozinho e foi até concluído). Nesse caso o item fica
    // sem vínculo de propósito, pro operador escolher no Gerenciador.
    const distinctColors = new Set(candidates.map(v => norm(v.color)).filter(Boolean))
    const distinctSizes  = new Set(candidates.map(v => norm(v.size)).filter(Boolean))
    const colorAmbiguous = !item.color && distinctColors.size > 1
    const sizeAmbiguous  = !item.size && distinctSizes.size > 1

    let best: Variant | null = null
    let bestScore = 0

    if (!colorAmbiguous && !sizeAmbiguous) {
      for (const v of candidates) {
        // Cor e tamanho não têm mais nota — ou batem de verdade com o cadastro
        // real dessa variante, ou o item fica sem vínculo (melhor não vincular
        // do que vincular na cor/tamanho errado sem ninguém perceber).
        if (item.color && !colorMatch(item.color, v.color)) continue
        if (item.size && !sizeExact(item.size, v.size)) continue

        const nScore = nameScore(item.productName, v.productName)
        if (nScore > bestScore) {
          bestScore = nScore
          best = v
        }
      }
    }

    const alternatives = best
      ? []
      : candidates
          .map(v => [v.color, v.size].filter(Boolean).join(" "))
          .filter(Boolean)
          .slice(0, 5)

    const currentStock = best?.currentStock ?? 0
    return {
      ...item,
      productName:  best?.productName ?? candidates[0]?.productName ?? item.productName,
      variantId:    best?.id ?? null,
      unitPrice:    best ? Number(best.salePrice) : null,
      sku:          best?.sku ?? null,
      matched:      best !== null,
      productRecognized: candidates.length > 0,
      alternatives: [...new Set(alternatives)],
      currentStock,
      stockOk:      best !== null && currentStock >= item.qty,
    }
  })
}

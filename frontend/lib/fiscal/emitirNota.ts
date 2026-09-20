import { pool } from "@/lib/db"
import { isNfeEligible } from "@/lib/portal/fiscalCompleteness"

// Motor de emissão — extraído de app/api/fiscal/emitir (rota do staff) pra
// ser chamado também pela rota do portal (cliente pedindo a própria nota).
// Mesmo caminho de código pros dois, pra nunca divergir com o tempo.

const EMITENTE_UF = "SP"

function spIsoNow(): string {
  const utc = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}-03:00`
}

async function loadFiscalSettings() {
  const { rows } = await pool.query(`SELECT key, value FROM app_settings WHERE key LIKE 'fiscal_%'`)
  const s: Record<string, string> = {}
  for (const r of rows) s[r.key] = r.value
  return {
    cnpjEmitente: s.fiscal_cnpj_emitente ?? "",
    tokenHomologacao: s.fiscal_token_homologacao ?? "",
    tokenProducao: s.fiscal_token_producao ?? "",
    ambienteAtivo: s.fiscal_ambiente_ativo === "producao" ? "producao" : "homologacao",
    serieAtiva: s.fiscal_serie_ativa || "2",
  }
}

export type EmitirNotaResult =
  | { ok: true; ref: string; status: "processando" }
  | { ok: false; httpStatus: number; error: string; detail?: unknown }

// Emissão consolidada: N pedidos selecionados (do mesmo cliente) viram 1 NFe
// só, com os itens de todos somados. Emissão individual é só o caso N=1.
export async function emitirNotaFiscal(orderIds: number[]): Promise<EmitirNotaResult> {
  if (orderIds.length === 0) return { ok: false, httpStatus: 400, error: "orderIds é obrigatório" }

  const settings = await loadFiscalSettings()
  if (!settings.cnpjEmitente || !settings.tokenHomologacao || !settings.tokenProducao) {
    return { ok: false, httpStatus: 400, error: "Configure o CNPJ emitente e os tokens do Focus NFe em Configurações antes de emitir." }
  }

  const { rows: orderRows } = await pool.query(`
    SELECT
      o.id, o.number,
      c.id                       AS "contactId",
      COALESCE(c.nome_cadastro, c.name) AS "contactName",
      c.cpf_cnpj                 AS "cpfCnpj",
      c.tipo_pessoa              AS "tipoPessoa",
      c.razao_social             AS "razaoSocial",
      c.regime_tributario        AS "regimeTributario",
      c.inscricao_estadual       AS "inscricaoEstadual",
      c.cep, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf,
      c.codigo_municipio_ibge    AS "codigoMunicipioIbge"
    FROM orders o
    JOIN wa_contacts c ON c.id = o.contact_id
    WHERE o.id = ANY($1::int[])
  `, [orderIds])

  if (orderRows.length !== orderIds.length) {
    return { ok: false, httpStatus: 404, error: "Um ou mais pedidos não foram encontrados." }
  }

  const contactIds = new Set(orderRows.map((o: { contactId: number }) => o.contactId))
  if (contactIds.size > 1) {
    return { ok: false, httpStatus: 400, error: "Os pedidos selecionados são de clientes diferentes — uma nota só pode ter 1 destinatário." }
  }
  const order = orderRows[0]

  // Nota fiscal não é emitida pra pessoa física nem MEI (decisão do dono,
  // 2026-09-20) — trava aqui protege tanto a emissão do staff quanto a do
  // cliente, sem depender de cada chamador lembrar de checar antes.
  if (!isNfeEligible(order)) {
    return {
      ok: false, httpStatus: 400,
      error: "Emissão de nota fiscal não disponível para pessoa física ou MEI.",
    }
  }

  const faltando: string[] = []
  if (!order.cpfCnpj) faltando.push("CNPJ")
  if (!order.razaoSocial) faltando.push("razão social")
  if (!order.logradouro) faltando.push("logradouro")
  if (!order.numero) faltando.push("número")
  if (!order.bairro) faltando.push("bairro")
  if (!order.cidade) faltando.push("cidade")
  if (!order.uf) faltando.push("UF")
  if (!order.codigoMunicipioIbge) faltando.push("código IBGE do município")
  if (!order.cep) faltando.push("CEP")
  if (faltando.length > 0) {
    return {
      ok: false, httpStatus: 400,
      error: `Cliente sem dados fiscais completos. Falta: ${faltando.join(", ")}. Complete no cadastro do cliente antes de emitir.`,
    }
  }

  const { rows: existing } = await pool.query(`
    SELECT fno.order_id AS "orderId", fn.status
    FROM fiscal_note_orders fno
    JOIN fiscal_notes fn ON fn.id = fno.fiscal_note_id
    WHERE fno.order_id = ANY($1::int[]) AND fn.status IN ('pendente','processando','autorizada')
  `, [orderIds])
  if (existing[0]) {
    const nums = orderRows.filter((o: { id: number }) => existing.some((e: { orderId: number }) => e.orderId === o.id))
      .map((o: { number: string }) => o.number).join(", ")
    return { ok: false, httpStatus: 409, error: `Pedido(s) ${nums} já tem nota ${existing[0].status} — remova da seleção.` }
  }

  const { rows: items } = await pool.query(`
    SELECT
      i.id, i.product_name AS "productName", i.qty::float AS qty, i.unit_price::float AS "unitPrice",
      p.ncm, p.cest, p.origem, p.csosn,
      COALESCE(p.unidade_tributavel, 'UN')    AS "unidadeTributavel",
      COALESCE(p.cfop_dentro_estado, '5101')  AS "cfopDentroEstado",
      COALESCE(p.cfop_fora_estado, '6101')    AS "cfopForaEstado"
    FROM order_items i
    LEFT JOIN product_variants pv ON pv.id = i.variant_id
    LEFT JOIN products p ON p.id = COALESCE(i.product_id, pv.product_id)
    WHERE i.order_id = ANY($1::int[]) AND COALESCE(i.is_service, false) = false
  `, [orderIds])

  if (items.length === 0) {
    return { ok: false, httpStatus: 400, error: "Pedido(s) sem item de produto pra faturar." }
  }
  const itemSemNcm = items.find((it: { ncm: string | null }) => !it.ncm)
  if (itemSemNcm) {
    return {
      ok: false, httpStatus: 400,
      error: `Produto "${itemSemNcm.productName}" sem NCM cadastrado. Complete o cadastro fiscal do produto antes de emitir.`,
    }
  }

  const dentroDoEstado = order.uf === EMITENTE_UF
  const valorTotal = items.reduce((s: number, it: { qty: number; unitPrice: number | null }) => s + it.qty * (it.unitPrice ?? 0), 0)

  const ref = `pedidos-${orderIds.join("-")}-${Date.now()}`

  const payload: Record<string, unknown> = {
    cnpj_emitente: settings.cnpjEmitente,
    natureza_operacao: "Venda de mercadoria",
    data_emissao: spIsoNow(),
    tipo_documento: 1,
    finalidade_emissao: 1,
    consumidor_final: 1,
    presenca_comprador: 1,
    modalidade_frete: 9,
    serie: settings.serieAtiva,
    nome_destinatario: order.razaoSocial,
    logradouro_destinatario: order.logradouro,
    numero_destinatario: order.numero,
    complemento_destinatario: order.complemento || undefined,
    bairro_destinatario: order.bairro,
    municipio_destinatario: order.cidade,
    uf_destinatario: order.uf,
    cep_destinatario: order.cep.replace(/\D/g, ""),
    codigo_municipio_destinatario: order.codigoMunicipioIbge,
    pais_destinatario: "Brasil",
    codigo_pais_destinatario: "1058",
    items: items.map((it: {
      productName: string; qty: number; unitPrice: number | null
      ncm: string; cest: string | null; origem: string | null; csosn: string | null
      unidadeTributavel: string; cfopDentroEstado: string; cfopForaEstado: string
    }, idx: number) => ({
      numero_item: String(idx + 1),
      codigo_produto: String(idx + 1).padStart(4, "0"),
      descricao: it.productName,
      cfop: dentroDoEstado ? it.cfopDentroEstado : it.cfopForaEstado,
      codigo_ncm: it.ncm,
      unidade_comercial: it.unidadeTributavel,
      quantidade_comercial: String(it.qty),
      valor_unitario_comercial: (it.unitPrice ?? 0).toFixed(2),
      valor_bruto: (it.qty * (it.unitPrice ?? 0)).toFixed(2),
      unidade_tributavel: it.unidadeTributavel,
      quantidade_tributavel: String(it.qty),
      valor_unitario_tributavel: (it.unitPrice ?? 0).toFixed(2),
      icms_origem: it.origem || "0",
      icms_situacao_tributaria: it.csosn || "102",
      pis_situacao_tributaria: "49",
      cofins_situacao_tributaria: "49",
      valor_total_tributos: "0",
    })),
  }

  const cnpjLimpo = order.cpfCnpj.replace(/\D/g, "")
  payload.cnpj_destinatario = cnpjLimpo
  payload.indicador_ie_destinatario = order.inscricaoEstadual ? 1 : 9
  if (order.inscricaoEstadual) payload.inscricao_estadual_destinatario = order.inscricaoEstadual

  const client = await pool.connect()
  let noteId: number
  try {
    await client.query("BEGIN")
    const { rows: noteRows } = await client.query(`
      INSERT INTO fiscal_notes (status, ambiente, ref, valor_total)
      VALUES ('processando', $1, $2, $3)
      RETURNING id
    `, [settings.ambienteAtivo, ref, valorTotal])
    noteId = noteRows[0].id
    for (const orderId of orderIds) {
      await client.query(
        `INSERT INTO fiscal_note_orders (fiscal_note_id, order_id) VALUES ($1, $2)`,
        [noteId, orderId]
      )
    }
    await client.query("COMMIT")
  } catch (err) {
    await client.query("ROLLBACK")
    throw err
  } finally {
    client.release()
  }

  const token = settings.ambienteAtivo === "producao" ? settings.tokenProducao : settings.tokenHomologacao
  const baseUrl = settings.ambienteAtivo === "producao"
    ? "https://api.focusnfe.com.br"
    : "https://homologacao.focusnfe.com.br"

  const focusRes = await fetch(`${baseUrl}/v2/nfe?ref=${encodeURIComponent(ref)}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${Buffer.from(`${token}:`).toString("base64")}`,
    },
    body: JSON.stringify(payload),
  })
  const focusData = await focusRes.json().catch(() => ({}))

  if (focusRes.status !== 202) {
    await pool.query(
      `UPDATE fiscal_notes SET status = 'rejeitada', motivo_rejeicao = $1 WHERE id = $2`,
      [focusData.mensagem || JSON.stringify(focusData), noteId]
    )
    return { ok: false, httpStatus: 422, error: focusData.mensagem || "Focus NFe recusou a requisição.", detail: focusData }
  }

  return { ok: true, ref, status: "processando" }
}

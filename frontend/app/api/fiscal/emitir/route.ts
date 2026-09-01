import { NextResponse } from "next/server"
import { pool } from "@/lib/db"

// Empresa fixa (SM Confecções) — mesma UF usada em Focus NFe pra decidir CFOP
// dentro/fora do estado. Não muda por pedido, então fica constante aqui em vez
// de virar mais uma config.
const EMITENTE_UF = "SP"

function spIsoNow(): string {
  // "-03:00" hardcoded no formato engana se a hora não vier de verdade
  // convertida — testado manualmente contra o Date header da Focus NFe antes
  // de virar código (ver sessão de teste em homologação).
  const utc = new Date(Date.now() - 3 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${utc.getUTCFullYear()}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())}T${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())}-03:00`
}

async function loadFiscalSettings() {
  const { rows } = await pool.query(
    `SELECT key, value FROM app_settings WHERE key LIKE 'fiscal_%'`
  )
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

// Emissão consolidada: N pedidos selecionados (do mesmo cliente) viram 1 NFe
// só, com os itens de todos somados. Emissão individual é só o caso N=1 —
// mesmo caminho de código, sem duplicar lógica.
export async function POST(req: Request) {
  try {
    const body = await req.json()
    const orderIds: number[] = Array.isArray(body.orderIds)
      ? body.orderIds
      : body.orderId ? [body.orderId] : []
    if (orderIds.length === 0) return NextResponse.json({ error: "orderIds é obrigatório" }, { status: 400 })

    const settings = await loadFiscalSettings()
    if (!settings.cnpjEmitente || !settings.tokenHomologacao || !settings.tokenProducao) {
      return NextResponse.json(
        { error: "Configure o CNPJ emitente e os tokens do Focus NFe em Configurações antes de emitir." },
        { status: 400 }
      )
    }

    const { rows: orderRows } = await pool.query(`
      SELECT
        o.id, o.number,
        c.id                       AS "contactId",
        COALESCE(c.nome_cadastro, c.name) AS "contactName",
        c.cpf_cnpj                 AS "cpfCnpj",
        c.tipo_pessoa              AS "tipoPessoa",
        c.inscricao_estadual       AS "inscricaoEstadual",
        c.cep, c.logradouro, c.numero, c.complemento, c.bairro, c.cidade, c.uf,
        c.codigo_municipio_ibge    AS "codigoMunicipioIbge"
      FROM orders o
      JOIN wa_contacts c ON c.id = o.contact_id
      WHERE o.id = ANY($1::int[])
    `, [orderIds])

    if (orderRows.length !== orderIds.length) {
      return NextResponse.json({ error: "Um ou mais pedidos não foram encontrados." }, { status: 404 })
    }

    // Trava de servidor — mesma checagem que a tela já faz antes de deixar
    // selecionar, mas aqui é a garantia de verdade.
    const contactIds = new Set(orderRows.map((o: { contactId: number }) => o.contactId))
    if (contactIds.size > 1) {
      return NextResponse.json(
        { error: "Os pedidos selecionados são de clientes diferentes — uma nota só pode ter 1 destinatário." },
        { status: 400 }
      )
    }
    const order = orderRows[0]

    // Bloqueio claro — sem dado genérico pra forçar passar (decisão do dono
    // do projeto: emissão trava aqui, não inventa CPF/endereço).
    const faltando: string[] = []
    if (!order.cpfCnpj) faltando.push(order.tipoPessoa === "juridica" ? "CNPJ" : "CPF")
    if (!order.logradouro) faltando.push("logradouro")
    if (!order.numero) faltando.push("número")
    if (!order.bairro) faltando.push("bairro")
    if (!order.cidade) faltando.push("cidade")
    if (!order.uf) faltando.push("UF")
    if (!order.codigoMunicipioIbge) faltando.push("código IBGE do município")
    if (!order.cep) faltando.push("CEP")
    if (faltando.length > 0) {
      return NextResponse.json(
        { error: `Cliente sem dados fiscais completos. Falta: ${faltando.join(", ")}. Complete no cadastro do cliente antes de emitir.` },
        { status: 400 }
      )
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
      return NextResponse.json(
        { error: `Pedido(s) ${nums} já tem nota ${existing[0].status} — remova da seleção.` },
        { status: 409 }
      )
    }

    const { rows: items } = await pool.query(`
      SELECT
        i.id, i.product_name AS "productName", i.qty::float AS qty, i.unit_price::float AS "unitPrice",
        p.ncm, p.cest, p.origem, p.csosn,
        COALESCE(p.unidade_tributavel, 'UN')    AS "unidadeTributavel",
        COALESCE(p.cfop_dentro_estado, '5101')  AS "cfopDentroEstado",
        COALESCE(p.cfop_fora_estado, '6101')    AS "cfopForaEstado"
      FROM order_items i
      LEFT JOIN products p ON p.id = i.product_id
      WHERE i.order_id = ANY($1::int[]) AND COALESCE(i.is_service, false) = false
    `, [orderIds])

    if (items.length === 0) {
      return NextResponse.json({ error: "Pedido(s) sem item de produto pra faturar." }, { status: 400 })
    }
    const itemSemNcm = items.find((it: { ncm: string | null }) => !it.ncm)
    if (itemSemNcm) {
      return NextResponse.json(
        { error: `Produto "${itemSemNcm.productName}" sem NCM cadastrado. Complete o cadastro fiscal do produto antes de emitir.` },
        { status: 400 }
      )
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
      nome_destinatario: order.contactName,
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

    const cpfLimpo = order.cpfCnpj.replace(/\D/g, "")
    if (order.tipoPessoa === "juridica") {
      payload.cnpj_destinatario = cpfLimpo
      payload.indicador_ie_destinatario = order.inscricaoEstadual ? 1 : 9
      if (order.inscricaoEstadual) payload.inscricao_estadual_destinatario = order.inscricaoEstadual
    } else {
      payload.cpf_destinatario = cpfLimpo
    }

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
      return NextResponse.json(
        { error: focusData.mensagem || "Focus NFe recusou a requisição.", detail: focusData },
        { status: 422 }
      )
    }

    return NextResponse.json({ ok: true, ref, status: "processando" })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

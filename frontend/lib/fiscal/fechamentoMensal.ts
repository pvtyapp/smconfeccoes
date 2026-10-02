import JSZip from "jszip"
import { pool } from "@/lib/db"
import { getProvider } from "@/lib/whatsapp/provider"
import { getAdminInstanceName } from "@/lib/whatsapp/adminInstance"
import { ADMINISTRATIVO_GROUP_JID, sendAdministrativo } from "@/lib/whatsapp/administrativoGroup"

// Fechamento mensal de notas fiscais pro contador: zip com XML + PDF de cada
// nota autorizada no mês (só produção — homologação não tem valor fiscal) +
// planilha resumo, mandado no grupo SM Administrativo.
//
// O mês é pela data de AUTORIZAÇÃO no horário de Brasília (não criado_em):
// nota criada 30/09 23h e autorizada 01/10 é de outubro pra Sefaz.
//
// Se o XML/PDF não estiver mais no banco (o /api/fiscal/expire-cron zera
// depois de 7 dias), baixa de novo da Focus NFe pelo ref da nota.

type NotaRow = {
  id: number
  ref: string
  numero: string
  serie: string
  chave_acesso: string | null
  valor_total: string | null
  autorizado_em_br: string
  cliente: string | null
  xml: string | null
  pdf: string | null
}

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
  "agosto", "setembro", "outubro", "novembro", "dezembro"]

// Mês anterior ao "agora" no horário de Brasília, formato YYYY-MM.
export function mesAnteriorBrasilia(now = new Date()): string {
  const br = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }))
  br.setDate(1)
  br.setMonth(br.getMonth() - 1)
  return `${br.getFullYear()}-${String(br.getMonth() + 1).padStart(2, "0")}`
}

async function baixarDaFocus(ref: string): Promise<{ xml: string; pdf: string }> {
  const { rows } = await pool.query(
    `SELECT value FROM app_settings WHERE key = 'fiscal_token_producao'`
  )
  const token = rows[0]?.value
  if (!token) throw new Error("fiscal_token_producao não configurado")
  const baseUrl = "https://api.focusnfe.com.br"
  const auth = `Basic ${Buffer.from(`${token}:`).toString("base64")}`

  const consulta = await fetch(`${baseUrl}/v2/nfe/${encodeURIComponent(ref)}`, { headers: { Authorization: auth } })
  if (!consulta.ok) throw new Error(`Focus NFe ${consulta.status} ao consultar ${ref}`)
  const data = await consulta.json() as { caminho_xml_nota_fiscal?: string; caminho_danfe?: string }
  if (!data.caminho_xml_nota_fiscal || !data.caminho_danfe) throw new Error(`Focus NFe sem arquivos pra ${ref}`)

  const [xmlRes, pdfRes] = await Promise.all([
    fetch(`${baseUrl}${data.caminho_xml_nota_fiscal}`, { headers: { Authorization: auth } }),
    fetch(`${baseUrl}${data.caminho_danfe}`, { headers: { Authorization: auth } }),
  ])
  if (!xmlRes.ok || !pdfRes.ok) throw new Error(`Focus NFe falhou ao baixar arquivos de ${ref}`)
  return {
    xml: await xmlRes.text(),
    pdf: Buffer.from(await pdfRes.arrayBuffer()).toString("base64"),
  }
}

function csvCell(v: string) {
  return /[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v
}

export async function montarFechamento(mes: string) {
  const { rows: notas } = await pool.query<NotaRow>(`
    SELECT n.id, n.ref, n.numero, n.serie, n.chave_acesso, n.valor_total, n.xml, n.pdf,
      to_char(n.autorizado_em AT TIME ZONE 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI') AS autorizado_em_br,
      (SELECT COALESCE(c.razao_social, c.nome_cadastro, c.name)
         FROM fiscal_note_orders fno
         JOIN orders o ON o.id = fno.order_id
         JOIN wa_contacts c ON c.id = o.contact_id
        WHERE fno.fiscal_note_id = n.id LIMIT 1) AS cliente
    FROM fiscal_notes n
    WHERE n.status = 'autorizada' AND n.ambiente = 'producao'
      AND to_char(n.autorizado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $1
    ORDER BY n.numero::int
  `, [mes])

  // Rejeitadas/travadas do mês — não vão no zip, só no aviso pro operador.
  const { rows: pendRows } = await pool.query<{ status: string; qtd: string }>(`
    SELECT status, count(*) AS qtd FROM fiscal_notes
    WHERE ambiente = 'producao' AND status IN ('rejeitada', 'processando')
      AND to_char(criado_em AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM') = $1
    GROUP BY status
  `, [mes])
  const pendentes = Object.fromEntries(pendRows.map(r => [r.status, Number(r.qtd)]))

  const zip = new JSZip()
  const faltando: string[] = []
  const linhas = ["Numero;Serie;Autorizada em;Cliente;Valor;Chave de acesso"]
  let total = 0

  for (const n of notas) {
    let { xml, pdf } = n
    if (!xml || !pdf) {
      try {
        const arq = await baixarDaFocus(n.ref)
        xml = xml ?? arq.xml
        pdf = pdf ?? arq.pdf
      } catch (e) {
        console.error("[fechamento-nf]", e instanceof Error ? e.message : e)
      }
    }
    if (xml) zip.file(`NFe-${n.numero}.xml`, xml)
    if (pdf) zip.file(`NFe-${n.numero}.pdf`, Buffer.from(pdf, "base64"))
    if (!xml || !pdf) faltando.push(n.numero)

    const valor = Number(n.valor_total ?? 0)
    total += valor
    linhas.push([n.numero, n.serie, n.autorizado_em_br, n.cliente ?? "", valor.toFixed(2).replace(".", ","), n.chave_acesso ?? ""]
      .map(csvCell).join(";"))
  }

  // BOM pro Excel abrir acentuação certa.
  zip.file(`resumo-notas-${mes}.csv`, "﻿" + linhas.join("\r\n"))
  const zipBase64 = (await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" })).toString("base64")

  return {
    mes,
    qtd: notas.length,
    total,
    primeira: notas[0]?.numero ?? null,
    ultima: notas[notas.length - 1]?.numero ?? null,
    faltando,
    rejeitadas: pendentes.rejeitada ?? 0,
    processando: pendentes.processando ?? 0,
    zipBase64,
  }
}

// `aviso` opcional entra antes do resumo (ex: contexto de um envio manual).
export async function enviarFechamentoMensal(mes: string, aviso?: string) {
  const f = await montarFechamento(mes)
  const [ano, m] = mes.split("-")
  const nomeMes = `${MESES[Number(m) - 1]}/${ano}`

  if (f.qtd === 0) {
    await sendAdministrativo(`🧾 *Notas fiscais de ${nomeMes}*\n\nNenhuma nota autorizada no mês, nada pra mandar pro contador.`)
    return { ...f, zipBase64: undefined, enviado: false }
  }

  const partes = [
    aviso,
    `🧾 *Fechamento de notas fiscais de ${nomeMes}*`,
    `${f.qtd} nota${f.qtd > 1 ? "s" : ""} autorizada${f.qtd > 1 ? "s" : ""} (nº ${f.primeira} a ${f.ultima})\nTotal: ${brl(f.total)}`,
    `O zip tem o XML e o PDF de cada nota, mais a planilha resumo. É só encaminhar pro contador.`,
    `Obs: notas do marketplace (Shopee/ML) não estão aqui, são emitidas fora do sistema.`,
  ]
  const alertas: string[] = []
  if (f.faltando.length) alertas.push(`⚠️ Arquivo faltando nas notas: ${f.faltando.join(", ")}`)
  if (f.rejeitadas) alertas.push(`⚠️ ${f.rejeitadas} tentativa${f.rejeitadas > 1 ? "s" : ""} rejeitada${f.rejeitadas > 1 ? "s" : ""} no mês (não entram no zip)`)
  if (f.processando) alertas.push(`⚠️ ${f.processando} nota${f.processando > 1 ? "s" : ""} ainda em "processando" (conferir na aba Notas Fiscais)`)
  if (alertas.length) partes.push(alertas.join("\n"))

  await sendAdministrativo(partes.filter(Boolean).join("\n\n"))

  const instance = await getAdminInstanceName()
  if (!instance) throw new Error("admin_instance_name não configurado")
  const provider = await getProvider()
  await provider.sendMedia(ADMINISTRATIVO_GROUP_JID.replace("@g.us", ""), {
    mediatype: "document",
    media: f.zipBase64,
    mimetype: "application/zip",
    fileName: `notas-fiscais-${mes}.zip`,
    instanceName: instance,
    timeoutMs: 60_000,
  })
  return { ...f, zipBase64: undefined, enviado: true }
}

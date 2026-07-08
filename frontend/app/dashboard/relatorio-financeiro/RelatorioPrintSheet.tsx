"use client"

import type { ReportData, StockValuation } from "./page"
import { CHANNEL_LABEL } from "./page"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

function fmtR(v: number | null | undefined): string {
  if (v == null) return "—"
  const n   = Number(v)
  const abs = Math.abs(n)
  const str = `R$ ${abs.toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
  return n < 0 ? `(${str})` : str
}

function pct(v: number | null | undefined): string {
  if (v == null) return "—"
  return `${v.toFixed(1)}%`
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <div style={{
      background: NAVY, color: "white", borderRadius: "4px",
      padding: "6px 12px", marginBottom: "8px", marginTop: "16px",
    }}>
      <span style={{ fontWeight: "800", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase" }}>
        {children}
      </span>
    </div>
  )
}

function DreLine({ label, value, indent, bold, sub }: {
  label: string; value: number | null; indent?: boolean; bold?: boolean; sub?: string
}) {
  return (
    <div style={{
      display: "flex", justifyContent: "space-between", alignItems: "baseline",
      padding: bold ? "6px 0" : "4px 0", paddingLeft: indent ? "16px" : 0,
      borderTop: bold ? `1.5px solid ${NAVY}` : "none",
      marginTop: bold ? "4px" : 0,
    }}>
      <div>
        <span style={{ fontSize: bold ? "11px" : "10px", fontWeight: bold ? "800" : "500", color: bold ? NAVY : "#444" }}>
          {label}
        </span>
        {sub && <span style={{ fontSize: "8px", color: "#999", marginLeft: "6px" }}>({sub})</span>}
      </div>
      <span style={{
        fontSize: bold ? "12px" : "10px", fontWeight: bold ? "900" : "600",
        color: value != null && value < 0 ? "#B91C1C" : NAVY,
      }}>
        {fmtR(value)}
      </span>
    </div>
  )
}

export default function RelatorioPrintSheet({ data, stockVal, onDone }: {
  data: ReportData
  stockVal: StockValuation | null
  onDone: () => void
}) {
  const { dre, summary } = data
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const emitDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const emitTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
  const periodFmt = (d: string) => {
    const [y, m, dd] = d.split("-")
    return `${dd}/${m}/${y}`
  }

  const channelTotal = Object.values(data.byChannel).reduce((s, v) => s + v, 0)
  const topProducts = data.productRanking.slice(0, 20)

  return (
    <div className="hidden print:block fixed inset-0 bg-white z-[100]">
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print-relatorio, .print-relatorio * { visibility: visible !important; }
          .print-relatorio { position: fixed; top: 0; left: 0; right: 0; }
          @page { size: A4 portrait; margin: 12mm 14mm; }
          .print-avoid-break { page-break-inside: avoid; }
        }
      `}</style>
      <div className="print-relatorio" style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", color: NAVY }}>

        {/* Cabeçalho */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
          <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: "50px", width: "auto", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "19px", fontWeight: "900", letterSpacing: "-0.5px", lineHeight: 1 }}>SM CONFECÇÕES</div>
            <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>Av. Santa Cruz, 3088 — Franca/SP</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Emitido em</div>
            <div style={{ fontSize: "11px", fontWeight: "700" }}>{emitDate} {emitTime}</div>
          </div>
        </div>

        {/* Título + período */}
        <div style={{
          background: NAVY, color: "white", borderRadius: "4px",
          padding: "8px 12px", display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "10px",
        }}>
          <span style={{ fontWeight: "900", fontSize: "13px", letterSpacing: "1.2px", textTransform: "uppercase" }}>
            Relatório Financeiro
          </span>
          <span style={{ fontSize: "10px", opacity: 0.85 }}>
            {periodFmt(data.period.from)} → {periodFmt(data.period.to)} · {data.period.days} dias
          </span>
        </div>

        {/* DRE — peça central */}
        <div className="print-avoid-break">
          <SectionTitle>Demonstrativo de Resultado (DRE)</SectionTitle>
          <div style={{
            border: `1px solid #d8dde8`, borderRadius: "4px", padding: "10px 14px", background: NAVY_LIGHT,
          }}>
            <DreLine bold label="(+) Receita Bruta" value={dre.receitaBruta} />
            {dre.receitaAvarias > 0 && (
              <DreLine label="↳ Avarias vendidas" value={dre.receitaAvarias} indent sub="vendas de peças com desconto" />
            )}
            <DreLine label="(-) Custo de Insumos" value={dre.custoInsumos != null ? -dre.custoInsumos : null}
              indent sub="material dos produtos vendidos" />
            <DreLine bold label="Resultado s/ Insumos" value={dre.lucroBruto}
              sub={dre.lucroBruto != null ? `margem ${pct(summary.margemBruta)}` : undefined} />
            <DreLine label="(-) Custo de Costura" value={-dre.custoCostura} indent
              sub={`${data.period.days}d proporcionais ao mês`} />
            <DreLine label="(-) Custo Fixo" value={-dre.custoFixo} indent />
            <DreLine label="(-) Custo Variável" value={-dre.custoVariavel} indent sub="despesas variáveis lançadas no período" />
            {dre.perdasDescarte > 0 && (
              <DreLine label="(-) Perdas por Descarte" value={-dre.perdasDescarte} indent sub="avarias descartadas no período" />
            )}
            {dre.custoInsumoDtf > 0 && (
              <DreLine label="(-) Custo de Insumo DTF" value={-dre.custoInsumoDtf} indent sub="film + tinta, metros produzidos" />
            )}
            <DreLine bold label="Resultado Operacional" value={dre.resultadoOp}
              sub={dre.resultadoOp != null ? `margem op. ${pct(summary.margemOp)}` : undefined} />
          </div>
        </div>

        {/* Receita por Canal */}
        <div className="print-avoid-break">
          <SectionTitle>Receita por Canal</SectionTitle>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: NAVY, color: "white" }}>
                <th style={{ padding: "4px 8px", textAlign: "left",  fontSize: "8px", fontWeight: "700" }}>CANAL</th>
                <th style={{ padding: "4px 8px", textAlign: "right", fontSize: "8px", fontWeight: "700" }}>VALOR</th>
                <th style={{ padding: "4px 8px", textAlign: "right", fontSize: "8px", fontWeight: "700", width: "70px" }}>% DO TOTAL</th>
              </tr>
            </thead>
            <tbody>
              {(["pdv", "whatsapp", "manual", "dtf"] as const).map((ch, i) => {
                const val = data.byChannel[ch] ?? 0
                const share = channelTotal > 0 ? (val / channelTotal) * 100 : 0
                return (
                  <tr key={ch} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                    <td style={{ padding: "5px 8px", fontSize: "10px", fontWeight: "700" }}>{CHANNEL_LABEL[ch]}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontSize: "10px", fontWeight: "600" }}>{fmtR(val)}</td>
                    <td style={{ padding: "5px 8px", textAlign: "right", fontSize: "10px" }}>{share.toFixed(1)}%</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Ranking de Produtos */}
        <div className="print-avoid-break">
          <SectionTitle>Ranking de Produtos {data.productRanking.length > 20 ? "(top 20)" : ""}</SectionTitle>
          {topProducts.length === 0 ? (
            <p style={{ fontSize: "9px", color: "#999", padding: "6px 0" }}>Sem produtos vendidos no período</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: NAVY, color: "white" }}>
                  <th style={{ padding: "4px 6px", textAlign: "left",   fontSize: "8px", fontWeight: "700" }}>#</th>
                  <th style={{ padding: "4px 6px", textAlign: "left",   fontSize: "8px", fontWeight: "700" }}>PRODUTO</th>
                  <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "8px", fontWeight: "700" }}>QTD</th>
                  <th style={{ padding: "4px 6px", textAlign: "right",  fontSize: "8px", fontWeight: "700" }}>RECEITA</th>
                  <th style={{ padding: "4px 6px", textAlign: "right",  fontSize: "8px", fontWeight: "700" }}>CUSTO</th>
                  <th style={{ padding: "4px 6px", textAlign: "right",  fontSize: "8px", fontWeight: "700" }}>LUCRO</th>
                  <th style={{ padding: "4px 6px", textAlign: "right",  fontSize: "8px", fontWeight: "700" }}>MARGEM</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => {
                  const lucro = p.cost !== null ? p.revenue - p.cost : null
                  return (
                    <tr key={p.name} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                      <td style={{ padding: "4px 6px", fontSize: "8.5px", color: "#999" }}>{i + 1}</td>
                      <td style={{ padding: "4px 6px", fontSize: "9px", fontWeight: "600" }}>{p.name}</td>
                      <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px" }}>{p.qty}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", fontSize: "9px", fontWeight: "700" }}>{fmtR(p.revenue)}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", fontSize: "9px", color: "#666" }}>{p.cost !== null ? fmtR(p.cost) : "—"}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", fontSize: "9px", fontWeight: "700" }}>{lucro !== null ? fmtR(lucro) : "—"}</td>
                      <td style={{ padding: "4px 6px", textAlign: "right", fontSize: "9px" }}>{p.margin !== null ? pct(p.margin) : "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Fluxo de Insumos */}
        <div className="print-avoid-break">
          <SectionTitle>Fluxo de Insumos</SectionTitle>
          <div style={{ display: "flex", gap: "10px" }}>
            <div style={{ flex: 1, border: "1px solid #d8dde8", borderRadius: "4px", padding: "8px 10px" }}>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Compras (entradas)</div>
              <div style={{ fontSize: "13px", fontWeight: "800", color: "#059669" }}>{fmtR(data.materialFlow.entradas.total)}</div>
              <div style={{ fontSize: "8px", color: "#999" }}>{data.materialFlow.entradas.count} lote(s)</div>
            </div>
            <div style={{ flex: 1, border: "1px solid #d8dde8", borderRadius: "4px", padding: "8px 10px" }}>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Consumo (saídas)</div>
              <div style={{ fontSize: "13px", fontWeight: "800", color: "#B91C1C" }}>{fmtR(data.materialFlow.saidas.total)}</div>
              <div style={{ fontSize: "8px", color: "#999" }}>{data.materialFlow.saidas.count} bobina(s) esgotada(s)</div>
            </div>
            <div style={{ flex: 1, border: "1px solid #d8dde8", borderRadius: "4px", padding: "8px 10px" }}>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Saldo em Insumos</div>
              <div style={{ fontSize: "13px", fontWeight: "800", color: NAVY }}>{fmtR(stockVal?.rawMaterials.totalCost ?? null)}</div>
              <div style={{ fontSize: "8px", color: "#999" }}>snapshot atual</div>
            </div>
          </div>
        </div>

        {/* Balanço de Estoque */}
        {stockVal && (
          <div className="print-avoid-break">
            <SectionTitle>Balanço de Estoque (snapshot atual)</SectionTitle>
            <div style={{ display: "flex", gap: "10px", marginBottom: "8px" }}>
              <div style={{ flex: 1, border: "1px solid #d8dde8", borderRadius: "4px", padding: "8px 10px" }}>
                <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Capital Total Imobilizado</div>
                <div style={{ fontSize: "13px", fontWeight: "800" }}>{fmtR(stockVal.grandTotalCost)}</div>
              </div>
              <div style={{ flex: 1, border: "1px solid #d8dde8", borderRadius: "4px", padding: "8px 10px" }}>
                <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Capital em Produtos</div>
                <div style={{ fontSize: "13px", fontWeight: "800" }}>{fmtR(stockVal.products.totalCost)}</div>
              </div>
              <div style={{ flex: 1, border: "1px solid #d8dde8", borderRadius: "4px", padding: "8px 10px" }}>
                <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Receita Potencial</div>
                <div style={{ fontSize: "13px", fontWeight: "800", color: "#059669" }}>{fmtR(stockVal.products.totalSale)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Rodapé */}
        <div style={{ borderTop: "1px dashed #ccc", marginTop: "14px", paddingTop: "6px", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "7px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</span>
          <span style={{ fontSize: "7px", color: "#aaa" }}>Relatório Financeiro · {emitDate} {emitTime}</span>
        </div>
      </div>
      <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
    </div>
  )
}

"use client"

import PrintShell from "@/components/print/PrintShell"
import { fmtDateBR } from "@/lib/tz"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

type Entry = {
  key: string
  data: string
  descricao: string
  cliente: string | null
  canal: string
  pecas: string
  valor: number | null
}

function fmtR(v: number | null | undefined): string {
  if (v == null) return "—"
  return `R$ ${Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
}

export default function VendasRelatorioPrintSheet({
  entries, totalReceita, pedidosCount, ticketMedio, periodoLabel, onDone,
}: {
  entries: Entry[]
  totalReceita: number
  pedidosCount: number
  ticketMedio: number
  periodoLabel: string
  onDone: () => void
}) {
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const emitDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const emitTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })

  return (
    <PrintShell wrapperClass="print-vendas-relatorio" pageMargin="12mm 14mm" onDone={onDone}>
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", color: NAVY }}>

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
            Relatório de Vendas
          </span>
          <span style={{ fontSize: "10px", opacity: 0.85 }}>{periodoLabel} · pedidos concluídos</span>
        </div>

        {/* Resumo */}
        <div style={{ display: "flex", gap: "10px", marginBottom: "14px" }}>
          {[
            { label: "Receita", value: fmtR(totalReceita) },
            { label: "Pedidos concluídos", value: String(pedidosCount) },
            { label: "Ticket médio", value: pedidosCount > 0 ? fmtR(ticketMedio) : "—" },
          ].map(s => (
            <div key={s.label} style={{ flex: 1, border: "1px solid #d8dde8", borderRadius: "4px", padding: "8px 10px" }}>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>{s.label}</div>
              <div style={{ fontSize: "13px", fontWeight: "800" }}>{s.value}</div>
            </div>
          ))}
        </div>

        {/* Entradas detalhadas */}
        <div className="print-avoid-break">
          <div style={{
            background: NAVY, color: "white", borderRadius: "4px",
            padding: "6px 12px", marginBottom: "8px",
          }}>
            <span style={{ fontWeight: "800", fontSize: "11px", letterSpacing: "1px", textTransform: "uppercase" }}>
              Vendas no Período ({entries.length})
            </span>
          </div>
          {entries.length === 0 ? (
            <p style={{ fontSize: "9px", color: "#999", padding: "6px 0" }}>Nenhuma venda concluída no período</p>
          ) : (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ background: NAVY, color: "white" }}>
                  <th style={{ padding: "4px 8px", textAlign: "left",   fontSize: "8px", fontWeight: "700" }}>DATA</th>
                  <th style={{ padding: "4px 8px", textAlign: "left",   fontSize: "8px", fontWeight: "700" }}>PEDIDO / PRODUTO</th>
                  <th style={{ padding: "4px 8px", textAlign: "left",   fontSize: "8px", fontWeight: "700" }}>CLIENTE</th>
                  <th style={{ padding: "4px 8px", textAlign: "center", fontSize: "8px", fontWeight: "700" }}>CANAL</th>
                  <th style={{ padding: "4px 8px", textAlign: "center", fontSize: "8px", fontWeight: "700" }}>PEÇAS</th>
                  <th style={{ padding: "4px 8px", textAlign: "right",  fontSize: "8px", fontWeight: "700" }}>VALOR</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e, i) => (
                  <tr key={e.key} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                    <td style={{ padding: "4px 8px", fontSize: "9px" }}>{fmtDateBR(e.data)}</td>
                    <td style={{ padding: "4px 8px", fontSize: "9px", fontWeight: "600" }}>{e.descricao}</td>
                    <td style={{ padding: "4px 8px", fontSize: "9px" }}>{e.cliente || "—"}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center", fontSize: "9px" }}>{e.canal}</td>
                    <td style={{ padding: "4px 8px", textAlign: "center", fontSize: "9px" }}>{e.pecas}</td>
                    <td style={{ padding: "4px 8px", textAlign: "right", fontSize: "9px", fontWeight: "700" }}>{fmtR(e.valor)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Rodapé */}
        <div style={{ borderTop: "1px dashed #ccc", marginTop: "14px", paddingTop: "6px", display: "flex", justifyContent: "space-between" }}>
          <span style={{ fontSize: "7px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</span>
          <span style={{ fontSize: "7px", color: "#aaa" }}>Relatório de Vendas · {emitDate} {emitTime}</span>
        </div>
      </div>
    </PrintShell>
  )
}

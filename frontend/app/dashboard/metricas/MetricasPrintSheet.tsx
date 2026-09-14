"use client"

import PrintShell from "@/components/print/PrintShell"
import DocLetterhead from "@/components/print/DocLetterhead"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

// `priority` aceita o tipo completo de 3 valores da tela (urgent/monitor/parado)
// pra bater com o tipo já existente em page.tsx — na prática só chega
// urgent/monitor aqui, o filtro de quem vira item de produção já acontece antes.
type Priority = "urgent" | "monitor" | "parado"
type PrintRow = { color: string; size: string; priority: Priority; qty: number }
type PrintGroup = { productName: string; rows: PrintRow[] }

const PRIORITY_LABEL: Record<Priority, string> = { urgent: "Urgente", monitor: "Monitorar", parado: "Parado" }
const PRIORITY_COLOR: Record<Priority, string> = { urgent: "#DC2626", monitor: "#D97706", parado: "#8B96AD" }

// Ficha de Métricas e Produção — PrintShell + DocLetterhead + tabela navy
// padrão, igual o resto do sistema (Ficha de Separação, Ficha de Pedido).
// Antes disso essa tela usava `print:hidden`/`hidden print:block` por conta
// própria, sem escapar do layout do dashboard — window.print() saía com a
// sidebar e o menu inteiro, porque só o conteúdo da página tinha essas
// classes, não o layout ao redor. PrintShell escapa disso via portal +
// visibility:hidden no body inteiro, mesmo padrão já corrigido nas outras telas.
export default function MetricasPrintSheet({
  segLabel, segDaysLabel, dateLabel,
  stats, groups, totals, onDone,
}: {
  segLabel: string; segDaysLabel: string; dateLabel: string
  stats: { urgent: number; monitor: number; parado: number; totalProd: number }
  groups: PrintGroup[]; totals: { items: number; pieces: number }
  onDone: () => void
}) {
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })

  return (
    <PrintShell wrapperClass="print-a4" onDone={onDone}>
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", padding: "14mm 16mm", color: NAVY }}>

        <DocLetterhead via="Produção" />

        <div style={{
          background: NAVY, color: "white", borderRadius: "4px",
          padding: "5px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "7px",
        }}>
          <span style={{ fontWeight: "800", fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase" }}>
            Ficha de Métricas e Produção
          </span>
          <span style={{ fontSize: "8px", opacity: 0.75 }}>Impressão: {printDate} {printTime}</span>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          border: "1px solid #d8dde8", borderRadius: "4px", overflow: "hidden",
          marginBottom: "7px",
        }}>
          {([
            ["Semana", `${segLabel} · ${segDaysLabel}`],
            ["Data", dateLabel],
            ["Produção sugerida", `${totals.pieces} pç`],
          ] as [string, string][]).map(([label, val], i) => (
            <div key={i} style={{
              padding: "5px 8px",
              borderRight: i < 2 ? "1px solid #d8dde8" : "none",
              background: i % 2 === 0 ? NAVY_LIGHT : "white",
            }}>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
              <div style={{ fontSize: "10.5px", fontWeight: "700", color: NAVY, marginTop: "2px" }}>{val}</div>
            </div>
          ))}
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginBottom: "9px",
        }}>
          {([
            ["Urgente", stats.urgent, "#DC2626"],
            ["Monitorar", stats.monitor, "#D97706"],
            ["Parado", stats.parado, "#8B96AD"],
          ] as [string, number, string][]).map(([label, val, color]) => (
            <div key={label} style={{ border: "1px solid #d8dde8", borderRadius: "4px", padding: "5px 8px", textAlign: "center" }}>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
              <div style={{ fontSize: "14px", fontWeight: "900", color, marginTop: "1px" }}>{val}</div>
            </div>
          ))}
        </div>

        {groups.length === 0 ? (
          <p style={{ fontSize: "10px", color: "#888", textAlign: "center", padding: "20px 0" }}>
            Nada urgente ou pra monitorar agora — nenhuma peça sugerida pra produção.
          </p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "7px" }}>
            <thead>
              <tr style={{ background: NAVY, color: "white" }}>
                <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "20px", fontWeight: "700", letterSpacing: "0.5px" }}>#</th>
                <th style={{ padding: "4px 6px", textAlign: "left",   fontSize: "7px", fontWeight: "700", letterSpacing: "0.5px" }}>PRODUTO</th>
                <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "58px", fontWeight: "700", letterSpacing: "0.5px" }}>COR</th>
                <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "32px", fontWeight: "700", letterSpacing: "0.5px" }}>TAM</th>
                <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "52px", fontWeight: "700", letterSpacing: "0.5px" }}>PRIORIDADE</th>
                <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "28px", fontWeight: "700", letterSpacing: "0.5px" }}>QTD</th>
                <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "22px", fontWeight: "700" }}>✓</th>
              </tr>
            </thead>
            <tbody>
              {groups.map((g, gi) => (
                g.rows.map((r, i) => (
                  <tr key={`${gi}-${i}`} className="print-avoid-break" style={{ background: (gi + i) % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                    <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "8px", color: "#888" }}>{i === 0 ? gi + 1 : ""}</td>
                    <td style={{ padding: "4px 6px", fontSize: "9px", fontWeight: "600", color: NAVY }}>{i === 0 ? g.productName : ""}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px", color: "#444" }}>{r.color || "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px", fontWeight: "700", color: NAVY }}>{r.size || "—"}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "8px", fontWeight: "800", textTransform: "uppercase", color: PRIORITY_COLOR[r.priority] }}>
                      {PRIORITY_LABEL[r.priority]}
                    </td>
                    <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "12px", fontWeight: "900", color: NAVY }}>{r.qty}</td>
                    <td style={{ padding: "4px 6px", textAlign: "center" }}>
                      <div style={{ width: "13px", height: "13px", border: "1.5px solid #aaa", borderRadius: "2px", margin: "0 auto" }} />
                    </td>
                  </tr>
                ))
              ))}
            </tbody>
            <tfoot>
              <tr style={{ background: NAVY, color: "white" }}>
                <td colSpan={5} style={{ padding: "5px 6px", fontSize: "8px", fontWeight: "700", letterSpacing: "0.5px" }}>
                  TOTAL · {totals.items} {totals.items === 1 ? "item" : "itens"}
                </td>
                <td style={{ padding: "5px 6px", textAlign: "center", fontSize: "13px", fontWeight: "900" }}>{totals.pieces}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "10px" }}>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Produzido por</div>
            </div>
          </div>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Data: ___/___/______</div>
            </div>
          </div>
        </div>

        <div style={{
          marginTop: "10px", paddingTop: "6px", borderTop: "1px dashed #ccc",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</span>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>Métricas Produção × Vendas · {printDate}</span>
        </div>
      </div>
    </PrintShell>
  )
}

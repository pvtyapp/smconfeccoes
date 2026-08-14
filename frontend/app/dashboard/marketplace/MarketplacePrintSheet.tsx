"use client"

import PrintShell from "@/components/print/PrintShell"
import DocLetterhead from "@/components/print/DocLetterhead"
import { fmtDateBR } from "@/lib/tz"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

type ResultItem = { productName: string; color: string; size: string; sku: string; qty: number }
type Result = { number: string; totalItems: number; totalPieces: number; items: ResultItem[] }

const ORIGIN_LABEL: Record<string, string> = { shopee: "Shopee", mercado_livre: "Mercado Livre", manual: "Manual" }

// Mesma "Ficha de Separação" que o resto do sistema já usa (Autoatendimento) —
// PrintShell + DocLetterhead + tabela navy padrão. Sem cliente/valor porque
// separação de marketplace só desconta estoque, não é venda nem pedido.
export default function MarketplacePrintSheet({ result, origin, onDone }: { result: Result; origin: string; onDone: () => void }) {
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })

  return (
    <PrintShell wrapperClass="print-a4" onDone={onDone}>
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", padding: "14mm 16mm", color: NAVY }}>

        <DocLetterhead />

        <div style={{
          background: NAVY, color: "white", borderRadius: "4px",
          padding: "5px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "7px",
        }}>
          <span style={{ fontWeight: "800", fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase" }}>
            Ficha de Separação
          </span>
          <span style={{ fontSize: "8px", opacity: 0.75 }}>Impressão: {printDate} {printTime}</span>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          border: `1px solid #d8dde8`, borderRadius: "4px", overflow: "hidden",
          marginBottom: "7px",
        }}>
          {([
            ["Separação", result.number],
            ["Origem", ORIGIN_LABEL[origin] ?? origin],
            ["Data", fmtDateBR(now.toISOString())],
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

        <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: "7px" }}>
          <thead>
            <tr style={{ background: NAVY, color: "white" }}>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "20px", fontWeight: "700", letterSpacing: "0.5px" }}>#</th>
              <th style={{ padding: "4px 6px", textAlign: "left",   fontSize: "7px", fontWeight: "700", letterSpacing: "0.5px" }}>PRODUTO</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "58px", fontWeight: "700", letterSpacing: "0.5px" }}>COR</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "32px", fontWeight: "700", letterSpacing: "0.5px" }}>TAM</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "28px", fontWeight: "700", letterSpacing: "0.5px" }}>QTD</th>
              <th style={{ padding: "4px 6px", textAlign: "center", fontSize: "7px", width: "22px", fontWeight: "700" }}>✓</th>
            </tr>
          </thead>
          <tbody>
            {result.items.map((item, i) => (
              <tr key={i} className="print-avoid-break" style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "8px", color: "#888" }}>{i + 1}</td>
                <td style={{ padding: "4px 6px", fontSize: "9px", fontWeight: "600", color: NAVY }}>{item.productName}</td>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px", color: "#444" }}>{item.color || "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "9px", fontWeight: "700", color: NAVY }}>{item.size || "—"}</td>
                <td style={{ padding: "4px 6px", textAlign: "center", fontSize: "12px", fontWeight: "900", color: NAVY }}>{item.qty}</td>
                <td style={{ padding: "4px 6px", textAlign: "center" }}>
                  <div style={{ width: "13px", height: "13px", border: "1.5px solid #aaa", borderRadius: "2px", margin: "0 auto" }} />
                </td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr style={{ background: NAVY, color: "white" }}>
              <td colSpan={4} style={{ padding: "5px 6px", fontSize: "8px", fontWeight: "700", letterSpacing: "0.5px" }}>
                TOTAL · {result.totalItems} itens
              </td>
              <td style={{ padding: "5px 6px", textAlign: "center", fontSize: "13px", fontWeight: "900" }}>{result.totalPieces}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "10px" }}>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Conferido por</div>
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
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>{result.number} · {printDate}</span>
        </div>
      </div>
    </PrintShell>
  )
}

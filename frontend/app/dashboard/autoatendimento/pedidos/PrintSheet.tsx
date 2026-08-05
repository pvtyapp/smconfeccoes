"use client"

import type { Order, OrderItem } from "./page"
import TwoViaPrintSheet from "./TwoViaPrintSheet"
import PrintShell from "@/components/print/PrintShell"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

// "format" (papel: A4 vs térmica) e "vias" (quantas cópias) são independentes —
// Ficha de Separação é sempre 1 via (uso interno da loja), Ordem do Pedido é
// sempre 2 (loja + cliente, tipo cupom fiscal), em qualquer formato de papel.
export default function PrintSheet({ order, items, format, title = "Ficha de Separação", vias = 1, onDone }: {
  order: Order; items: OrderItem[]; format: "a4" | "thermal"; title?: string; vias?: 1 | 2; onDone: () => void
}) {
  const totalQty = items.reduce((s, i) => s + (Number(i.qty) || 0), 0)
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
  const orderDate = new Date(order.createdAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const valor = order.totalValue
    ? `R$ ${Number(order.totalValue).toFixed(2).replace(".", ",")}`
    : "—"

  if (format === "thermal") {
    return (
      <div className="hidden print:block fixed inset-0 bg-white z-[100]">
        <style>{`
          @media print {
            body * { visibility: hidden; }
            .print-label, .print-label * { visibility: visible !important; }
            .print-label { position: fixed; top: 0; left: 0; width: 100mm; height: 150mm; overflow: hidden; box-sizing: border-box; }
            @page { size: 100mm 150mm; margin: 0; }
          }
        `}</style>
        <div className="print-label" style={{
          width: "100mm", height: "150mm", padding: "5mm 6mm",
          fontFamily: "'Arial', sans-serif", color: NAVY,
          display: "flex", flexDirection: "column", boxSizing: "border-box",
        }}>
          {/* Cabeçalho */}
          <div style={{ display: "flex", alignItems: "center", gap: "6px", marginBottom: "3mm" }}>
            <img src="/smsemfundo.png" alt="SM" style={{ height: "28px", width: "auto", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "13px", fontWeight: "900", letterSpacing: "-0.3px", lineHeight: 1 }}>SM CONFECÇÕES</div>
              <div style={{ fontSize: "7px", color: "#666", marginTop: "2px" }}>Av. Santa Cruz, 3088 — Franca/SP</div>
            </div>
          </div>

          {/* Barra título */}
          <div style={{
            background: NAVY, color: "white", borderRadius: "3px",
            padding: "3px 7px", display: "flex", justifyContent: "space-between",
            alignItems: "center", marginBottom: "3mm",
          }}>
            <span style={{ fontWeight: "800", fontSize: "9px", letterSpacing: "0.8px" }}>{title.toUpperCase()}</span>
            <span style={{ fontSize: "7px", opacity: 0.75 }}>{printDate} {printTime}</span>
          </div>

          {/* Pedido + Cliente */}
          <div style={{
            border: `1px solid #d8dde8`, borderRadius: "3px",
            padding: "4px 7px", marginBottom: "3mm", background: NAVY_LIGHT,
          }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: "3px" }}>
              <span style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.6px" }}>Pedido</span>
              <span style={{ fontSize: "12px", fontWeight: "900", color: NAVY }}>{order.number}</span>
            </div>
            <div style={{ borderTop: "1px solid #d0d5e0", paddingTop: "4px" }}>
              <div style={{ fontSize: "12px", fontWeight: "800", color: NAVY }}>{order.contactName}</div>
              <div style={{ fontSize: "9px", color: "#555", marginTop: "1px" }}>{order.contactPhone}</div>
            </div>
            {order.notes && (
              <div style={{ borderTop: "1px solid #d0d5e0", marginTop: "4px", paddingTop: "3px" }}>
                <span style={{ fontSize: "7px", color: "#888" }}>Obs: </span>
                <span style={{ fontSize: "8px", color: "#444" }}>{order.notes}</span>
              </div>
            )}
          </div>

          {/* Itens */}
          <div style={{ flex: 1, overflow: "hidden", marginBottom: "3mm" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: "9px" }}>
              <thead>
                <tr style={{ background: NAVY, color: "white" }}>
                  <th style={{ padding: "3px 5px", textAlign: "left", fontSize: "7px", fontWeight: "700" }}>PRODUTO / COR / TAM</th>
                  <th style={{ padding: "3px 5px", textAlign: "center", fontSize: "7px", fontWeight: "700", width: "24px" }}>QTD</th>
                  <th style={{ padding: "3px 5px", textAlign: "center", fontSize: "7px", fontWeight: "700", width: "18px" }}>✓</th>
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e8eaf0" }}>
                    <td style={{ padding: "3px 5px", fontWeight: "600", fontSize: "9px" }}>
                      {item.productName}
                      {item.color ? <span style={{ fontWeight: "400", color: "#555" }}> · {item.color}</span> : null}
                      {item.size  ? <span style={{ fontWeight: "700", color: NAVY }}> {item.size}</span> : null}
                    </td>
                    <td style={{ padding: "3px 5px", textAlign: "center", fontWeight: "900", fontSize: "11px" }}>{item.qty}</td>
                    <td style={{ padding: "3px 5px", textAlign: "center" }}>
                      <div style={{ width: "11px", height: "11px", border: "1.5px solid #aaa", borderRadius: "2px", margin: "0 auto" }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Rodapé: total + valor + assinatura */}
          <div style={{
            border: `1px solid #d8dde8`, borderRadius: "3px",
            padding: "4px 7px", marginBottom: "3mm",
            display: "flex", justifyContent: "space-between", alignItems: "center",
            background: NAVY_LIGHT,
          }}>
            <div>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Total</div>
              <div style={{ fontSize: "13px", fontWeight: "900", color: NAVY }}>{totalQty} un</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "7px", color: "#888", textTransform: "uppercase", letterSpacing: "0.5px" }}>Valor</div>
              <div style={{ fontSize: "13px", fontWeight: "900", color: NAVY }}>{valor}</div>
            </div>
          </div>

          <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
            <div style={{ fontSize: "7px", color: "#666" }}>Assinatura do cliente</div>
          </div>
        </div>
        <button onClick={onDone} className="print:hidden mt-2 text-xs text-gray-400">fechar</button>
      </div>
    )
  }

  function renderFicha(via: "LOJA" | "CLIENTE") {
    return (
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", padding: "14mm 16mm", color: NAVY }}>

        {/* ── Cabeçalho ── */}
        <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "5px" }}>
          <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: "58px", width: "auto", flexShrink: 0 }} />
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: "20px", fontWeight: "900", letterSpacing: "-0.5px", lineHeight: 1, color: NAVY }}>
              SM CONFECÇÕES
            </div>
            <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>
              Av. Santa Cruz, 3088 — Franca / SP
            </div>
          </div>
          <div style={{
            border: `1.5px solid ${NAVY}`, borderRadius: "4px",
            padding: "3px 10px", textAlign: "center", flexShrink: 0,
          }}>
            <div style={{ fontSize: "6.5px", letterSpacing: "1.5px", color: NAVY, opacity: 0.6, textTransform: "uppercase" }}>via</div>
            <div style={{ fontSize: "9px", fontWeight: "800", letterSpacing: "1px", color: NAVY, textTransform: "uppercase" }}>{via}</div>
          </div>
        </div>

        {/* ── Barra título ── */}
        <div style={{
          background: NAVY, color: "white", borderRadius: "4px",
          padding: "5px 10px", display: "flex", justifyContent: "space-between",
          alignItems: "center", marginBottom: "7px",
        }}>
          <span style={{ fontWeight: "800", fontSize: "10px", letterSpacing: "1.2px", textTransform: "uppercase" }}>
            {title}
          </span>
          <span style={{ fontSize: "8px", opacity: 0.75 }}>Impressão: {printDate} {printTime}</span>
        </div>

        {/* ── Info do pedido ── */}
        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          border: `1px solid #d8dde8`, borderRadius: "4px", overflow: "hidden",
          marginBottom: "7px",
        }}>
          {([
            ["Pedido", order.number],
            ["Data do pedido", orderDate],
            ["Hora de impressão", printTime],
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

        {/* ── Dados do cliente ── */}
        <div style={{
          border: `1px solid #d8dde8`, borderRadius: "4px",
          padding: "6px 8px", marginBottom: "7px", background: NAVY_LIGHT,
        }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Cliente</div>
              <div style={{ fontSize: "15px", fontWeight: "800", color: NAVY, marginTop: "1px" }}>
                {order.contactName}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Telefone</div>
              <div style={{ fontSize: "10px", fontWeight: "600", color: NAVY, marginTop: "1px" }}>{order.contactPhone}</div>
            </div>
          </div>
          {order.notes && (
            <div style={{ borderTop: "1px solid #ccd0da", marginTop: "5px", paddingTop: "4px" }}>
              <span style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>Obs: </span>
              <span style={{ fontSize: "8.5px", color: "#444" }}>{order.notes}</span>
            </div>
          )}
        </div>

        {/* ── Tabela de itens ── */}
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
            {items.map((item, i) => (
              <tr key={i} style={{ background: i % 2 === 0 ? "white" : NAVY_LIGHT, borderBottom: "1px solid #e0e4ec" }}>
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
              <td colSpan={4} style={{ padding: "5px 6px", fontSize: "8px", fontWeight: "700", letterSpacing: "0.5px" }}>TOTAL GERAL</td>
              <td style={{ padding: "5px 6px", textAlign: "center", fontSize: "13px", fontWeight: "900" }}>{totalQty}</td>
              <td />
            </tr>
          </tfoot>
        </table>

        {/* ── Valor ── */}
        <div style={{
          display: "flex", justifyContent: "space-between", alignItems: "center",
          border: `1px solid #d8dde8`, borderRadius: "4px",
          padding: "5px 10px", marginBottom: "10px", background: NAVY_LIGHT,
        }}>
          <span style={{ fontSize: "8px", color: "#666", textTransform: "uppercase", letterSpacing: "0.8px" }}>Valor total do pedido</span>
          <span style={{ fontSize: "15px", fontWeight: "900", color: NAVY }}>{valor}</span>
        </div>

        {/* ── Assinaturas ── */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "4px" }}>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Atendente</div>
            </div>
          </div>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Data de retirada: ___/___/______</div>
            </div>
          </div>
        </div>
        <div style={{ marginTop: "14px" }}>
          <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
            <div style={{ fontSize: "7px", color: "#666" }}>Assinatura do cliente</div>
          </div>
        </div>

        {/* ── Rodapé ── */}
        <div style={{
          marginTop: "10px", paddingTop: "6px", borderTop: "1px dashed #ccc",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>SM Confecções · Av. Santa Cruz, 3088 · Franca/SP</span>
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>{order.number} · {printDate}</span>
        </div>
      </div>
    )
  }

  if (vias === 1) {
    return (
      <PrintShell wrapperClass="print-a4" onDone={onDone}>
        {renderFicha("LOJA")}
      </PrintShell>
    )
  }

  return <TwoViaPrintSheet wrapperClass="print-a4" renderVia={renderFicha} onDone={onDone} />
}

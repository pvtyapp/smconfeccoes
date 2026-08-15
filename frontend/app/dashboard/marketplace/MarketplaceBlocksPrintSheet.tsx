"use client"

import PrintShell from "@/components/print/PrintShell"
import DocLetterhead from "@/components/print/DocLetterhead"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

type FlatGroup = { isKit: boolean; cor: string; tamanho: string; qty: number; anuncios: number }
type SourceSummary = { pedidos: number | null; totalItens: number | null } | null

// Lista de referência pra separar fisicamente — não é ligada a nenhum
// registro no banco (essa leitura não desconta estoque). Por isso o título é
// "Lista de Separação", não "Ficha de Separação" (essa última é reservada
// pra depois que a baixa real foi lançada, ver MarketplacePrintSheet).
//
// Não agrupa por anúncio/produto: o que importa pra puxar do estoque em
// branco é cor + tamanho + quantidade, não qual estampa vai em cima.
export default function MarketplaceBlocksPrintSheet({ groups, sourceSummary, filename, onDone }: {
  groups: FlatGroup[]; sourceSummary: SourceSummary; filename: string; onDone: () => void
}) {
  const tz = "America/Sao_Paulo"
  const now = new Date()
  const printDate = now.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })
  const printTime = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: tz })
  const totalPecas = groups.reduce((s, g) => s + g.qty, 0)
  const kits = groups.filter(g => g.isKit)
  const avulsos = groups.filter(g => !g.isKit)

  function renderSection(label: string, items: FlatGroup[]) {
    if (items.length === 0) return null
    return (
      <div className="print-avoid-break" style={{ marginBottom: "8px" }}>
        <div style={{ padding: "3px 6px", background: NAVY, borderRadius: "3px 3px 0 0" }}>
          <span style={{ fontSize: "8.5px", fontWeight: "800", color: "white", letterSpacing: "0.5px", textTransform: "uppercase" }}>{label}</span>
        </div>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {items.map((g, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #e8eaf0", background: i % 2 === 0 ? "white" : NAVY_LIGHT }}>
                <td style={{ padding: "4px 6px", fontSize: "8.5px", color: "#444", width: "22px" }}>
                  <div style={{ width: "11px", height: "11px", border: "1.3px solid #aaa", borderRadius: "2px" }} />
                </td>
                <td style={{ padding: "4px 6px", fontSize: "10px", fontWeight: "600", color: NAVY }}>{g.cor || "—"}</td>
                <td style={{ padding: "4px 6px", fontSize: "10px", fontWeight: "700", color: NAVY, width: "50px", textAlign: "center" }}>{g.tamanho || "—"}</td>
                <td style={{ padding: "4px 6px", fontSize: "12px", fontWeight: "900", color: NAVY, width: "36px", textAlign: "center" }}>{g.qty}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

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
            Lista de Separação
          </span>
          <span style={{ fontSize: "8px", opacity: 0.75 }}>Impressão: {printDate} {printTime}</span>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 1fr 1fr",
          border: `1px solid #d8dde8`, borderRadius: "4px", overflow: "hidden",
          marginBottom: "10px",
        }}>
          {([
            ["Arquivo", filename || "—"],
            ["Pedidos (arquivo)", sourceSummary?.pedidos != null ? String(sourceSummary.pedidos) : "—"],
            ["Total de peças", String(totalPecas)],
          ] as [string, string][]).map(([label, val], i) => (
            <div key={i} style={{
              padding: "5px 8px",
              borderRight: i < 2 ? "1px solid #d8dde8" : "none",
              background: i % 2 === 0 ? NAVY_LIGHT : "white",
            }}>
              <div style={{ fontSize: "6.5px", color: "#888", textTransform: "uppercase", letterSpacing: "0.8px" }}>{label}</div>
              <div style={{ fontSize: "10.5px", fontWeight: "700", color: NAVY, marginTop: "2px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{val}</div>
            </div>
          ))}
        </div>

        {renderSection("Kits", kits)}
        {renderSection("Peças avulsas", avulsos)}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px", marginTop: "10px" }}>
          <div>
            <div style={{ borderTop: `1px solid ${NAVY}`, paddingTop: "3px" }}>
              <div style={{ fontSize: "7px", color: "#666" }}>Separado por</div>
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
          <span style={{ fontSize: "6.5px", color: "#aaa" }}>Lista de referência · não lançada no estoque · {printDate}</span>
        </div>
      </div>
    </PrintShell>
  )
}

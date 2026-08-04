"use client"

import PrintShell from "@/components/print/PrintShell"

const NAVY = "#0F1E3C"
const NAVY_LIGHT = "#f0f2f7"

const thStyle: React.CSSProperties = {
  border: "1px solid rgba(15,30,60,.35)", background: NAVY_LIGHT, height: "6mm",
  fontSize: "7.5px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.3px",
  color: "rgba(15,30,60,.6)", padding: "0 2mm",
}
const cellStyle: React.CSSProperties = {
  border: "1px solid rgba(15,30,60,.35)", height: "7mm", fontSize: "9px", padding: "0 2mm",
}
const blankCellStyle: React.CSSProperties = { ...cellStyle, background: "#FFFBEB" }
const sigLineStyle: React.CSSProperties = { borderBottom: "1px solid rgba(15,30,60,.4)", height: "5mm", marginBottom: "0.8mm" }
const sigCapStyle: React.CSSProperties = { fontSize: "7px", color: "rgba(15,30,60,.4)" }

export type RevisaoFichaData = {
  number: string
  productName: string
  totalPecas: number
  grade: { color: string; size: string; qty: number }[]
}

export default function RevisaoPrintSheet({ ordem, onDone }: { ordem: RevisaoFichaData; onDone: () => void }) {
  const tz = "America/Sao_Paulo"
  const printDate = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: tz })

  const colorMap = new Map<string, { size: string; qty: number }[]>()
  for (const g of ordem.grade) {
    if (!colorMap.has(g.color)) colorMap.set(g.color, [])
    colorMap.get(g.color)!.push({ size: g.size, qty: g.qty })
  }
  const colorGroups = [...colorMap.entries()]

  return (
    <PrintShell wrapperClass="print-ficha-revisao" onDone={onDone}>
      <div style={{ fontFamily: "'Arial', 'Helvetica', sans-serif", color: NAVY, padding: "10mm" }}>
        {/* Letterhead — mesmo padrão das outras fichas impressas */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          paddingBottom: "4mm", marginBottom: "6mm", borderBottom: `1.6px solid ${NAVY}`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: "46px", width: "auto", flexShrink: 0 }} />
            <div>
              <div style={{ fontSize: "16px", fontWeight: 900, letterSpacing: "-0.5px", lineHeight: 1, color: NAVY }}>SM CONFECÇÕES</div>
              <div style={{ fontSize: "8px", color: "#666", marginTop: "3px" }}>Ficha de Revisão · uso interno</div>
            </div>
          </div>
          <div style={{ textAlign: "right", fontSize: "8px", color: "#888" }}>
            Impresso em {printDate}
          </div>
        </div>

        {/* Cabeçalho do pedido */}
        <div style={{
          border: `1.4px solid ${NAVY}`, borderRadius: "3px", padding: "3mm 4mm", marginBottom: "5mm",
          display: "flex", justifyContent: "space-between", alignItems: "baseline",
        }}>
          <div>
            <div style={{ fontSize: "13px", fontWeight: 800 }}>{ordem.number}</div>
            <div style={{ fontSize: "10px", color: "rgba(15,30,60,.6)" }}>{ordem.productName}</div>
          </div>
          <div style={{ fontSize: "10px", fontWeight: 700, color: "rgba(15,30,60,.6)" }}>{ordem.totalPecas} peças produzidas</div>
        </div>

        {/* Tabela por cor — tamanho/quantidade real, Aprovadas/Avarias em branco pra preencher à mão */}
        {colorGroups.map(([color, rows], i) => (
          <div key={color} className="print-avoid-break" style={{ marginBottom: "4mm" }}>
            <div style={{ fontSize: "9px", fontWeight: 800, textTransform: "uppercase", letterSpacing: "0.3px", marginBottom: "1.5mm" }}>{color}</div>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={{ ...thStyle, textAlign: "left" }}>Tamanho</th>
                  <th style={{ ...thStyle, textAlign: "center" }}>Produzidas</th>
                  <th style={{ ...thStyle, textAlign: "center", color: "#059669" }}>Aprovadas</th>
                  <th style={{ ...thStyle, textAlign: "center", color: "#B45309" }}>Avarias</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.size}>
                    <td style={{ ...cellStyle, fontWeight: 700 }}>{r.size}</td>
                    <td style={{ ...cellStyle, textAlign: "center", fontWeight: 700 }}>{r.qty}</td>
                    <td style={blankCellStyle} />
                    <td style={blankCellStyle} />
                  </tr>
                ))}
              </tbody>
            </table>
            {i === colorGroups.length - 1 && (
              <div style={{ display: "flex", gap: "4mm", marginTop: "5mm" }}>
                <div style={{ flex: 1 }}><div style={sigLineStyle} /><span style={sigCapStyle}>Conferido por</span></div>
                <div style={{ flex: 1 }}><div style={sigLineStyle} /><span style={sigCapStyle}>Data</span></div>
              </div>
            )}
          </div>
        ))}
      </div>
    </PrintShell>
  )
}

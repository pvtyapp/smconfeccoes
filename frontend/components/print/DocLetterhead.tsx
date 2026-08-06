"use client"

const NAVY = "#0F1E3C"

// Cabeçalho único de todos os documentos A4 (fichas, ordem de pedido,
// relatórios) — antes cada tela desenhava o próprio, e a via de Produto e a
// via de DTF acabaram com selos "via" diferentes (caixa navy vs pílula roxa)
// sem ninguém ter decidido isso de propósito. Fonte única de verdade agora.
export default function DocLetterhead({ via, logoSize = 52 }: { via?: string; logoSize?: number }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: "12px",
      paddingBottom: "8px", marginBottom: "10px", borderBottom: `1.5px solid ${NAVY}`,
    }}>
      <img src="/smsemfundo.png" alt="SM Confecções" style={{ height: `${logoSize}px`, width: "auto", flexShrink: 0 }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: "20px", fontWeight: "900", letterSpacing: "-0.5px", lineHeight: 1, color: NAVY }}>
          SM CONFECÇÕES
        </div>
        <div style={{ fontSize: "8px", color: "#666", marginTop: "3px", letterSpacing: "0.02em" }}>
          Av. Santa Cruz, 3088 — Franca / SP
        </div>
      </div>
      {via && (
        <div style={{
          background: NAVY, color: "white", borderRadius: "4px",
          padding: "4px 12px", textAlign: "center", flexShrink: 0,
        }}>
          <div style={{ fontSize: "6.5px", letterSpacing: "1.5px", opacity: 0.65, textTransform: "uppercase" }}>via</div>
          <div style={{ fontSize: "10px", fontWeight: "800", letterSpacing: "1px", textTransform: "uppercase" }}>{via}</div>
        </div>
      )}
    </div>
  )
}

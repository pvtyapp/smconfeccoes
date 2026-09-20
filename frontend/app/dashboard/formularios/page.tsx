"use client"

import { useEffect, useState, useCallback } from "react"
import { RefreshCw, Check, X, Clock, MessageCircle } from "lucide-react"

type Solicitacao = {
  id: number
  name: string
  phone: string
  businessName: string | null
  purchaseNotes: string | null
  status: "pendente" | "aprovado" | "recusado"
  reviewedBy: string | null
  reviewedAt: string | null
  createdAt: string
}

const STATUS_CFG: Record<string, { label: string; cls: string }> = {
  pendente: { label: "Pendente", cls: "bg-amber-100 text-amber-700" },
  aprovado: { label: "Aprovado", cls: "bg-green-100 text-green-700" },
  recusado: { label: "Recusado", cls: "bg-red-100 text-red-600" },
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })
}
function fmtPhone(phone: string) {
  const p = phone.replace(/\D/g, "")
  if (p.length === 13) return `+${p.slice(0, 2)} (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`
  return phone
}

export default function FormulariosPage() {
  const [items, setItems] = useState<Solicitacao[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<"pendente" | "aprovado" | "recusado" | "all">("pendente")
  const [busyId, setBusyId] = useState<number | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/formularios")
      setItems(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function approve(id: number) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/formularios/${id}/approve`, { method: "POST" })
      if (res.ok) await load()
    } finally { setBusyId(null) }
  }

  async function reject(id: number) {
    setBusyId(id)
    try {
      const res = await fetch(`/api/formularios/${id}/reject`, { method: "POST" })
      if (res.ok) await load()
    } finally { setBusyId(null) }
  }

  const filtered = filter === "all" ? items : items.filter((i) => i.status === filter)
  const pendingCount = items.filter((i) => i.status === "pendente").length

  return (
    <div className="p-6 space-y-5 max-w-4xl">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-[#0F1E3C]">Formulários</h1>
          <p className="text-sm text-[#0F1E3C]/40 mt-0.5">Pedidos de acesso como Fornecedor Fixo</p>
        </div>
        <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors">
          <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium bg-white w-fit">
        {[
          { key: "pendente", label: `Pendentes${pendingCount > 0 ? ` (${pendingCount})` : ""}` },
          { key: "aprovado", label: "Aprovados" },
          { key: "recusado", label: "Recusados" },
          { key: "all", label: "Todos" },
        ].map(({ key, label }) => (
          <button key={key} onClick={() => setFilter(key as typeof filter)}
            className={`px-3.5 py-2 transition-colors ${filter === key ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="space-y-2.5">
        {loading ? (
          <p className="text-sm text-[#0F1E3C]/30 text-center py-16">Carregando...</p>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-[#0F1E3C]/25">
            <Clock size={26} strokeWidth={1.3} />
            <p className="text-sm">Nenhuma solicitação {filter !== "all" ? STATUS_CFG[filter]?.label.toLowerCase() : ""} no momento.</p>
          </div>
        ) : (
          filtered.map((s) => {
            const cfg = STATUS_CFG[s.status]
            return (
              <div key={s.id} className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-[#0F1E3C] text-sm">{s.name}</p>
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${cfg.cls}`}>{cfg.label}</span>
                  </div>
                  <p className="text-xs text-[#0F1E3C]/45 mt-1 flex items-center gap-1.5">
                    <MessageCircle size={11} /> {fmtPhone(s.phone)}
                    {s.businessName && <span>· {s.businessName}</span>}
                  </p>
                  {s.purchaseNotes && <p className="text-xs text-[#0F1E3C]/50 mt-1.5">{s.purchaseNotes}</p>}
                  <p className="text-[10px] text-[#0F1E3C]/30 mt-1.5">
                    Enviado em {fmtDate(s.createdAt)}
                    {s.reviewedAt && ` · revisado por ${s.reviewedBy} em ${fmtDate(s.reviewedAt)}`}
                  </p>
                </div>

                {s.status === "pendente" && (
                  <div className="flex items-center gap-2 flex-shrink-0">
                    <button onClick={() => reject(s.id)} disabled={busyId === s.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-[#0F1E3C]/12 text-xs font-bold text-[#0F1E3C]/60 hover:bg-[#0F1E3C]/5 transition-colors disabled:opacity-50">
                      <X size={13} /> Recusar
                    </button>
                    <button onClick={() => approve(s.id)} disabled={busyId === s.id}
                      className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#1B8F63] hover:bg-[#167a54] text-white text-xs font-bold transition-colors disabled:opacity-50">
                      <Check size={13} /> {busyId === s.id ? "Aprovando..." : "Aprovar"}
                    </button>
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}

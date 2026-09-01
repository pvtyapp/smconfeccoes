"use client"

import { useEffect, useState, useCallback } from "react"
import {
  RefreshCw, Search, FileText, Download, Send, AlertTriangle,
  FileDown, Loader2,
} from "lucide-react"
import { todayBR, subDaysBR, fmtDateBR } from "@/lib/tz"

type Nota = {
  id: number
  status: "pendente" | "processando" | "autorizada" | "rejeitada"
  numero: string | null
  serie: string | null
  chaveAcesso: string | null
  motivoRejeicao: string | null
  valorTotal: number | null
  ambiente: "homologacao" | "producao"
  criadoEm: string
  autorizadoEm: string | null
  enviadoEmailEm: string | null
  enviadoWhatsappEm: string | null
  orderNumbers: string
  contactName: string
}

const STATUS_LABEL: Record<string, string> = {
  pendente: "Pendente", processando: "Processando", autorizada: "Autorizada", rejeitada: "Rejeitada",
}
const STATUS_COLOR: Record<string, string> = {
  pendente:    "bg-gray-100 text-gray-500",
  processando: "bg-blue-100 text-blue-700",
  autorizada:  "bg-emerald-100 text-emerald-700",
  rejeitada:   "bg-red-100 text-red-600",
}

export default function NotasFiscaisPage() {
  const [notas, setNotas]     = useState<Nota[]>([])
  const [loading, setLoading] = useState(true)
  const [status, setStatus]   = useState("")
  const [from, setFrom]       = useState(subDaysBR(30))
  const [to, setTo]           = useState(todayBR())
  const [search, setSearch]   = useState("")
  const [resending, setResending] = useState<number | null>(null)
  const [downloadingLote, setDownloadingLote] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (status) params.set("status", status)
      if (from)   params.set("from", from)
      if (to)     params.set("to", to)
      if (search) params.set("search", search)
      const r = await fetch(`/api/fiscal/notas?${params}`)
      if (r.ok) setNotas(await r.json())
    } finally { setLoading(false) }
  }, [status, from, to, search])

  useEffect(() => { load() }, [load])

  async function reenviar(id: number) {
    setResending(id)
    try {
      const r = await fetch(`/api/fiscal/notas/${id}/reenviar`, { method: "POST" })
      if (!r.ok) { const d = await r.json(); alert(d.error ?? "Erro ao reenviar") }
      else await load()
    } finally { setResending(null) }
  }

  async function baixarLote() {
    setDownloadingLote(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set("from", from)
      if (to)   params.set("to", to)
      const r = await fetch(`/api/fiscal/notas/download-lote?${params}`)
      if (!r.ok) { const d = await r.json(); alert(d.error ?? "Erro ao baixar"); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = `notas-fiscais-${from}-a-${to}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } finally { setDownloadingLote(false) }
  }

  const totalAutorizadas = notas.filter(n => n.status === "autorizada").length
  const valorTotal = notas.filter(n => n.status === "autorizada").reduce((s, n) => s + (n.valorTotal ?? 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Notas Fiscais
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">{totalAutorizadas} autorizada{totalAutorizadas !== 1 ? "s" : ""} no período · R$ {valorTotal.toFixed(2).replace(".", ",")}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={baixarLote} disabled={downloadingLote}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/70 hover:bg-[#0F1E3C]/6 transition-colors disabled:opacity-50">
            {downloadingLote ? <Loader2 size={14} className="animate-spin" /> : <FileDown size={14} />}
            Baixar período (ZIP)
          </button>
          <button onClick={load} className="p-2 rounded-xl border border-[#0F1E3C]/8 text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
            <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
          </button>
        </div>
      </div>

      {/* Filtros */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-4 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Cliente ou nº do pedido..."
            className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
        </div>
        <input type="date" value={from} onChange={e => setFrom(e.target.value)}
          className="border border-[#0F1E3C]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
        <span className="text-[#0F1E3C]/30 text-sm">até</span>
        <input type="date" value={to} onChange={e => setTo(e.target.value)}
          className="border border-[#0F1E3C]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-[#0F1E3C]/10 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20">
          <option value="">Todos os status</option>
          {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>
      </div>

      {/* Tabela */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16">
            <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
          </div>
        ) : notas.length === 0 ? (
          <p className="text-center text-sm text-[#0F1E3C]/40 py-16">Nenhuma nota fiscal encontrada nesse filtro.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/6">
                <th className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Pedido</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Cliente</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Nº / Série</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Status</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Valor</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Emitida em</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/5">
              {notas.map(n => (
                <tr key={n.id} className="hover:bg-[#F4F6FB]/50">
                  <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{n.orderNumbers}</td>
                  <td className="px-4 py-3 text-[#0F1E3C]/70">{n.contactName}</td>
                  <td className="px-4 py-3 text-[#0F1E3C]/70">{n.numero ? `${n.numero} / ${n.serie}` : "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${STATUS_COLOR[n.status]}`}>
                      {STATUS_LABEL[n.status]}
                      {n.ambiente === "homologacao" && " (teste)"}
                    </span>
                    {n.status === "rejeitada" && n.motivoRejeicao && (
                      <div className="flex items-start gap-1 mt-1 max-w-xs">
                        <AlertTriangle size={10} className="text-red-400 flex-shrink-0 mt-0.5" />
                        <p className="text-[10px] text-red-500 leading-tight">{n.motivoRejeicao}</p>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-[#0F1E3C]">
                    {n.valorTotal != null ? `R$ ${n.valorTotal.toFixed(2).replace(".", ",")}` : "—"}
                  </td>
                  <td className="px-4 py-3 text-[#0F1E3C]/50 text-xs">{fmtDateBR(n.autorizadoEm ?? n.criadoEm)}</td>
                  <td className="px-4 py-3">
                    {n.status === "autorizada" && (
                      <div className="flex items-center justify-end gap-1.5">
                        <a href={`/api/fiscal/notas/${n.id}/download?type=xml`} title="Baixar XML"
                          className="p-1.5 rounded-lg text-[#0F1E3C]/40 hover:text-[#4361EE] hover:bg-[#4361EE]/8 transition-colors">
                          <FileText size={14} />
                        </a>
                        <a href={`/api/fiscal/notas/${n.id}/download?type=pdf`} title="Baixar PDF"
                          className="p-1.5 rounded-lg text-[#0F1E3C]/40 hover:text-[#4361EE] hover:bg-[#4361EE]/8 transition-colors">
                          <Download size={14} />
                        </a>
                        <button onClick={() => reenviar(n.id)} disabled={resending === n.id} title="Reenviar por WhatsApp"
                          className="p-1.5 rounded-lg text-[#0F1E3C]/40 hover:text-emerald-600 hover:bg-emerald-50 transition-colors disabled:opacity-50">
                          {resending === n.id ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}

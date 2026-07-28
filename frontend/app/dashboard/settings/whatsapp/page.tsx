"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import Link from "next/link"
import { ArrowLeft, RefreshCw, QrCode, Plus, Trash2, X, Loader2 } from "lucide-react"

const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 transition-colors"

type Principal = { instanceName: string; state: string | null; connected: boolean }
type CommercialInstance = { id: number; instanceName: string; label: string; active: boolean; state: string }

function StatusPill({ connected }: { connected: boolean }) {
  return (
    <span className={`flex items-center gap-1.5 text-[11px] font-bold px-2.5 py-1 rounded-full ${
      connected ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"
    }`}>
      <span className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-emerald-400 animate-pulse" : "bg-red-400"}`} />
      {connected ? "Conectado" : "Desconectado"}
    </span>
  )
}

function QrModal({ instanceName, initialBase64, onClose, onConnected }: {
  instanceName: string
  initialBase64: string | null
  onClose: () => void
  onConnected: () => void
}) {
  const [base64, setBase64] = useState<string | null>(initialBase64)
  const [loading, setLoading] = useState(!initialBase64)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const poll = useCallback(async () => {
    try {
      const r = await fetch(`/api/whatsapp/qrcode?instanceName=${encodeURIComponent(instanceName)}`)
      if (!r.ok) return
      const d = await r.json() as { base64: string | null; connected: boolean }
      if (d.connected) {
        if (pollRef.current) clearInterval(pollRef.current)
        onConnected()
        return
      }
      if (d.base64) setBase64(d.base64)
      setLoading(false)
    } catch { /* tenta de novo no próximo ciclo */ }
  }, [instanceName, onConnected])

  useEffect(() => {
    if (!initialBase64) poll()
    pollRef.current = setInterval(poll, 4_000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [poll, initialBase64])

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm overflow-hidden pointer-events-auto">
          <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
            <p className="text-sm font-bold text-[#0F1E3C]">Escaneie com o WhatsApp</p>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
          </div>
          <div className="p-6 flex flex-col items-center gap-3">
            {loading ? (
              <div className="w-56 h-56 flex items-center justify-center">
                <Loader2 size={24} className="animate-spin text-[#4361EE]" />
              </div>
            ) : base64 ? (
              <img src={base64} alt="QR Code" className="w-56 h-56 rounded-xl border border-[#0F1E3C]/8" />
            ) : (
              <p className="text-xs text-[#0F1E3C]/40 text-center py-12">Não foi possível carregar o QR agora. Feche e tente de novo.</p>
            )}
            <p className="text-[11px] text-[#0F1E3C]/40 text-center leading-relaxed">
              WhatsApp → Aparelhos conectados → Conectar um aparelho.<br />
              Atualiza sozinho a cada poucos segundos.
            </p>
          </div>
        </div>
      </div>
    </>
  )
}

export default function WhatsAppSettingsPage() {
  const [principal, setPrincipal] = useState<Principal | null>(null)
  const [instances, setInstances] = useState<CommercialInstance[]>([])
  const [loading, setLoading] = useState(true)
  const [qrTarget, setQrTarget] = useState<{ instanceName: string; base64: string | null } | null>(null)
  const [startingPrincipal, setStartingPrincipal] = useState(false)

  const [showAddForm, setShowAddForm] = useState(false)
  const [newLabel, setNewLabel] = useState("")
  const [newInstanceName, setNewInstanceName] = useState("")
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const [pRes, iRes] = await Promise.all([
      fetch("/api/whatsapp/principal"),
      fetch("/api/marketing/instances"),
    ])
    if (pRes.ok) setPrincipal(await pRes.json())
    if (iRes.ok) setInstances(await iRes.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function connectPrincipal() {
    if (!principal) return
    setStartingPrincipal(true)
    try {
      const r = await fetch("/api/whatsapp/principal", { method: "POST" })
      const d = await r.json() as { qrcodeBase64: string | null }
      setQrTarget({ instanceName: principal.instanceName, base64: d.qrcodeBase64 ?? null })
    } finally {
      setStartingPrincipal(false)
    }
  }

  async function toggleActive(id: number, active: boolean) {
    setInstances(prev => prev.map(i => i.id === id ? { ...i, active } : i))
    await fetch(`/api/marketing/instances/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active }),
    })
  }

  async function removeInstance(id: number) {
    if (!confirm("Remover esse número do cadastro? Não desconecta o WhatsApp, só para de usar aqui.")) return
    await fetch(`/api/marketing/instances/${id}`, { method: "DELETE" })
    load()
  }

  async function createInstance() {
    if (!newLabel.trim() || !newInstanceName.trim()) {
      setCreateError("Nome e identificador são obrigatórios")
      return
    }
    setCreating(true)
    setCreateError(null)
    try {
      const r = await fetch("/api/marketing/instances", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: newLabel.trim(), instanceName: newInstanceName.trim() }),
      })
      const d = await r.json()
      if (!r.ok) {
        setCreateError(d.error ?? "Erro ao criar instância")
        return
      }
      setShowAddForm(false)
      setNewLabel(""); setNewInstanceName("")
      setQrTarget({ instanceName: newInstanceName.trim(), base64: d.qrcodeBase64 ?? null })
      load()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/dashboard/settings" className="flex items-center gap-1.5 text-[11px] font-semibold text-[#0F1E3C]/40 hover:text-[#0F1E3C] mb-2">
            <ArrowLeft size={12} /> Configurações
          </Link>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>WhatsApp</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Número principal e instâncias comerciais</p>
        </div>
        <button onClick={load} className="p-2 rounded-xl border border-[#0F1E3C]/8 text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-6 h-6 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="space-y-6">

          {/* Principal */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-bold text-[#0F1E3C]">WhatsApp Principal</h2>
            <p className="text-[11px] text-[#0F1E3C]/40 -mt-2">Atende o chatbot, cobrança e lifecycle. Não dá pra trocar por aqui — só conectar/reconectar se cair.</p>
            {principal ? (
              <div className="flex items-center justify-between bg-[#F4F6FB] rounded-xl px-4 py-3">
                <div>
                  <p className="text-xs font-mono text-[#0F1E3C]/70">{principal.instanceName}</p>
                  <div className="mt-1"><StatusPill connected={principal.connected} /></div>
                </div>
                {!principal.connected && (
                  <button
                    onClick={connectPrincipal}
                    disabled={startingPrincipal}
                    className="flex items-center gap-1.5 bg-[#4361EE] hover:bg-[#3451D4] text-white text-xs font-bold px-3 py-2 rounded-xl transition-colors disabled:opacity-50"
                  >
                    {startingPrincipal ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
                    {startingPrincipal ? "Iniciando..." : "Conectar / Reconectar"}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-red-600">Não foi possível consultar o número principal.</p>
            )}
          </section>

          {/* Instâncias Comerciais */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-bold text-[#0F1E3C]">Instâncias Comerciais</h2>
                <p className="text-[11px] text-[#0F1E3C]/40 mt-0.5">Números extras pra dividir o disparo de campanha e reduzir risco de bloqueio. Gerenciado só aqui — a aba Marketing só mostra o status.</p>
              </div>
              <button
                onClick={() => setShowAddForm(v => !v)}
                className="flex items-center gap-1.5 text-xs font-bold text-[#4361EE] hover:underline flex-shrink-0"
              >
                <Plus size={13} /> Adicionar
              </button>
            </div>

            {showAddForm && (
              <div className="bg-[#F4F6FB] rounded-xl p-4 space-y-3">
                <div>
                  <label className="text-[10px] font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1 block">Nome (exibição)</label>
                  <input className={inputCls} value={newLabel} onChange={e => setNewLabel(e.target.value)} placeholder="Ex: Comercial 2" />
                </div>
                <div>
                  <label className="text-[10px] font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1 block">Identificador da instância</label>
                  <input className={inputCls} value={newInstanceName} onChange={e => setNewInstanceName(e.target.value)} placeholder="Ex: comercial-2" />
                  <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Só letras, números e hífen — vira o nome da instância na Evolution.</p>
                </div>
                {createError && <p className="text-[11px] text-red-600">{createError}</p>}
                <div className="flex gap-2">
                  <button onClick={createInstance} disabled={creating}
                    className="flex items-center gap-1.5 bg-[#4361EE] hover:bg-[#3451D4] text-white text-xs font-bold px-4 py-2 rounded-xl transition-colors disabled:opacity-50">
                    {creating ? <Loader2 size={13} className="animate-spin" /> : <QrCode size={13} />}
                    {creating ? "Criando..." : "Criar e mostrar QR"}
                  </button>
                  <button onClick={() => setShowAddForm(false)} className="text-xs font-semibold text-[#0F1E3C]/40 px-3 py-2">Cancelar</button>
                </div>
              </div>
            )}

            {instances.length === 0 ? (
              <p className="text-xs text-[#0F1E3C]/40">Nenhuma instância comercial cadastrada ainda.</p>
            ) : (
              <div className="divide-y divide-[#0F1E3C]/6">
                {instances.map(inst => (
                  <div key={inst.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[#0F1E3C] truncate">{inst.label}</p>
                      <p className="text-[10px] font-mono text-[#0F1E3C]/40 truncate">{inst.instanceName}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <StatusPill connected={inst.state === "connected"} />
                      {inst.state !== "connected" && (
                        <button
                          onClick={() => setQrTarget({ instanceName: inst.instanceName, base64: null })}
                          className="p-2 rounded-lg border border-[#0F1E3C]/10 text-[#4361EE] hover:bg-[#4361EE]/5"
                          title="Ver QR"
                        >
                          <QrCode size={13} />
                        </button>
                      )}
                      <button
                        onClick={() => toggleActive(inst.id, !inst.active)}
                        className={`text-[10px] font-bold px-2.5 py-1.5 rounded-lg transition-colors ${
                          inst.active ? "bg-emerald-50 text-emerald-700" : "bg-[#F4F6FB] text-[#0F1E3C]/40"
                        }`}
                        title={inst.active ? "No rodízio — clique pra pausar" : "Pausado — clique pra ativar"}
                      >
                        {inst.active ? "Ativo" : "Pausado"}
                      </button>
                      <button onClick={() => removeInstance(inst.id)} className="p-2 rounded-lg text-red-400 hover:bg-red-50" title="Remover">
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {qrTarget && (
        <QrModal
          instanceName={qrTarget.instanceName}
          initialBase64={qrTarget.base64}
          onClose={() => setQrTarget(null)}
          onConnected={() => { setQrTarget(null); load() }}
        />
      )}
    </div>
  )
}

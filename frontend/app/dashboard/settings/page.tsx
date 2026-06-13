"use client"

import { useState, useEffect, useCallback } from "react"
import { Save, RefreshCw } from "lucide-react"

const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 transition-colors"

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch("/api/settings")
    if (r.ok) setSettings(await r.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function set(key: string, value: string) {
    setSettings(s => ({ ...s, [key]: value }))
    setSaved(false)
  }

  async function save() {
    setSaving(true)
    const r = await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    })
    if (r.ok) setSaved(true)
    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Configurações
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Dados do sistema, pagamento e DTF</p>
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

          {/* Dados da empresa */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Dados da Empresa</h2>
            <div>
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Nome da empresa</label>
              <input className={inputCls} value={settings.nome_empresa ?? ""} onChange={e => set("nome_empresa", e.target.value)} placeholder="SM Confecções" />
            </div>
            <div>
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Endereço de retirada</label>
              <input className={inputCls} value={settings.endereco_retirada ?? ""} onChange={e => set("endereco_retirada", e.target.value)} placeholder="Av. Santa Cruz, 3088" />
              <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Enviado ao cliente nas notificações de pedido pronto.</p>
            </div>
          </section>

          {/* Pagamento */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Pagamento</h2>
            <div>
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Chave Pix</label>
              <input className={inputCls} value={settings.pix_key ?? ""} onChange={e => set("pix_key", e.target.value)} placeholder="CPF, e-mail, telefone ou chave aleatória" />
              <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Enviada ao cliente ao concluir um pedido à vista.</p>
            </div>
          </section>

          {/* DTF */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-3">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Impressão DTF</h2>
            <div className="flex items-start gap-3 bg-[#F4F6FB] rounded-xl px-4 py-3">
              <div className="flex-1">
                <p className="text-xs font-semibold text-[#0F1E3C]/70">Preço por metro</p>
                <p className="text-[11px] text-[#0F1E3C]/40 mt-0.5">
                  Gerenciado no cadastro de produtos — produto <strong>DTF</strong>. O preço é calculado automaticamente ao lançar pedidos.
                </p>
              </div>
              <a href="/dashboard/produtos" className="flex-shrink-0 text-[10px] font-bold text-[#4361EE] hover:underline mt-0.5">
                Ir para Produtos →
              </a>
            </div>
          </section>

          {/* Save */}
          <div className="flex items-center gap-3">
            <button onClick={save} disabled={saving}
              className="flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white text-sm font-bold px-5 py-2.5 rounded-xl transition-colors disabled:opacity-50">
              <Save size={14} />
              {saving ? "Salvando..." : "Salvar configurações"}
            </button>
            {saved && <p className="text-xs text-emerald-600 font-semibold">✓ Salvo com sucesso</p>}
          </div>
        </div>
      )}
    </div>
  )
}

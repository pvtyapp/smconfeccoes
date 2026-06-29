"use client"

import { useState, useEffect, useCallback } from "react"
import { Save, RefreshCw, HardDrive, Printer } from "lucide-react"

const inputCls = "w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 transition-colors"

type BlobUsage = {
  totalMB: string
  folders: Array<{ folder: string; count: number; sizeBytes: number }>
  db: { blob_count: string; base64_count: string; missing_count: string }
}

export default function SettingsPage() {
  const [settings, setSettings] = useState<Record<string, string>>({})
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)
  const [blobUsage, setBlobUsage] = useState<BlobUsage | null>(null)
  const [loadingBlob, setLoadingBlob] = useState(false)

  // PDV print prefs (localStorage only, per device)
  const [pdvPrintFormat, setPdvPrintFormat] = useState<"A4" | "termica">("A4")
  const [pdvPrintName,   setPdvPrintName]   = useState("")

  useEffect(() => {
    try {
      const fmt = localStorage.getItem("pdv_print_format")
      if (fmt === "A4" || fmt === "termica") setPdvPrintFormat(fmt)
      const name = localStorage.getItem("pdv_print_name")
      if (name) setPdvPrintName(name)
    } catch { /* ignora */ }
  }, [])

  function savePdvPrint(fmt: "A4" | "termica", name: string) {
    try {
      localStorage.setItem("pdv_print_format", fmt)
      localStorage.setItem("pdv_print_name", name)
    } catch { /* ignora */ }
  }

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch("/api/settings")
    if (r.ok) setSettings(await r.json())
    setLoading(false)
  }, [])

  async function loadBlobUsage() {
    setLoadingBlob(true)
    const r = await fetch("/api/debug/blob-usage")
    if (r.ok) setBlobUsage(await r.json())
    setLoadingBlob(false)
  }

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

          {/* Status do Sistema */}
          {(() => {
            const chatbotOn = settings.chatbot_ativo !== "false"
            const autoOn    = settings.pedidos_auto  !== "false"
            const raw       = settings.debug_last_webhook
            let webhookAge: number | null = null
            let webhookEvent = "—"
            if (raw) {
              try {
                const p = JSON.parse(raw)
                if (p.ts) webhookAge = Math.round((Date.now() - new Date(p.ts).getTime()) / 60_000)
                if (p.event) webhookEvent = p.event
              } catch { /* raw string */ }
            }
            const webhookOk  = webhookAge !== null && webhookAge < 240
            const webhookWarn = webhookAge !== null && webhookAge >= 240 && webhookAge < 1440
            const webhookBad  = webhookAge === null || webhookAge >= 1440

            function pill(label: string, sub: string, color: "green" | "blue" | "amber" | "red" | "gray") {
              const map = {
                green: "bg-emerald-50 border-emerald-200 text-emerald-700",
                blue:  "bg-blue-50 border-blue-200 text-blue-700",
                amber: "bg-amber-50 border-amber-200 text-amber-700",
                red:   "bg-red-50 border-red-200 text-red-700",
                gray:  "bg-[#F4F6FB] border-[#0F1E3C]/10 text-[#0F1E3C]/40",
              }
              const dot = { green: "bg-emerald-400", blue: "bg-blue-400", amber: "bg-amber-400", red: "bg-red-400", gray: "bg-[#0F1E3C]/20" }
              return (
                <div className={`flex items-center gap-2 border rounded-xl px-3 py-2.5 ${map[color]}`}>
                  <span className={`w-2 h-2 rounded-full shrink-0 ${dot[color]} ${color === "green" ? "animate-pulse" : ""}`} />
                  <div>
                    <p className="text-[11px] font-bold leading-tight">{label}</p>
                    <p className="text-[10px] opacity-70 leading-tight">{sub}</p>
                  </div>
                </div>
              )
            }

            const webhookSub = webhookAge === null
              ? "nunca recebido"
              : webhookAge < 1
              ? `${webhookEvent} · < 1 min atrás`
              : `${webhookEvent} · ${webhookAge} min atrás`

            return (
              <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-3">
                <h2 className="text-sm font-bold text-[#0F1E3C]">Status do Sistema</h2>
                <div className="grid grid-cols-3 gap-2">
                  {pill("Chatbot", chatbotOn ? "respondendo" : "mudo", chatbotOn ? "green" : "gray")}
                  {pill("Auto pedidos", autoOn ? "detectando" : "desligado", autoOn ? "blue" : "gray")}
                  {pill(
                    "Webhook",
                    webhookSub,
                    webhookOk ? "green" : webhookWarn ? "amber" : "red"
                  )}
                </div>
                {webhookBad && (
                  <p className="text-[10px] text-red-600 leading-relaxed">
                    ⚠ Webhook nunca recebido ou há mais de 24h. Mensagens em tempo real podem não estar chegando. Verifique a URL do Webhook no painel do Evolution.
                  </p>
                )}
                {webhookWarn && (
                  <p className="text-[10px] text-amber-600 leading-relaxed">
                    ⚠ Último evento há {webhookAge} min. Normal se não houve mensagens recentes. Se esperava atividade, verifique o Evolution.
                  </p>
                )}
              </section>
            )
          })()}

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

          {/* Notificações */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Notificações</h2>
            <div>
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">WhatsApp do operador (JID)</label>
              <input className={inputCls} value={settings.operador_jid ?? ""} onChange={e => set("operador_jid", e.target.value)} placeholder="5516999999999@s.whatsapp.net" />
              <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Recebe alerta quando cliente pede ajuste no pedido. Formato: DDDnumero@s.whatsapp.net</p>
            </div>
          </section>

          {/* DTF */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
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
            <div>
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2 block">Quantidade de impressoras</label>
              <div className="flex gap-2">
                {["1", "2", "3", "4"].map(n => (
                  <button
                    key={n}
                    onClick={() => set("dtf_num_impressoras", n)}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                      (settings.dtf_num_impressoras ?? "1") === n
                        ? "bg-[#7C3AED] text-white border-[#7C3AED]"
                        : "bg-[#F4F6FB] text-[#0F1E3C]/50 border-transparent hover:text-[#0F1E3C]"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>
              <p className="text-[10px] text-[#0F1E3C]/30 mt-1.5">
                Com mais de 1 impressora, o operador seleciona qual está produzindo cada pedido. Os metros são somados por impressora no relatório.
              </p>
            </div>
          </section>

          {/* Armazenamento */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#0F1E3C] flex items-center gap-2">
                <HardDrive size={14} className="text-[#4361EE]" />
                Armazenamento de Mídia
              </h2>
              <button onClick={loadBlobUsage} disabled={loadingBlob}
                className="text-[11px] font-semibold text-[#4361EE] hover:underline disabled:opacity-50">
                {loadingBlob ? "Carregando..." : blobUsage ? "Atualizar" : "Ver uso"}
              </button>
            </div>
            {blobUsage ? (
              <div className="space-y-3">
                <p className="text-2xl font-black text-[#0F1E3C]">{blobUsage.totalMB} <span className="text-sm font-medium text-[#0F1E3C]/40">MB usado</span></p>
                <div className="divide-y divide-[#0F1E3C]/6">
                  {blobUsage.folders.map(f => (
                    <div key={f.folder} className="flex items-center justify-between py-1.5">
                      <span className="text-xs text-[#0F1E3C]/60 font-mono">{f.folder}</span>
                      <span className="text-xs text-[#0F1E3C]/80">
                        {f.count} arquivo{f.count !== 1 ? "s" : ""} · {(f.sizeBytes / 1024 / 1024).toFixed(1)} MB
                      </span>
                    </div>
                  ))}
                </div>
                <div className="bg-[#F4F6FB] rounded-xl px-4 py-2 text-[11px] text-[#0F1E3C]/50 flex gap-4">
                  <span>Blobs no DB: {blobUsage.db.blob_count}</span>
                  <span>Base64 inline: {blobUsage.db.base64_count}</span>
                  <span>Sem URL: {blobUsage.db.missing_count}</span>
                </div>
              </div>
            ) : (
              <p className="text-xs text-[#0F1E3C]/40">Clique em &quot;Ver uso&quot; para consultar o armazenamento.</p>
            )}
          </section>

          {/* Diagnóstico WhatsApp */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-[#0F1E3C]">Diagnóstico WhatsApp</h2>
            {(() => {
              const raw = settings.debug_last_webhook
              if (!raw) return (
                <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
                  <span className="w-2 h-2 rounded-full bg-red-400 shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-red-700">Nenhum webhook recebido ainda</p>
                    <p className="text-[11px] text-red-600 mt-0.5">O Evolution não está enviando eventos para este servidor. Configure o Webhook URL no painel do Evolution.</p>
                  </div>
                </div>
              )
              let parsed: { event?: string; ts?: string; preview?: string } = {}
              try { parsed = JSON.parse(raw) } catch { /* raw não é JSON */ }
              const ts = parsed.ts ? new Date(parsed.ts) : null
              const age = ts ? Math.round((Date.now() - ts.getTime()) / 60_000) : null
              const isOk = age !== null && age < 240
              return (
                <div className={`flex items-start gap-3 border rounded-xl px-4 py-3 ${isOk ? "bg-emerald-50 border-emerald-200" : "bg-amber-50 border-amber-200"}`}>
                  <span className={`w-2 h-2 rounded-full mt-1 shrink-0 ${isOk ? "bg-emerald-400" : "bg-amber-400"}`} />
                  <div className="min-w-0 flex-1">
                    <p className={`text-xs font-bold ${isOk ? "text-emerald-700" : "text-amber-700"}`}>
                      Último webhook: {parsed.event ?? "—"}
                    </p>
                    <p className={`text-[11px] mt-0.5 ${isOk ? "text-emerald-600" : "text-amber-600"}`}>
                      {ts ? ts.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}
                      {age !== null ? ` (${age < 1 ? "< 1 min atrás" : `${age} min atrás`})` : ""}
                    </p>
                    {!isOk && age !== null && age >= 240 && (
                      <p className="text-[10px] text-amber-500 mt-1">
                        ⚠ Último evento há {age} min. Se mensagens não estão chegando, verifique o Webhook no Evolution.
                      </p>
                    )}
                  </div>
                </div>
              )
            })()}
            <p className="text-[10px] text-[#0F1E3C]/35 leading-relaxed">
              URL do Webhook: <code className="bg-[#F4F6FB] px-1.5 py-0.5 rounded font-mono text-[10px]">{typeof window !== "undefined" ? window.location.origin : ""}/api/whatsapp/webhook</code>
            </p>
          </section>

          {/* Impressão PDV */}
          <section className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-6 space-y-4">
            <h2 className="text-sm font-bold text-[#0F1E3C] flex items-center gap-2">
              <Printer size={14} className="text-[#4361EE]" />
              Impressão PDV
            </h2>
            <div>
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2 block">Formato do comprovante</label>
              <div className="flex gap-2">
                {(["A4", "termica"] as const).map(fmt => (
                  <button
                    key={fmt}
                    onClick={() => { setPdvPrintFormat(fmt); savePdvPrint(fmt, pdvPrintName) }}
                    className={`flex-1 py-2.5 rounded-xl text-xs font-bold border transition-all ${
                      pdvPrintFormat === fmt
                        ? "bg-[#4361EE] text-white border-[#4361EE]"
                        : "bg-[#F4F6FB] text-[#0F1E3C]/50 border-transparent hover:text-[#0F1E3C]"
                    }`}
                  >
                    {fmt === "A4" ? "A4 (padrão)" : "Térmica 80mm"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Nome da impressora (informativo)</label>
              <input
                className={inputCls}
                value={pdvPrintName}
                onChange={e => { setPdvPrintName(e.target.value); savePdvPrint(pdvPrintFormat, e.target.value) }}
                placeholder="Ex: HP LaserJet Pro"
              />
              <p className="text-[10px] text-[#0F1E3C]/30 mt-1.5 leading-relaxed">
                Configure a impressora padrão no Windows (Configurações → Bluetooth e dispositivos → Impressoras). O navegador usará a impressora definida como padrão no sistema.
              </p>
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

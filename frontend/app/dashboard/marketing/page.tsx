"use client"

import {
  useState, useEffect, useCallback, useRef,
} from "react"
import {
  Megaphone, Calendar, Plus, Trash2, Send, Image, X,
  Clock, Users, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle, AlertCircle, Loader2, ToggleLeft, ToggleRight,
  CalendarClock, Layers, Save, SlidersHorizontal, Check, Pencil,
} from "lucide-react"

// ─── Types ────────────────────────────────────────────────────────────────────

type Stats = { total: number; byState: Array<{ state: string; total: string }> }

type Group = { jid: string; name: string }

type Campaign = {
  id: number
  title: string
  content: string
  mediaUrl: string | null
  audienceType: string
  audienceLifecycle: string | null
  audienceGroupJids: string[]
  scheduledAt: string | null
  status: string
  sentCount: number
  errorCount: number
  totalCount: number
  executedAt: string | null
  createdAt: string
  contentVariants: string[] | null
  pauseReason: string | null
  pausedUntil: string | null
}

type Schedule = {
  id: number
  name: string
  daysOfWeek: number[]
  timeOfDay: string
  audienceType: string
  audienceLifecycle: string | null
  audienceGroupJids: string[]
  active: boolean
  lastExecutedAt: string | null
  itemCount: number
  createdAt: string
  firstItemMediaUrl?: string | null
}

type ScheduleItem = {
  id: number
  content: string
  mediaUrl: string | null
  lastSentAt: string | null
  sentCount: number
  createdAt: string
}

type ScheduleExecution = {
  id: number
  itemId: number | null
  content: string | null
  mediaUrl: string | null
  sentCount: number
  errorCount: number
  executedAt: string
}

type LifecycleTaskItem = {
  contact_id: number
  name: string | null
  phone: string | null
  stage: string
  due_at: string
  overdue: boolean
}

type LifecycleCompletedItem = {
  id: number
  stage: string
  sentAt: string
  status: string
  contactName: string | null
  phone: string | null
}

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"]

const LIFECYCLE_OPTS = [
  { value: "all",     label: "Todos os clientes" },
  { value: "active",  label: "Ativos" },
  { value: "ausente", label: "Ausentes" },
  { value: "new",     label: "Novos" },
]

const STATE_META: Record<string, { label: string; color: string; bg: string }> = {
  new:     { label: "Novos",    color: "text-blue-700",    bg: "bg-blue-50 border-blue-200"    },
  active:  { label: "Ativos",   color: "text-emerald-700", bg: "bg-emerald-50 border-emerald-200" },
  ausente: { label: "Ausentes", color: "text-amber-700",   bg: "bg-amber-50 border-amber-200"  },
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  scheduled:  { label: "Agendado",   cls: "bg-amber-100 text-amber-700" },
  generating: { label: "Preparando", cls: "bg-purple-100 text-purple-700" },
  sending:    { label: "Enviando",   cls: "bg-blue-100 text-blue-700"   },
  sent:      { label: "Enviado",   cls: "bg-emerald-100 text-emerald-700" },
  failed:    { label: "Falhou",    cls: "bg-red-100 text-red-700"     },
  cancelled: { label: "Cancelado", cls: "bg-slate-100 text-slate-500" },
}

const TZ_BR = "America/Sao_Paulo"

function fmtBR(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit", month: "2-digit", year: "2-digit",
    hour: "2-digit", minute: "2-digit", timeZone: TZ_BR,
  })
}

function fmtTime(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ_BR })
}

// ─── Image Upload ─────────────────────────────────────────────────────────────

function ImageUpload({
  value, onChange, label = "Foto (opcional)",
}: {
  value: string | null
  onChange: (url: string | null) => void
  label?: string
}) {
  const [uploading, setUploading] = useState(false)
  const ref = useRef<HTMLInputElement>(null)

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append("file", file)
      const r = await fetch("/api/marketing/upload", { method: "POST", body: fd })
      if (r.ok) {
        const { url } = await r.json()
        onChange(url)
      }
    } finally {
      setUploading(false)
      if (ref.current) ref.current.value = ""
    }
  }

  return (
    <div>
      <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">{label}</label>
      {value ? (
        <div className="flex items-start gap-3 p-3 bg-emerald-50 border border-emerald-200 rounded-xl">
          <a href={value} target="_blank" rel="noreferrer" className="shrink-0 group relative">
            <img src={value} alt="preview" className="h-20 w-20 rounded-lg object-cover border border-emerald-200 group-hover:opacity-80 transition-opacity" />
            <span className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity text-[9px] font-bold text-white bg-black/40 rounded-lg">VER</span>
          </a>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-emerald-700 flex items-center gap-1 mb-1">
              <CheckCircle size={12} /> Foto carregada
            </p>
            <p className="text-[10px] text-emerald-600 break-all line-clamp-2">{value.split("/").pop()}</p>
            <button
              onClick={() => onChange(null)}
              className="mt-2 flex items-center gap-1 text-[10px] text-red-500 hover:text-red-700 font-semibold"
            >
              <X size={10} /> Remover foto
            </button>
          </div>
        </div>
      ) : uploading ? (
        <div className="flex items-center gap-2 px-3 py-2.5 border-2 border-dashed border-[#4361EE]/30 rounded-xl bg-[#4361EE]/5">
          <Loader2 size={14} className="animate-spin text-[#4361EE]" />
          <span className="text-sm text-[#4361EE] font-medium">Enviando foto...</span>
        </div>
      ) : (
        <button
          onClick={() => ref.current?.click()}
          className="flex items-center gap-2 px-3 py-2 border-2 border-dashed border-[#0F1E3C]/15 rounded-xl text-sm text-[#0F1E3C]/40 hover:border-[#4361EE]/40 hover:text-[#4361EE] transition-colors"
        >
          <Image size={14} /> Adicionar foto
        </button>
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

// ─── Audience Picker ──────────────────────────────────────────────────────────

function AudiencePicker({
  audienceType, lifecycle, groupJids, groups,
  onType, onLifecycle, onGroups, stats,
  includeColdNew, onIncludeColdNew,
}: {
  audienceType: string
  lifecycle: string
  groupJids: string[]
  groups: Group[]
  onType: (v: string) => void
  onLifecycle: (v: string) => void
  onGroups: (v: string[]) => void
  stats: Stats | null
  includeColdNew?: boolean
  onIncludeColdNew?: (v: boolean) => void
}) {
  function toggleGroup(jid: string) {
    onGroups(groupJids.includes(jid)
      ? groupJids.filter(j => j !== jid)
      : [...groupJids, jid])
  }

  const coldCount = stats
    ? Number(stats.byState.find(s => s.state === "frio")?.total ?? 0)
      + Number(stats.byState.find(s => s.state === "new")?.total ?? 0)
    : 0

  const reach = (() => {
    if (!stats) return 0
    if (audienceType === "groups") return groupJids.length
    let base = lifecycle === "all" ? stats.total
      : Number(stats.byState.find(s => s.state === lifecycle)?.total ?? 0)
    if (lifecycle === "all" && !includeColdNew && onIncludeColdNew) base -= coldCount
    if (audienceType === "mixed") return base + groupJids.length
    return base
  })()

  return (
    <div className="space-y-3">
      <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider block">Audiência</label>

      <div className="flex gap-2 flex-wrap">
        {[
          { v: "lifecycle", l: "Clientes" },
          { v: "groups",    l: "Grupos" },
          { v: "mixed",     l: "Ambos" },
        ].map(({ v, l }) => (
          <button
            key={v}
            onClick={() => onType(v)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              audienceType === v
                ? "bg-[#4361EE] text-white"
                : "bg-[#F4F6FB] text-[#0F1E3C]/60 hover:bg-[#4361EE]/10"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {(audienceType === "lifecycle" || audienceType === "mixed") && (
        <select
          value={lifecycle}
          onChange={e => onLifecycle(e.target.value)}
          className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 bg-white"
        >
          {LIFECYCLE_OPTS.map(o => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      )}

      {(audienceType === "lifecycle" || audienceType === "mixed") && lifecycle === "all" && onIncludeColdNew && (
        <label className="flex items-center gap-2 cursor-pointer px-1">
          <input
            type="checkbox"
            checked={!!includeColdNew}
            onChange={e => onIncludeColdNew(e.target.checked)}
            className="rounded"
          />
          <span className="text-xs text-[#0F1E3C]/60">
            Incluir clientes <strong className="font-semibold">frios</strong> e <strong className="font-semibold">novos sem pedido</strong>
            {coldCount > 0 && <span className="text-[#0F1E3C]/35"> ({coldCount})</span>}
          </span>
        </label>
      )}

      {(audienceType === "groups" || audienceType === "mixed") && (
        <div className="max-h-36 overflow-y-auto space-y-1 border border-[#0F1E3C]/8 rounded-xl p-2">
          {groups.length === 0 && (
            <p className="text-xs text-[#0F1E3C]/30 text-center py-2">Nenhum grupo disponível</p>
          )}
          {groups.map(g => (
            <label key={g.jid} className="flex items-center gap-2 cursor-pointer rounded-lg px-2 py-1.5 hover:bg-[#F4F6FB]">
              <input
                type="checkbox"
                checked={groupJids.includes(g.jid)}
                onChange={() => toggleGroup(g.jid)}
                className="rounded"
              />
              <span className="text-xs text-[#0F1E3C] font-medium truncate">{g.name}</span>
            </label>
          ))}
        </div>
      )}

      <div className="flex items-center gap-2 bg-[#F4F6FB] rounded-xl px-3 py-2">
        <Users size={12} className="text-[#4361EE]" />
        <span className="text-xs font-bold text-[#4361EE]">{reach} destinatário{reach !== 1 ? "s" : ""}</span>
      </div>
    </div>
  )
}

// ─── Time picker com confirmação ───────────────────────────────────────────────
// Digitar/rolar hora e minuto no input nativo dispara onChange a cada tecla — sem
// esse botão o valor "comprometido" (usado no submit) mudava no meio da digitação,
// e um step de hora inteira acabava arredondando o minuto sozinho. Agora o valor
// só é aplicado quando o operador confirma.

function TimeConfirmInput({ value, onConfirm, onDirtyChange }: {
  value: string; onConfirm: (v: string) => void; onDirtyChange?: (dirty: boolean) => void
}) {
  // Sem useEffect de sincronização: o componente só existe dentro de um bloco
  // renderizado condicionalmente (isRecurring / sendMode === "schedule"), então
  // remonta do zero — com o `value` atual — sempre que reaparece na tela. O
  // único jeito de `schedTime` mudar é por este próprio onConfirm, que já
  // marca confirmed=true na hora, sem precisar reagir à mudança da prop depois.
  const [draft, setDraft] = useState(value)
  const [confirmed, setConfirmed] = useState(true)

  return (
    <div className="flex items-center gap-2">
      <input
        type="time"
        value={draft}
        onChange={e => { setDraft(e.target.value); setConfirmed(false); onDirtyChange?.(true) }}
        className="border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
      />
      <button
        type="button"
        onClick={() => { onConfirm(draft); setConfirmed(true); onDirtyChange?.(false) }}
        disabled={confirmed || !draft}
        className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-bold transition-colors ${
          confirmed
            ? "bg-emerald-50 text-emerald-600 cursor-default"
            : "bg-[#4361EE] text-white hover:bg-[#3451d1]"
        } disabled:opacity-60`}
      >
        {confirmed ? <Check size={13} /> : null}
        {confirmed ? "Confirmado" : "Confirmar horário"}
      </button>
    </div>
  )
}

// ─── Unified Create Drawer ────────────────────────────────────────────────────

function UnifiedDrawer({
  open, onClose, groups, stats, onCampaignCreated, onScheduleCreated,
}: {
  open: boolean
  onClose: () => void
  groups: Group[]
  stats: Stats | null
  onCampaignCreated: (id: number, sendNow: boolean) => void
  onScheduleCreated: () => void
}) {
  const [title,        setTitle]        = useState("")
  const [content,      setContent]      = useState("")
  const [mediaUrl,     setMediaUrl]     = useState<string | null>(null)
  const [audienceType, setAudienceType] = useState("lifecycle")
  const [lifecycle,    setLifecycle]    = useState("all")
  const [groupJids,    setGroupJids]    = useState<string[]>([])
  const [includeColdNew, setIncludeColdNew] = useState(false)
  const [daysOfWeek,   setDaysOfWeek]   = useState<number[]>([])
  const [sendMode,     setSendMode]     = useState<"now" | "schedule">("now")
  const [schedDate,    setSchedDate]    = useState("")
  const [schedTime,    setSchedTime]    = useState("08:00")
  const [timeDirty,    setTimeDirty]    = useState(false)
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  const isRecurring = daysOfWeek.length > 0

  function reset() {
    setTitle(""); setContent(""); setMediaUrl(null)
    setAudienceType("lifecycle"); setLifecycle("all"); setGroupJids([]); setIncludeColdNew(false)
    setDaysOfWeek([]); setSendMode("now"); setSchedDate(""); setSchedTime("08:00")
    setSaving(false); setError(null)
  }
  function close() { reset(); onClose() }

  function toggleDay(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function submit() {
    if (!content.trim()) { setError("Mensagem obrigatória"); return }
    if (isRecurring && !title.trim()) { setError("Nome obrigatório para programação recorrente"); return }
    if ((audienceType === "groups" || audienceType === "mixed") && groupJids.length === 0) {
      setError("Selecione ao menos um grupo"); return
    }
    if (!isRecurring && sendMode === "schedule" && !schedDate) { setError("Data obrigatória"); return }
    const needsTime = isRecurring || (sendMode === "schedule")
    if (needsTime && timeDirty) { setError("Confirme o horário antes de continuar"); return }

    setSaving(true); setError(null)

    if (isRecurring) {
      const r = await fetch("/api/marketing/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: title,
          daysOfWeek,
          timeOfDay: schedTime,
          audienceType,
          audienceLifecycle: audienceType !== "groups" ? lifecycle : null,
          audienceGroupJids: groupJids,
        }),
      })
      if (r.ok) {
        const { id } = await r.json()
        await fetch(`/api/marketing/schedules/${id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content, mediaUrl }),
        })
        onScheduleCreated()
        close()
      } else {
        const d = await r.json(); setError(d.error ?? "Erro ao criar programação")
      }
    } else {
      const scheduledAt = sendMode === "schedule"
        ? new Date(`${schedDate}T${schedTime}:00`).toISOString()
        : null
      const r = await fetch("/api/marketing/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title, content, mediaUrl, audienceType,
          audienceLifecycle: audienceType !== "groups" ? lifecycle : null,
          audienceGroupJids: groupJids,
          scheduledAt,
          includeColdNew,
        }),
      })
      if (r.ok) {
        const { id, sendNow: sn } = await r.json() as { id: number; sendNow: boolean }
        onCampaignCreated(id, sn)
        close()
      } else {
        const d = await r.json(); setError(d.error ?? "Erro ao criar campanha")
      }
    }
    setSaving(false)
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={close} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
          <div>
            <h2 className="text-sm font-bold text-[#0F1E3C]">Nova Mensagem</h2>
            <p className="text-[10px] mt-0.5">
              {isRecurring
                ? <span className="text-[#4361EE] font-semibold">→ Programação recorrente</span>
                : <span className="text-[#0F1E3C]/40">→ Mensagens Diretas (envio único)</span>}
            </p>
          </div>
          <button onClick={close} className="p-1 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Nome */}
          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">
              Nome {isRecurring
                ? <span className="text-red-400 font-bold">*</span>
                : <span className="font-normal text-[#0F1E3C]/30">(opcional)</span>}
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder={isRecurring ? "Ex: Post semanal de novidades" : "Ex: Lançamento coleção inverno"}
              className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            />
          </div>

          {/* Mensagem */}
          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">
              Mensagem {isRecurring && <span className="font-normal text-[#0F1E3C]/30">(entra na fila)</span>}
            </label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={4}
              placeholder="Oi {nome}, novidade chegando! 🔥"
              className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            />
            <p className="text-[10px] text-[#0F1E3C]/30 mt-1">
              Use <code className="bg-[#F4F6FB] px-1 rounded">{"{nome}"}</code> para personalizar
            </p>
          </div>

          {/* Foto */}
          <ImageUpload value={mediaUrl} onChange={setMediaUrl} />

          {/* Audiência */}
          <AudiencePicker
            audienceType={audienceType} lifecycle={lifecycle}
            groupJids={groupJids} groups={groups} stats={stats}
            onType={setAudienceType} onLifecycle={setLifecycle} onGroups={setGroupJids}
            includeColdNew={includeColdNew} onIncludeColdNew={setIncludeColdNew}
          />

          {/* Quando enviar */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider block">Quando enviar</label>

            {/* Dias — determina o modo */}
            <div>
              <p className="text-[11px] text-[#0F1E3C]/40 mb-2">
                Repetir nos dias <span className="text-[#0F1E3C]/25">(deixe vazio para envio único)</span>
              </p>
              <div className="flex gap-1.5 flex-wrap">
                {DAYS.map((d, i) => (
                  <button
                    key={i}
                    onClick={() => toggleDay(i)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                      daysOfWeek.includes(i)
                        ? "bg-[#4361EE] text-white"
                        : "bg-[#F4F6FB] text-[#0F1E3C]/50 hover:bg-[#4361EE]/10"
                    }`}
                  >{d}</button>
                ))}
              </div>
            </div>

            {isRecurring ? (
              /* Modo programação — só horário */
              <div className="flex items-center gap-2">
                <TimeConfirmInput value={schedTime} onConfirm={setSchedTime} onDirtyChange={setTimeDirty} />
                <span className="text-[11px] text-[#0F1E3C]/35">dispara dentro de ~5min do horário</span>
              </div>
            ) : (
              /* Modo campanha — agora ou agendar */
              <div className="space-y-2">
                <div className="flex gap-2">
                  {[
                    { v: "now",      l: "Enviar agora"   },
                    { v: "schedule", l: "Agendar horário" },
                  ].map(({ v, l }) => (
                    <button
                      key={v}
                      onClick={() => setSendMode(v as "now" | "schedule")}
                      className={`flex items-center gap-1.5 px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                        sendMode === v ? "bg-[#4361EE] text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/60 hover:bg-[#4361EE]/10"
                      }`}
                    >{l}</button>
                  ))}
                </div>
                {sendMode === "schedule" && (
                  <div className="flex gap-2 items-center flex-wrap">
                    <input
                      type="date" value={schedDate}
                      onChange={e => setSchedDate(e.target.value)}
                      className="border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                    />
                    <TimeConfirmInput value={schedTime} onConfirm={setSchedTime} onDirtyChange={setTimeDirty} />
                  </div>
                )}
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#0F1E3C]/8">
          <button
            onClick={submit}
            disabled={saving || ((isRecurring || sendMode === "schedule") && timeDirty)}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#4361EE] hover:bg-[#3451d1] text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            {saving ? (
              <><Loader2 size={14} className="animate-spin" /> Processando...</>
            ) : isRecurring ? (
              <><CalendarClock size={14} /> Criar Programação</>
            ) : sendMode === "now" ? (
              <><Send size={14} /> Enviar agora</>
            ) : (
              <><Calendar size={14} /> Agendar envio</>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Campaign Modal ───────────────────────────────────────────────────────────

function CampaignModal({ campaign, onClose, onCancel }: {
  campaign: Campaign
  onClose: () => void
  onCancel: (id: number) => Promise<void>
}) {
  const [cancelling, setCancelling] = useState(false)
  const sm = STATUS_META[campaign.status] ?? { label: campaign.status, cls: "bg-slate-100 text-slate-500" }
  const isCancellable = campaign.status === "scheduled" || campaign.status === "sending" || campaign.status === "generating"

  const statusLabel = (() => {
    if (campaign.status === "cancelled" && campaign.executedAt) {
      const d = new Date(campaign.executedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ_BR })
      return { text: `Cancelado em ${d}`, cls: "bg-slate-100 text-slate-500" }
    }
    return { text: sm.label, cls: sm.cls }
  })()

  async function handleCancel() {
    if (!confirm("Cancelar este envio? Mensagens já enviadas não são desfeitas.")) return
    setCancelling(true)
    await onCancel(campaign.id)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto">
          <div className="flex items-start justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
            <div className="flex-1 min-w-0 pr-3">
              <div className="flex items-center gap-2 flex-wrap">
                {campaign.title && <p className="text-base font-black text-[#0F1E3C]">{campaign.title}</p>}
                {campaign.status === "sending" ? (
                  <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                    <Loader2 size={8} className="animate-spin" /> {campaign.sentCount}/{campaign.totalCount}
                  </span>
                ) : (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusLabel.cls}`}>{statusLabel.text}</span>
                )}
              </div>
              {campaign.status === "sent" && (
                <p className="text-xs text-emerald-600 mt-0.5">{campaign.sentCount} enviados{campaign.errorCount > 0 ? ` · ${campaign.errorCount} erros` : ""}</p>
              )}
            </div>
            <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40 flex-shrink-0"><X size={16} /></button>
          </div>

          <div className="flex-1 overflow-y-auto p-5 space-y-4">
            {campaign.mediaUrl && (
              <a href={campaign.mediaUrl} target="_blank" rel="noreferrer" className="block group">
                <img src={campaign.mediaUrl} alt="" className="w-full max-h-64 object-cover rounded-xl border border-[#0F1E3C]/8 group-hover:opacity-90 transition-opacity" />
                <p className="text-[10px] text-[#4361EE] mt-1 text-center">Toque para abrir em tamanho completo</p>
              </a>
            )}

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider">
                  Mensagem {campaign.status === "generating" ? "(referência)" : ""}
                </p>
                {campaign.contentVariants && campaign.contentVariants.length > 0 && (
                  <span className="text-[9px] font-bold text-[#7C3AED] bg-[#7C3AED]/8 px-2 py-0.5 rounded-full">
                    {campaign.contentVariants.length} versões geradas por IA
                  </span>
                )}
              </div>
              <div className="bg-[#F4F6FB] rounded-xl px-4 py-3">
                <p className="text-sm text-[#0F1E3C] whitespace-pre-wrap">{campaign.content}</p>
              </div>
            </div>

            <div>
              <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Audiência</p>
              <div className="bg-[#F4F6FB] rounded-xl px-4 py-2.5">
                <p className="text-sm text-[#0F1E3C]">
                  {campaign.audienceType === "groups" ? `${campaign.audienceGroupJids.length} grupo(s)`
                    : campaign.audienceType === "lifecycle" ? (LIFECYCLE_OPTS.find(o => o.value === (campaign.audienceLifecycle ?? "all"))?.label ?? "—")
                    : "Clientes + grupos"}
                </p>
                {campaign.totalCount > 0 && (
                  <p className="text-[11px] text-[#0F1E3C]/40 mt-0.5">{campaign.totalCount} destinatário{campaign.totalCount !== 1 ? "s" : ""}</p>
                )}
              </div>
            </div>

            {campaign.scheduledAt && (
              <div>
                <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Agendado para</p>
                <div className="flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  <Clock size={13} className="text-amber-600 shrink-0" />
                  <p className="text-sm font-semibold text-amber-800">{fmtBR(campaign.scheduledAt)}</p>
                </div>
              </div>
            )}

            <p className="text-[10px] text-[#0F1E3C]/25">Criado em {fmtBR(campaign.createdAt)}</p>
          </div>

          <div className="px-5 py-4 border-t border-[#0F1E3C]/8 flex gap-2">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#F4F6FB] transition-colors border border-[#0F1E3C]/8">
              Fechar
            </button>
            {isCancellable && (
              <button
                onClick={handleCancel}
                disabled={cancelling}
                className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-sm font-bold text-red-600 hover:bg-red-50 transition-colors border border-red-200 disabled:opacity-40"
              >
                {cancelling ? <Loader2 size={14} className="animate-spin" /> : <X size={14} />}
                Cancelar envio
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Monitor de Envio (marketing isolado) ─────────────────────────────────────

type MonitorData = {
  campaign: {
    id: number; title: string; content: string
    sentCount: number; errorCount: number; totalCount: number
    status: string; contentVariants: string[] | null
    pauseReason: string | null; pausedUntil: string | null
  } | null
  instanceState: "connected" | "disconnected" | "not_configured"
}

function MarketingMonitor() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [resuming, setResuming] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/marketing/monitor")
      if (r.ok) setData(await r.json())
    } catch { /* tenta de novo no próximo poll */ }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 10_000)
    return () => clearInterval(id)
  }, [load])

  async function resume() {
    if (!data?.campaign) return
    setResuming(true)
    await fetch(`/api/marketing/campaigns/${data.campaign.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    })
    await load()
    setResuming(false)
  }

  if (!data) return null
  const { campaign, instanceState } = data

  // Sem campanha ativa e tudo certo — nada pra mostrar
  if (!campaign && instanceState !== "disconnected" && instanceState !== "not_configured") return null

  const isGenerating = campaign?.status === "generating"
  const isPausedCooldown = campaign?.pauseReason === "batch_cooldown"
  const isPausedDown = campaign?.pauseReason === "disconnected"
  const pill = isPausedDown ? { label: "Caído", cls: "bg-red-50 text-red-600 border-red-200" }
    : isPausedCooldown ? { label: "Em pausa", cls: "bg-amber-50 text-amber-600 border-amber-200" }
    : isGenerating ? { label: "Preparando", cls: "bg-emerald-50 text-emerald-600 border-emerald-200" }
    : campaign ? { label: "Conectado", cls: "bg-emerald-50 text-emerald-600 border-emerald-200" }
    : instanceState === "not_configured" ? { label: "Não configurado", cls: "bg-slate-100 text-slate-500 border-slate-200" }
    : { label: "Caído", cls: "bg-red-50 text-red-600 border-red-200" }

  const pct = campaign && campaign.totalCount > 0 ? Math.min(100, (campaign.sentCount / campaign.totalCount) * 100) : 0

  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3 border-b border-[#0F1E3C]/6">
        <p className="text-xs font-bold text-[#0F1E3C]">Monitor de Envio — Marketing</p>
        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full border ${pill.cls}`}>{pill.label}</span>
      </div>

      <div className="p-4 space-y-3">
        {instanceState === "not_configured" && !campaign && (
          <p className="text-xs text-[#0F1E3C]/40">
            Número de marketing ainda não conectado — escaneie o QR na instância <code className="bg-[#F4F6FB] px-1 rounded">smconfeccoes-marketing</code> pra ativar o isolamento.
          </p>
        )}

        {isPausedDown && (
          <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
            <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs text-red-700"><strong>Número de marketing caiu.</strong> Envio pausado pra não arriscar mais.</p>
              <p className="text-[10px] text-red-500/70 mt-0.5">
                {campaign?.sentCount ?? 0} de {campaign?.totalCount ?? 0} já enviados até aqui.
              </p>
              <button onClick={resume} disabled={resuming}
                className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 disabled:opacity-50 transition-colors">
                {resuming ? <Loader2 size={11} className="animate-spin" /> : null}
                Já reconectei, retomar envio
              </button>
            </div>
          </div>
        )}

        {isPausedCooldown && (
          <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <Clock size={14} className="text-amber-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-amber-700"><strong>Pausa programada anti-spam.</strong> 30 mensagens enviadas — respirando antes de continuar.</p>
              {campaign?.pausedUntil && (
                <p className="text-[10px] text-amber-600/70 mt-0.5">
                  Retoma sozinho às {new Date(campaign.pausedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} — não precisa fazer nada.
                </p>
              )}
            </div>
          </div>
        )}

        {campaign && isGenerating && (
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-semibold text-[#0F1E3C]">Gerando variações com IA</p>
            </div>
            <div className="h-2 rounded-full bg-[#F4F6FB] overflow-hidden">
              <div className="h-full rounded-full bg-gradient-to-r from-[#7C3AED] to-[#4361EE] animate-pulse" style={{ width: "60%" }} />
            </div>
            <p className="text-[10px] text-[#0F1E3C]/35 mt-1.5">Preparando textos diferentes pra {campaign.totalCount} clientes — a fila começa sozinha quando terminar.</p>
          </div>
        )}

        {campaign && !isGenerating && (
          <div>
            <div className="flex items-baseline justify-between mb-1.5">
              <p className="text-xs font-semibold text-[#0F1E3C] truncate max-w-[70%]">{campaign.title || "Campanha"}</p>
              <span className="text-[10px] text-[#0F1E3C]/40 font-mono">{campaign.sentCount} / {campaign.totalCount}</span>
            </div>
            <div className="h-2 rounded-full bg-[#F4F6FB] overflow-hidden">
              <div
                className={`h-full rounded-full transition-all ${isPausedDown || isPausedCooldown ? "bg-[#0F1E3C]/20" : "bg-gradient-to-r from-[#4361EE] to-[#7C3AED]"}`}
                style={{ width: `${pct}%` }}
              />
            </div>
            <div className="flex items-center gap-3 mt-1.5 text-[10px] text-[#0F1E3C]/40">
              <span>Enviados: <b className="text-[#0F1E3C]">{campaign.sentCount}</b></span>
              <span>Erros: <b className={campaign.errorCount > 0 ? "text-red-500" : "text-[#0F1E3C]"}>{campaign.errorCount}</b></span>
              {!isPausedDown && !isPausedCooldown && <span>Ritmo: 8-20s, pausa de 5min a cada 30</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Schedule Card ────────────────────────────────────────────────────────────

function ScheduleCard({ schedule, groups, onToggle, onDelete, onClick, onEdit }: {
  schedule: Schedule
  groups: Group[]
  onToggle: () => void
  onDelete: () => void
  onClick: () => void
  onEdit: () => void
}) {
  const [deleting, setDeleting] = useState(false)

  const daysLabel = schedule.daysOfWeek.length === 7 ? "Todos os dias"
    : schedule.daysOfWeek.length === 5 && !schedule.daysOfWeek.includes(0) && !schedule.daysOfWeek.includes(6)
      ? "Seg–Sex"
      : schedule.daysOfWeek.map(d => DAYS[d]).join(", ")

  const audienceLabel = (() => {
    const lc = LIFECYCLE_OPTS.find(o => o.value === (schedule.audienceLifecycle ?? "all"))?.label ?? "Todos"
    const grps = schedule.audienceGroupJids.map(jid => groups.find(g => g.jid === jid)?.name ?? jid.split("@")[0]).join(", ")
    if (schedule.audienceType === "groups") return grps || "Sem grupos"
    if (schedule.audienceType === "lifecycle") return `Clientes — ${lc}`
    return `${lc} + ${grps || "grupos"}`
  })()

  async function handleDelete(e: React.MouseEvent) {
    e.stopPropagation()
    if (!confirm("Remover esta programação?")) return
    setDeleting(true)
    await fetch(`/api/marketing/schedules/${schedule.id}`, { method: "DELETE" })
    onDelete()
  }

  return (
    <div
      onClick={onClick}
      className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden cursor-pointer hover:border-[#4361EE]/30 transition-colors"
    >
      <div className="flex items-center gap-3 px-4 py-3.5">
        {schedule.firstItemMediaUrl && (
          <img src={schedule.firstItemMediaUrl} alt="" className="h-11 w-11 rounded-xl object-cover border border-[#0F1E3C]/8 flex-shrink-0" />
        )}

        <button
          onClick={e => { e.stopPropagation(); onToggle() }}
          className="text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors flex-shrink-0"
        >
          {schedule.active
            ? <ToggleRight size={22} className="text-[#4361EE]" />
            : <ToggleLeft size={22} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold text-[#0F1E3C] truncate">{schedule.name}</p>
            {!schedule.active && (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full flex-shrink-0">Pausado</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-0.5 flex-wrap">
            <span className="text-[11px] text-[#0F1E3C]/40 flex items-center gap-1">
              <Clock size={9} /> {schedule.timeOfDay.slice(0,5)} · {daysLabel}
            </span>
            <span className="text-[11px] text-[#0F1E3C]/40 flex items-center gap-1">
              <Layers size={9} /> {schedule.itemCount} item{schedule.itemCount !== 1 ? "s" : ""}
            </span>
          </div>
          <p className={`text-[10px] mt-0.5 truncate ${audienceLabel === "Sem grupos" ? "text-amber-500 font-semibold" : "text-[#0F1E3C]/30"}`}>
            {audienceLabel}
          </p>
        </div>

        <button
          onClick={e => { e.stopPropagation(); onEdit() }}
          className="p-1.5 rounded-lg hover:bg-[#4361EE]/8 text-[#0F1E3C]/25 hover:text-[#4361EE] transition-colors flex-shrink-0"
          title="Editar programação"
        >
          <Pencil size={13} />
        </button>
        <button
          onClick={handleDelete}
          disabled={deleting}
          className="p-1.5 rounded-lg hover:bg-red-50 text-[#0F1E3C]/25 hover:text-red-400 transition-colors flex-shrink-0 disabled:opacity-40"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  )
}

// ─── Schedule Modal ───────────────────────────────────────────────────────────

function ScheduleModal({ schedule, groups, stats, startInEdit, onClose, onToggle, onRefresh }: {
  schedule: Schedule
  groups: Group[]
  stats: Stats | null
  startInEdit?: boolean
  onClose: () => void
  onToggle: () => void
  onRefresh: () => void
}) {
  const [panel,      setPanel]     = useState<"fila" | "historico">("fila")
  const [items,      setItems]     = useState<ScheduleItem[]>([])
  const [executions, setExecutions] = useState<ScheduleExecution[]>([])
  const [loadingQ,   setLoadingQ]  = useState(false)
  const [loadingH,   setLoadingH]  = useState(false)
  const [newContent, setNewContent] = useState("")
  const [newMedia,   setNewMedia]  = useState<string | null>(null)
  const [addingItem, setAddingItem] = useState(false)
  const [editingItemId, setEditingItemId] = useState<number | null>(null)

  // Editar nome/dias/horário/audiência sem apagar e recriar a programação.
  // startInEdit já abre direto aqui (botão de editar veio da listagem, sem
  // precisar clicar de novo dentro do modal) — os campos abaixo já nascem
  // com o valor atual da programação, então não precisa de nenhum efeito
  // pra "resetar" nada na abertura.
  const [editingMeta,   setEditingMeta]   = useState(!!startInEdit)
  const [editName,      setEditName]      = useState(schedule.name)
  const [editDays,      setEditDays]      = useState<number[]>(schedule.daysOfWeek)
  const [editTime,      setEditTime]      = useState(schedule.timeOfDay.slice(0, 5))
  const [editTimeDirty, setEditTimeDirty] = useState(false)
  const [editAudType,   setEditAudType]   = useState(schedule.audienceType)
  const [editLifecycle, setEditLifecycle] = useState(schedule.audienceLifecycle ?? "all")
  const [editGroupJids, setEditGroupJids] = useState<string[]>(schedule.audienceGroupJids)
  const [savingMeta,    setSavingMeta]    = useState(false)
  const [metaError,     setMetaError]     = useState<string | null>(null)

  function openEditMeta() {
    setEditName(schedule.name)
    setEditDays(schedule.daysOfWeek)
    setEditTime(schedule.timeOfDay.slice(0, 5))
    setEditTimeDirty(false)
    setEditAudType(schedule.audienceType)
    setEditLifecycle(schedule.audienceLifecycle ?? "all")
    setEditGroupJids(schedule.audienceGroupJids)
    setMetaError(null)
    setEditingMeta(true)
  }

  function toggleEditDay(d: number) {
    setEditDays(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function saveMeta() {
    if (!editName.trim()) { setMetaError("Nome obrigatório"); return }
    if (editDays.length === 0) { setMetaError("Selecione ao menos um dia"); return }
    if (editTimeDirty) { setMetaError("Confirme o horário antes de salvar"); return }
    if ((editAudType === "groups" || editAudType === "mixed") && editGroupJids.length === 0) {
      setMetaError("Selecione ao menos um grupo"); return
    }
    setSavingMeta(true); setMetaError(null)
    const r = await fetch(`/api/marketing/schedules/${schedule.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editName.trim(),
        daysOfWeek: editDays,
        timeOfDay: editTime,
        audienceType: editAudType,
        audienceLifecycle: editAudType !== "groups" ? editLifecycle : null,
        audienceGroupJids: editGroupJids,
      }),
    })
    if (r.ok) {
      onRefresh()
      setEditingMeta(false)
    } else {
      const d = await r.json().catch(() => ({}))
      setMetaError(d.error ?? "Erro ao salvar")
    }
    setSavingMeta(false)
  }

  const daysLabel = schedule.daysOfWeek.length === 7 ? "Todos os dias"
    : schedule.daysOfWeek.length === 5 && !schedule.daysOfWeek.includes(0) && !schedule.daysOfWeek.includes(6)
      ? "Seg–Sex"
      : schedule.daysOfWeek.map(d => DAYS[d]).join(", ")

  const audienceLabel = (() => {
    const lc = LIFECYCLE_OPTS.find(o => o.value === (schedule.audienceLifecycle ?? "all"))?.label ?? "Todos"
    const grps = schedule.audienceGroupJids.map(jid => groups.find(g => g.jid === jid)?.name ?? jid.split("@")[0]).join(", ")
    if (schedule.audienceType === "groups") return grps || "Sem grupos definidos"
    if (schedule.audienceType === "lifecycle") return `Clientes — ${lc}`
    return `Clientes (${lc}) + ${grps || "sem grupos"}`
  })()

  async function loadItems() {
    setLoadingQ(true)
    const r = await fetch(`/api/marketing/schedules/${schedule.id}/items`)
    if (r.ok) setItems(await r.json())
    setLoadingQ(false)
  }

  async function loadHistory() {
    setLoadingH(true)
    const r = await fetch(`/api/marketing/schedules/${schedule.id}/history`)
    if (r.ok) setExecutions(await r.json())
    setLoadingH(false)
  }

  useEffect(() => {
    loadItems()
  }, [])

  useEffect(() => {
    if (panel === "fila") loadItems()
    else loadHistory()
  }, [panel])

  function startEditItem(item: ScheduleItem) {
    setEditingItemId(item.id)
    setNewContent(item.content)
    setNewMedia(item.mediaUrl)
  }

  function cancelEditItem() {
    setEditingItemId(null)
    setNewContent("")
    setNewMedia(null)
  }

  async function saveItem() {
    if (!newContent.trim()) return
    setAddingItem(true)
    const r = editingItemId
      ? await fetch(`/api/marketing/schedules/${schedule.id}/items/${editingItemId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent, mediaUrl: newMedia }),
        })
      : await fetch(`/api/marketing/schedules/${schedule.id}/items`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: newContent, mediaUrl: newMedia }),
        })
    if (r.ok) { setNewContent(""); setNewMedia(null); setEditingItemId(null); loadItems(); onRefresh() }
    setAddingItem(false)
  }

  async function deleteItem(itemId: number) {
    await fetch(`/api/marketing/schedules/${schedule.id}/items/${itemId}`, { method: "DELETE" })
    if (editingItemId === itemId) cancelEditItem()
    loadItems()
    onRefresh()
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-50" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 pointer-events-none">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col overflow-hidden pointer-events-auto">
          {/* Header */}
          <div className="px-5 py-4 border-b border-[#0F1E3C]/8">
            <div className="flex items-center justify-between gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-base font-black text-[#0F1E3C] truncate">{schedule.name}</p>
                  {!schedule.active && (
                    <span className="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full flex-shrink-0">Pausado</span>
                  )}
                </div>
                {!editingMeta && (
                  <div className="flex items-center gap-3 mt-0.5 text-[11px] text-[#0F1E3C]/40 flex-wrap">
                    <span className="flex items-center gap-1"><Clock size={9} /> {schedule.timeOfDay.slice(0,5)} · {daysLabel}</span>
                    <span className={audienceLabel === "Sem grupos definidos" ? "text-amber-500 font-semibold" : ""}>{audienceLabel}</span>
                    <span className="flex items-center gap-1"><Layers size={9} /> {schedule.itemCount} item{schedule.itemCount !== 1 ? "s" : ""}</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-2 flex-shrink-0">
                <button onClick={() => editingMeta ? setEditingMeta(false) : openEditMeta()}
                  title="Editar programação"
                  className={`p-1.5 rounded-lg transition-colors ${editingMeta ? "bg-[#4361EE]/10 text-[#4361EE]" : "text-[#0F1E3C]/30 hover:bg-[#F4F6FB] hover:text-[#4361EE]"}`}>
                  <Pencil size={15} />
                </button>
                <button onClick={() => { onToggle(); onRefresh() }} className="text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors">
                  {schedule.active
                    ? <ToggleRight size={24} className="text-[#4361EE]" />
                    : <ToggleLeft size={24} />}
                </button>
                <button onClick={onClose} className="p-1 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
              </div>
            </div>

            {editingMeta ? (
              <div className="mt-3 space-y-3 bg-[#F9FAFC] rounded-xl p-3 border border-[#0F1E3C]/8">
                <div>
                  <label className="text-[10px] font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1 block">Nome</label>
                  <input
                    value={editName}
                    onChange={e => setEditName(e.target.value)}
                    className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1 block">Dias</label>
                  <div className="flex gap-1.5 flex-wrap">
                    {DAYS.map((d, i) => (
                      <button key={i} onClick={() => toggleEditDay(i)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                          editDays.includes(i) ? "bg-[#4361EE] text-white" : "bg-white text-[#0F1E3C]/50 hover:bg-[#4361EE]/10"
                        }`}>{d}</button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="text-[10px] font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1 block">Horário</label>
                  <TimeConfirmInput value={editTime} onConfirm={setEditTime} onDirtyChange={setEditTimeDirty} />
                </div>

                <AudiencePicker
                  audienceType={editAudType} lifecycle={editLifecycle}
                  groupJids={editGroupJids} groups={groups} stats={stats}
                  onType={setEditAudType} onLifecycle={setEditLifecycle} onGroups={setEditGroupJids}
                />

                {metaError && (
                  <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2">
                    <AlertCircle size={13} className="text-red-500 shrink-0" />
                    <p className="text-xs text-red-600">{metaError}</p>
                  </div>
                )}

                <div className="flex gap-2">
                  <button onClick={() => setEditingMeta(false)}
                    className="flex-1 py-2 rounded-xl border border-[#0F1E3C]/10 text-xs font-semibold text-[#0F1E3C]/50 hover:bg-white transition-colors">
                    Cancelar
                  </button>
                  <button onClick={saveMeta} disabled={savingMeta || editTimeDirty}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#4361EE] text-white text-xs font-bold hover:bg-[#3451d1] disabled:opacity-50 transition-colors">
                    {savingMeta ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}
                    {savingMeta ? "Salvando..." : "Salvar alterações"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex gap-1 mt-3">
                {(["fila", "historico"] as const).map(p => (
                  <button key={p} onClick={() => setPanel(p)}
                    className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                      panel === p ? "bg-[#F4F6FB] text-[#4361EE] border border-[#0F1E3C]/8" : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]"
                    }`}
                  >
                    {p === "fila" ? `Fila (${items.length || schedule.itemCount})` : "Histórico"}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Body */}
          {!editingMeta && (
          <div className="flex-1 overflow-y-auto p-5">
            {panel === "fila" && (
              <div className="space-y-3">
                <p className="text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider">Rotaciona — próximo é o mais antigo</p>

                {loadingQ ? (
                  <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-[#4361EE]" /></div>
                ) : items.length === 0 ? (
                  <p className="text-xs text-[#0F1E3C]/30 text-center py-3">Fila vazia. Adicione conteúdo abaixo.</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <div key={item.id} className="flex gap-2 items-start bg-[#F9FAFC] rounded-xl p-3 border border-[#0F1E3C]/6">
                        <span className={`text-[10px] font-bold mt-0.5 w-4 shrink-0 ${idx === 0 ? "text-[#4361EE]" : "text-[#0F1E3C]/25"}`}>
                          {idx === 0 ? "→" : idx + 1}
                        </span>
                        {item.mediaUrl && (
                          <a href={item.mediaUrl} target="_blank" rel="noreferrer" className="shrink-0 group relative">
                            <img src={item.mediaUrl} alt="" className="h-14 w-14 rounded-lg object-cover border border-[#0F1E3C]/8 group-hover:opacity-75 transition-opacity" />
                          </a>
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[#0F1E3C] whitespace-pre-wrap break-words">{item.content}</p>
                          <div className="flex items-center gap-2 mt-1">
                            {item.lastSentAt && <span className="text-[9px] text-[#0F1E3C]/30">Enviado {fmtBR(item.lastSentAt)}</span>}
                            {item.sentCount > 0 && <span className="text-[9px] text-emerald-600 font-bold">{item.sentCount}× enviado</span>}
                          </div>
                        </div>
                        <div className="flex flex-col gap-1 shrink-0">
                          <button onClick={() => startEditItem(item)} className="p-1 rounded hover:bg-[#4361EE]/8 text-[#0F1E3C]/25 hover:text-[#4361EE]">
                            <Pencil size={12} />
                          </button>
                          <button onClick={() => deleteItem(item.id)} className="p-1 rounded hover:bg-red-50 text-[#0F1E3C]/25 hover:text-red-400">
                            <X size={12} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <div className="space-y-2 pt-2 border-t border-[#0F1E3C]/6">
                  <p className="text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider">
                    {editingItemId ? "Editando item" : "Adicionar à fila"}
                  </p>
                  <textarea
                    value={newContent} onChange={e => setNewContent(e.target.value)}
                    rows={3} placeholder="Texto do próximo post..."
                    className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                  />
                  <ImageUpload value={newMedia} onChange={setNewMedia} />
                  <div className="flex gap-2">
                    {editingItemId && (
                      <button onClick={cancelEditItem}
                        className="py-2 px-3 rounded-xl border border-[#0F1E3C]/10 text-xs font-semibold text-[#0F1E3C]/50 hover:bg-white transition-colors">
                        Cancelar
                      </button>
                    )}
                    <button onClick={saveItem} disabled={!newContent.trim() || addingItem}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-[#4361EE] text-white text-xs font-bold rounded-xl hover:bg-[#3451d1] disabled:opacity-40 transition-colors">
                      {addingItem ? <Loader2 size={12} className="animate-spin" /> : editingItemId ? <Save size={12} /> : <Plus size={12} />}
                      {editingItemId ? "Salvar alteração" : "Adicionar à fila"}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {panel === "historico" && (
              <div className="space-y-2">
                <p className="text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider mb-1">Últimas 30 execuções</p>
                {loadingH ? (
                  <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-[#4361EE]" /></div>
                ) : executions.length === 0 ? (
                  <div className="text-center py-6">
                    <Clock size={20} className="mx-auto text-[#0F1E3C]/15 mb-2" />
                    <p className="text-xs text-[#0F1E3C]/30">Nenhuma execução ainda.</p>
                  </div>
                ) : (
                  executions.map(ex => {
                    const expected = schedule.audienceType === "groups" ? schedule.audienceGroupJids.length : null
                    const partial = expected != null && ex.sentCount < expected
                    return (
                    <div key={ex.id} className="bg-[#F9FAFC] rounded-xl border border-[#0F1E3C]/6 p-3 flex gap-3 items-start">
                      {ex.mediaUrl && (
                        <a href={ex.mediaUrl} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={ex.mediaUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-[#0F1E3C]/8 hover:opacity-75 transition-opacity" />
                        </a>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#0F1E3C] whitespace-pre-wrap line-clamp-2">{ex.content}</p>
                        <div className="flex items-center gap-3 mt-1">
                          <span className="text-[10px] text-[#0F1E3C]/40">{fmtBR(ex.executedAt)}</span>
                          <span className={`text-[10px] font-semibold flex items-center gap-1 ${partial ? "text-amber-600" : "text-emerald-600"}`}>
                            <CheckCircle size={9} /> {ex.sentCount}{expected != null ? `/${expected}` : ""} enviados
                          </span>
                          {ex.errorCount > 0 && <span className="text-[10px] text-red-500">{ex.errorCount} erros</span>}
                        </div>
                      </div>
                    </div>
                    )
                  })
                )}
              </div>
            )}
          </div>
          )}

          <div className="px-5 py-4 border-t border-[#0F1E3C]/8">
            <button onClick={onClose} className="w-full py-2.5 rounded-xl text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#F4F6FB] transition-colors border border-[#0F1E3C]/8">
              Fechar
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

// ─── Schedule Row (expanded with queue) — LEGACY placeholder ─────────────────

function ScheduleRow({
  schedule, groups, onToggle, onDelete, onRefresh,
}: {
  schedule: Schedule
  groups: Group[]
  onToggle: () => void
  onDelete: () => void
  onRefresh: () => void
}) {
  const [expanded,    setExpanded]   = useState(false)
  const [panel,       setPanel]      = useState<"fila" | "historico">("fila")
  const [items,       setItems]      = useState<ScheduleItem[]>([])
  const [executions,  setExecutions] = useState<ScheduleExecution[]>([])
  const [loadingQ,    setLoadingQ]   = useState(false)
  const [loadingH,    setLoadingH]   = useState(false)
  const [newContent,  setNewContent] = useState("")
  const [newMedia,    setNewMedia]   = useState<string | null>(null)
  const [addingItem,  setAddingItem] = useState(false)
  const [deleting,    setDeleting]   = useState(false)

  const groupNames = schedule.audienceGroupJids
    .map(jid => groups.find(g => g.jid === jid)?.name ?? jid.split("@")[0])
    .join(", ")

  const audienceLabel = (() => {
    const lifecycleLabel = LIFECYCLE_OPTS.find(o => o.value === (schedule.audienceLifecycle ?? "all"))?.label ?? "Todos"
    if (schedule.audienceType === "groups") {
      return groupNames || "Sem grupos definidos"
    }
    if (schedule.audienceType === "lifecycle") {
      return `Clientes — ${lifecycleLabel}`
    }
    if (schedule.audienceType === "mixed") {
      const grpPart = groupNames || "sem grupos"
      return `Clientes (${lifecycleLabel}) + ${grpPart}`
    }
    return "—"
  })()

  async function loadItems() {
    setLoadingQ(true)
    const r = await fetch(`/api/marketing/schedules/${schedule.id}/items`)
    if (r.ok) setItems(await r.json())
    setLoadingQ(false)
  }

  async function loadHistory() {
    setLoadingH(true)
    const r = await fetch(`/api/marketing/schedules/${schedule.id}/history`)
    if (r.ok) setExecutions(await r.json())
    setLoadingH(false)
  }

  async function addItem() {
    if (!newContent.trim()) return
    setAddingItem(true)
    const r = await fetch(`/api/marketing/schedules/${schedule.id}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: newContent, mediaUrl: newMedia }),
    })
    if (r.ok) { setNewContent(""); setNewMedia(null); loadItems() }
    setAddingItem(false)
  }

  async function deleteItem(itemId: number) {
    await fetch(`/api/marketing/schedules/${schedule.id}/items/${itemId}`, { method: "DELETE" })
    loadItems()
  }

  async function handleDelete() {
    if (!confirm("Remover esta programação?")) return
    setDeleting(true)
    await fetch(`/api/marketing/schedules/${schedule.id}`, { method: "DELETE" })
    onDelete()
    onRefresh()
  }

  useEffect(() => {
    if (!expanded) return
    if (panel === "fila") loadItems()
    else loadHistory()
  }, [expanded, panel])

  const daysLabel = schedule.daysOfWeek.length === 7 ? "Todos os dias"
    : schedule.daysOfWeek.length === 5 && !schedule.daysOfWeek.includes(0) && !schedule.daysOfWeek.includes(6)
      ? "Seg–Sex"
      : schedule.daysOfWeek.map(d => DAYS[d]).join(", ")

  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
      {/* Header row */}
      <div className="flex items-center gap-3 px-4 py-3.5">
        <button onClick={onToggle} className="text-[#0F1E3C]/30 hover:text-[#4361EE] transition-colors flex-shrink-0">
          {schedule.active
            ? <ToggleRight size={22} className="text-[#4361EE]" />
            : <ToggleLeft size={22} />}
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-bold text-[#0F1E3C]">{schedule.name}</p>
            {!schedule.active && (
              <span className="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full">Pausado</span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="flex items-center gap-1 text-[11px] text-[#0F1E3C]/40">
              <Clock size={10} /> {schedule.timeOfDay.slice(0,5)} · {daysLabel}
            </span>
            <span className={`text-[11px] truncate max-w-52 ${
              audienceLabel === "Sem grupos definidos"
                ? "text-amber-500 font-semibold"
                : "text-[#0F1E3C]/40"
            }`}>{audienceLabel}</span>
            <span className="flex items-center gap-1 text-[11px] text-[#0F1E3C]/40">
              <Layers size={10} /> {schedule.itemCount} item{schedule.itemCount !== 1 ? "s" : ""}
            </span>
            {schedule.lastExecutedAt && (
              <span className="flex items-center gap-1 text-[11px] text-[#0F1E3C]/30">
                <CheckCircle size={9} className="text-emerald-500" />
                último: {fmtBR(schedule.lastExecutedAt)}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={() => setExpanded(v => !v)}
            className="p-1.5 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"
          >
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>
          <button onClick={handleDelete} disabled={deleting}
            className="p-1.5 rounded-lg hover:bg-red-50 text-[#0F1E3C]/30 hover:text-red-500 transition-colors">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-[#0F1E3C]/6 bg-[#F9FAFC]">
          {/* Panel toggle */}
          <div className="flex gap-1 px-4 pt-3 pb-0">
            {(["fila", "historico"] as const).map(p => (
              <button
                key={p}
                onClick={() => setPanel(p)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-bold transition-colors ${
                  panel === p
                    ? "bg-white text-[#4361EE] shadow-sm border border-[#0F1E3C]/8"
                    : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]"
                }`}
              >
                {p === "fila" ? `Fila (${items.length || schedule.itemCount})` : "Histórico"}
              </button>
            ))}
          </div>

          {/* Fila panel */}
          {panel === "fila" && (
            <div className="px-4 py-3 space-y-3">
              <p className="text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider">
                Rotaciona automaticamente — próximo é o mais antigo
              </p>

              {loadingQ ? (
                <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-[#4361EE]" /></div>
              ) : items.length === 0 ? (
                <p className="text-xs text-[#0F1E3C]/30 text-center py-3">Sem conteúdo na fila. Adicione itens abaixo.</p>
              ) : (
                <div className="space-y-2">
                  {items.map((item, idx) => (
                    <div key={item.id} className="flex gap-2 items-start bg-white rounded-xl p-3 border border-[#0F1E3C]/6">
                      <span className={`text-[10px] font-bold mt-0.5 w-4 shrink-0 ${idx === 0 ? "text-[#4361EE]" : "text-[#0F1E3C]/25"}`}>
                        {idx === 0 ? "→" : idx + 1}
                      </span>
                      {item.mediaUrl && (
                        <a href={item.mediaUrl} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={item.mediaUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-[#0F1E3C]/8 hover:opacity-75 transition-opacity" />
                        </a>
                      )}
                      <p className="flex-1 text-xs text-[#0F1E3C] whitespace-pre-wrap break-words">{item.content}</p>
                      <div className="flex flex-col items-end gap-1 shrink-0">
                        {item.lastSentAt && (
                          <span className="text-[9px] text-[#0F1E3C]/30">Enviado {fmtBR(item.lastSentAt)}</span>
                        )}
                        {item.sentCount > 0 && (
                          <span className="text-[9px] text-emerald-600 font-bold">{item.sentCount}× enviado</span>
                        )}
                        <button onClick={() => deleteItem(item.id)}
                          className="p-1 rounded-lg hover:bg-red-50 text-[#0F1E3C]/25 hover:text-red-400">
                          <X size={12} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Add item */}
              <div className="space-y-2 pt-1">
                <textarea
                  value={newContent}
                  onChange={e => setNewContent(e.target.value)}
                  rows={3}
                  placeholder="Texto do próximo post..."
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 bg-white"
                />
                <ImageUpload value={newMedia} onChange={setNewMedia} label="Foto (opcional)" />
                <button
                  onClick={addItem}
                  disabled={!newContent.trim() || addingItem}
                  className="w-full flex items-center justify-center gap-1.5 px-4 py-2 bg-[#4361EE] text-white text-xs font-bold rounded-xl hover:bg-[#3451d1] disabled:opacity-40 transition-colors"
                >
                  {addingItem ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
                  Adicionar à fila
                </button>
              </div>
            </div>
          )}

          {/* Histórico panel */}
          {panel === "historico" && (
            <div className="px-4 py-3 space-y-2">
              <p className="text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider mb-1">
                Últimas 30 execuções
              </p>

              {loadingH ? (
                <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-[#4361EE]" /></div>
              ) : executions.length === 0 ? (
                <div className="text-center py-6">
                  <Clock size={20} className="mx-auto text-[#0F1E3C]/15 mb-2" />
                  <p className="text-xs text-[#0F1E3C]/30">Nenhuma execução ainda.</p>
                  <p className="text-[10px] text-[#0F1E3C]/20 mt-0.5">O histórico aparecerá após o primeiro disparo automático.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {executions.map(ex => (
                    <div key={ex.id} className="bg-white rounded-xl border border-[#0F1E3C]/6 p-3 flex gap-3 items-start">
                      {ex.mediaUrl && (
                        <a href={ex.mediaUrl} target="_blank" rel="noreferrer" className="shrink-0">
                          <img src={ex.mediaUrl} alt="" className="h-10 w-10 rounded-lg object-cover border border-[#0F1E3C]/8 hover:opacity-75 transition-opacity" />
                        </a>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-[#0F1E3C] whitespace-pre-wrap break-words line-clamp-2">{ex.content}</p>
                        <div className="flex items-center gap-3 mt-1 flex-wrap">
                          <span className="text-[10px] text-[#0F1E3C]/40">{fmtBR(ex.executedAt)}</span>
                          <span className="flex items-center gap-1 text-[10px] text-emerald-600 font-semibold">
                            <CheckCircle size={9} /> {ex.sentCount} enviados
                          </span>
                          {ex.errorCount > 0 && (
                            <span className="text-[10px] text-red-500">{ex.errorCount} erros</span>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Lifecycle Tab ────────────────────────────────────────────────────────────

type LCStep =
  | { type: "msg";    key: string; title: string; chip: string }
  | { type: "silent"; title: string; desc: string }

type LCSection = {
  id: string
  label: string
  state: string
  badgeCls: string
  steps: LCStep[]
}

const LC_SECTIONS: LCSection[] = [
  {
    id: "lead",
    label: "LEAD NOVO",
    state: "lifecycle = new",
    badgeCls: "bg-blue-50 text-blue-600 border border-blue-200",
    steps: [
      { type: "msg",    key: "novo_d2_msg",    title: "D2 — Sem compra em 48h",          chip: "idle > 48h · novo_seq=0 · disparo 1×" },
      { type: "silent", title: "D9+ — Sem resposta ao D2",                                desc: "7 dias após D2 sem resposta → transita para lifecycle=frio. Sem mensagem enviada." },
    ],
  },
  {
    id: "ativo",
    label: "CLIENTE ATIVO",
    state: "lifecycle = active",
    badgeCls: "bg-emerald-50 text-emerald-600 border border-emerald-200",
    steps: [
      { type: "msg",    key: "ausente_d15_msg", title: "D15 — Sem compra há 15 dias",    chip: "last_order_at > 15d · transita para ausente · disparo 1×" },
    ],
  },
  {
    id: "ausente",
    label: "AUSENTE",
    state: "lifecycle = ausente",
    badgeCls: "bg-amber-50 text-amber-600 border border-amber-200",
    steps: [
      { type: "msg",    key: "ausente_d30_msg", title: "D30 — Segunda tentativa",        chip: "ausente_seq=1 · last_order_at > 30d" },
      { type: "msg",    key: "ausente_d45_msg", title: "D45 — Última mensagem",          chip: "ausente_seq=2 · last_order_at > 45d" },
      { type: "silent", title: "D75+ — Sem resposta ao D45",                              desc: "30 dias após D45 sem resposta → transita para lifecycle=frio. Sem mensagem enviada." },
    ],
  },
]

const LC_DEFAULTS: Record<string, string> = {
  novo_d2_msg:     "Oi {nome}! Quando quiser fazer um pedido é só me chamar — produto, cor e tamanho que eu registro na hora.",
  ausente_d15_msg: "Oi {nome}, faz um tempo! Estoque renovado aqui. Quando quiser pedir é só chamar.",
  ausente_d30_msg: "{nome}, chegaram peças novas esse mês. Me chama quando precisar.",
  ausente_d45_msg: "Oi {nome}! Uma última mensagem — quando precisar de estoque, pode contar comigo.",
}

function LifecycleTab() {
  const [settings,   setSettings]   = useState<Record<string, string>>({})
  const [loading,    setLoading]    = useState(true)
  const [saving,     setSaving]     = useState(false)
  const [saved,      setSaved]      = useState(false)
  const [togglingLC, setTogglingLC] = useState(false)

  const [subTab, setSubTab] = useState<"mensagens" | "tarefas" | "concluidas">("mensagens")

  const [tasks,        setTasks]        = useState<LifecycleTaskItem[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)

  const [completed,        setCompleted]        = useState<LifecycleCompletedItem[]>([])
  const [completedPeriod,  setCompletedPeriod]  = useState<"today" | "7d" | "30d">("7d")
  const [completedLoading, setCompletedLoading] = useState(false)

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then((d: Record<string, string>) => { setSettings(d); setLoading(false) })
  }, [])

  useEffect(() => {
    if (subTab !== "tarefas") return
    setTasksLoading(true)
    fetch("/api/marketing/lifecycle?view=tasks")
      .then(r => r.json())
      .then((d: LifecycleTaskItem[]) => setTasks(Array.isArray(d) ? d : []))
      .finally(() => setTasksLoading(false))
  }, [subTab])

  useEffect(() => {
    if (subTab !== "concluidas") return
    setCompletedLoading(true)
    fetch(`/api/marketing/lifecycle?view=completed&period=${completedPeriod}`)
      .then(r => r.json())
      .then((d: LifecycleCompletedItem[]) => setCompleted(Array.isArray(d) ? d : []))
      .finally(() => setCompletedLoading(false))
  }, [subTab, completedPeriod])

  function setSetting(key: string, value: string) {
    setSettings(prev => ({ ...prev, [key]: value }))
  }

  async function toggleLifecycle() {
    const next = settings.lifecycle_ativo === "false" ? "true" : "false"
    setTogglingLC(true)
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lifecycle_ativo: next }),
    })
    setSettings(prev => ({ ...prev, lifecycle_ativo: next }))
    setTogglingLC(false)
  }

  async function saveMessages() {
    setSaving(true)
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        novo_d2_msg:     settings.novo_d2_msg     ?? "",
        ausente_d15_msg: settings.ausente_d15_msg ?? "",
        ausente_d30_msg: settings.ausente_d30_msg ?? "",
        ausente_d45_msg: settings.ausente_d45_msg ?? "",
      }),
    })
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 2500)
  }

  const lifecycleOn = settings.lifecycle_ativo !== "false"

  const STAGE_CLS: Record<string, string> = {
    D2:  "bg-blue-100 text-blue-700",
    D15: "bg-amber-100 text-amber-700",
    D30: "bg-orange-100 text-orange-700",
    D45: "bg-red-100 text-red-700",
  }

  function dueLabel(dueAt: string, overdue: boolean) {
    const diff = Math.round((new Date(dueAt).getTime() - Date.now()) / 86_400_000)
    if (overdue) return Math.abs(diff) <= 1 ? "hoje" : `${Math.abs(diff)}d atrasado`
    if (diff <= 0) return "hoje"
    if (diff === 1) return "amanhã"
    return `em ${diff}d`
  }

  return (
    <div className="space-y-4">

      {/* Sub-tabs */}
      <div className="flex gap-1 bg-[#F4F6FB] p-1 rounded-xl w-fit">
        {([
          { v: "mensagens",  l: "Mensagens"  },
          { v: "tarefas",    l: "Tarefas"    },
          { v: "concluidas", l: "Concluídas" },
        ] as const).map(({ v, l }) => (
          <button
            key={v}
            onClick={() => setSubTab(v)}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              subTab === v ? "bg-white text-[#4361EE] shadow-sm" : "text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* ── Mensagens ── */}
      {subTab === "mensagens" && (
      <div className="space-y-6">

      {/* Master toggle */}
      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-5">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-bold text-[#0F1E3C]">Mensagens Proativas do Lifecycle</p>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
              {loading ? "Carregando..."
                : lifecycleOn
                  ? "Ativo — D2, D15, D30 e D45 disparando às 07h · cobranças sempre ativas"
                  : "Pausado — chatbot de pedidos e cobranças continuam funcionando"}
            </p>
          </div>
          <button
            onClick={toggleLifecycle}
            disabled={togglingLC || loading}
            className="shrink-0 transition-opacity disabled:opacity-40"
          >
            {lifecycleOn
              ? <ToggleRight size={32} className="text-[#4361EE]" />
              : <ToggleLeft  size={32} className="text-[#0F1E3C]/25" />}
          </button>
        </div>
        {!lifecycleOn && !loading && (
          <div className="mt-3 flex items-center gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5">
            <AlertCircle size={13} className="text-amber-500 shrink-0" />
            <p className="text-xs text-amber-700">
              D2, D15, D30 e D45 pausados. Cobranças de prazo e chatbot de pedidos continuam normais.
            </p>
          </div>
        )}
        {/* Legenda do toggle */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 bg-[#F4F6FB] rounded-xl px-3 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#4361EE] shrink-0" />
            <p className="text-[10px] text-[#0F1E3C]/50 font-medium">Controlado pelo toggle: D2, D15, D30, D45</p>
          </div>
          <div className="flex items-center gap-2 bg-[#F4F6FB] rounded-xl px-3 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <p className="text-[10px] text-[#0F1E3C]/50 font-medium">Sempre ativo: cobranças de vencimento</p>
          </div>
        </div>
      </div>

      {/* Funil do lifecycle */}
      {LC_SECTIONS.map((section, si) => (
        <div key={section.id} className="space-y-2">
          {/* Section header */}
          <div className="flex items-center gap-3">
            <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider">{section.label}</p>
            <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${section.badgeCls}`}>
              {section.state}
            </span>
            {si < LC_SECTIONS.length - 1 && (
              <div className="flex-1 h-px bg-[#0F1E3C]/6" />
            )}
          </div>

          {/* Steps */}
          <div className="space-y-2 pl-3 border-l-2 border-[#0F1E3C]/6 ml-1">
            {section.steps.map((step, idx) => (
              step.type === "msg" ? (
                <div key={step.key} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-bold text-[#0F1E3C]">{step.title}</p>
                      <span className="inline-block mt-1 text-[10px] font-semibold text-[#0F1E3C]/40 bg-[#F4F6FB] px-2 py-0.5 rounded-full">
                        {step.chip}
                      </span>
                    </div>
                    {!lifecycleOn && (
                      <span className="text-[10px] font-bold bg-slate-100 text-slate-400 px-2 py-0.5 rounded-full shrink-0 mt-0.5">
                        pausado
                      </span>
                    )}
                  </div>
                  <textarea
                    value={settings[step.key] ?? ""}
                    onChange={e => setSetting(step.key, e.target.value)}
                    rows={3}
                    placeholder={LC_DEFAULTS[step.key]}
                    disabled={loading}
                    className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 disabled:bg-[#F9FAFC] disabled:text-[#0F1E3C]/40 placeholder:text-[#0F1E3C]/20"
                  />
                  <p className="text-[10px] text-[#0F1E3C]/30">
                    Use <code className="bg-[#F4F6FB] px-1 rounded">{"{nome}"}</code> para o primeiro nome
                  </p>
                </div>
              ) : (
                <div key={`${section.id}-silent-${idx}`} className="flex items-start gap-3 bg-[#F9FAFC] rounded-xl border border-dashed border-[#0F1E3C]/10 px-4 py-3">
                  <div className="w-5 h-5 rounded-full bg-slate-100 flex items-center justify-center shrink-0 mt-0.5">
                    <div className="w-1.5 h-1.5 rounded-full bg-slate-300" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-[#0F1E3C]/40">{step.title}</p>
                    <p className="text-[11px] text-[#0F1E3C]/30 mt-0.5">{step.desc}</p>
                  </div>
                </div>
              )
            ))}
          </div>
        </div>
      ))}

      {/* Cobrança — sempre ativa */}
      <div className="space-y-2">
        <div className="flex items-center gap-3">
          <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider">COBRANÇA</p>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-600 border border-emerald-200">
            sempre ativa
          </span>
          <div className="flex-1 h-px bg-[#0F1E3C]/6" />
        </div>

        <div className="pl-3 border-l-2 border-[#0F1E3C]/6 ml-1 space-y-2">
          {/* Cobrança individual */}
          <div className="bg-[#F9FAFC] rounded-2xl border border-[#0F1E3C]/8 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-[#0F1E3C]">D0 — Vencimento por pedido</p>
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">prazo em dias</span>
            </div>
            <div className="bg-white rounded-xl border border-[#0F1E3C]/6 px-3 py-2.5">
              <p className="text-xs text-[#0F1E3C]/60 font-mono leading-relaxed">
                Oi <span className="text-[#4361EE] font-semibold">[nome]</span>, o pagamento do pedido <span className="text-[#4361EE] font-semibold">[número]</span> vence hoje — <span className="text-[#4361EE] font-semibold">[valor]</span>. Qualquer dúvida é só chamar!
              </p>
            </div>
          </div>

          {/* Cobrança agrupada */}
          <div className="bg-[#F9FAFC] rounded-2xl border border-[#0F1E3C]/8 p-4 space-y-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-bold text-[#0F1E3C]">D0 — Vencimento agrupado por cliente</p>
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">data fixa</span>
            </div>
            <div className="bg-white rounded-xl border border-[#0F1E3C]/6 px-3 py-2.5">
              <p className="text-xs text-[#0F1E3C]/60 font-mono leading-relaxed">
                Oi <span className="text-[#4361EE] font-semibold">[nome]</span>! Os pedidos <span className="text-[#4361EE] font-semibold">[números]</span> vencem hoje — total: <span className="text-[#4361EE] font-semibold">[valor total]</span>. Pode efetuar o pagamento quando puder!
              </p>
            </div>
            <p className="text-[10px] text-[#0F1E3C]/30">Mensagens hardcoded. Edição de templates de cobrança disponível em breve.</p>
          </div>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button
          onClick={saveMessages}
          disabled={saving || loading}
          className="flex items-center gap-2 px-5 py-2.5 bg-[#4361EE] hover:bg-[#3451d1] text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
        >
          {saving ? <Loader2 size={14} className="animate-spin" />
            : saved  ? <CheckCircle size={14} />
            : <Save size={14} />}
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar mensagens"}
        </button>
      </div>

      </div>
      )} {/* end mensagens */}

      {/* ── Tarefas ── */}
      {subTab === "tarefas" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs text-[#0F1E3C]/40">Próximos disparos por cliente · ordenados por data</p>
            <button
              onClick={() => {
                setTasksLoading(true)
                fetch("/api/marketing/lifecycle?view=tasks")
                  .then(r => r.json())
                  .then((d: LifecycleTaskItem[]) => setTasks(Array.isArray(d) ? d : []))
                  .finally(() => setTasksLoading(false))
              }}
              className="p-1.5 rounded-lg text-[#0F1E3C]/30 hover:text-[#0F1E3C] transition-colors"
            >
              <RefreshCw size={13} className={tasksLoading ? "animate-spin" : ""} />
            </button>
          </div>

          {tasksLoading ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-[#4361EE]" /></div>
          ) : tasks.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-10 text-center">
              <CheckCircle size={22} className="mx-auto text-[#0F1E3C]/15 mb-2" />
              <p className="text-xs font-bold text-[#0F1E3C]/30">Nenhuma tarefa pendente</p>
              <p className="text-[10px] text-[#0F1E3C]/20 mt-0.5">Todos os clientes estão em dia</p>
            </div>
          ) : (
            <div className="space-y-2">
              {tasks.map((t, i) => {
                const dueDateStr = new Date(t.due_at).toLocaleDateString("pt-BR", {
                  day: "2-digit", month: "2-digit", timeZone: TZ_BR,
                })
                const isOverdue = t.overdue === true || String(t.overdue) === "t"
                const relLabel  = dueLabel(t.due_at, isOverdue)
                return (
                  <div
                    key={i}
                    className={`bg-white rounded-xl border px-4 py-3 flex items-center gap-3 ${
                      isOverdue ? "border-red-200" : "border-[#0F1E3C]/8"
                    }`}
                  >
                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STAGE_CLS[t.stage] ?? "bg-slate-100 text-slate-600"}`}>
                      {t.stage}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-[#0F1E3C] truncate">{t.name ?? t.phone ?? "—"}</p>
                      {t.name && t.phone && (
                        <p className="text-[11px] text-[#0F1E3C]/35 truncate">{t.phone}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <p className={`text-xs font-bold ${isOverdue ? "text-red-500" : "text-[#0F1E3C]/60"}`}>{dueDateStr}</p>
                      <p className={`text-[10px] ${isOverdue ? "text-red-400" : "text-[#0F1E3C]/30"}`}>{relLabel}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Concluídas ── */}
      {subTab === "concluidas" && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            {(["today", "7d", "30d"] as const).map(p => (
              <button
                key={p}
                onClick={() => setCompletedPeriod(p)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                  completedPeriod === p
                    ? "bg-[#4361EE] text-white"
                    : "bg-[#F4F6FB] text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
                }`}
              >
                {p === "today" ? "Hoje" : p === "7d" ? "7 dias" : "30 dias"}
              </button>
            ))}
            <button
              onClick={() => {
                setCompletedLoading(true)
                fetch(`/api/marketing/lifecycle?view=completed&period=${completedPeriod}`)
                  .then(r => r.json())
                  .then((d: LifecycleCompletedItem[]) => setCompleted(Array.isArray(d) ? d : []))
                  .finally(() => setCompletedLoading(false))
              }}
              className="ml-auto p-1.5 rounded-lg text-[#0F1E3C]/30 hover:text-[#0F1E3C] transition-colors"
            >
              <RefreshCw size={13} className={completedLoading ? "animate-spin" : ""} />
            </button>
          </div>

          {completedLoading ? (
            <div className="flex justify-center py-10"><Loader2 size={20} className="animate-spin text-[#4361EE]" /></div>
          ) : completed.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-10 text-center">
              <CheckCircle size={22} className="mx-auto text-[#0F1E3C]/15 mb-2" />
              <p className="text-xs font-bold text-[#0F1E3C]/30">Nenhum envio nesse período</p>
              <p className="text-[10px] text-[#0F1E3C]/20 mt-0.5">Mensagens enviadas pelo lifecycle aparecem aqui</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completed.map(c => (
                <div key={c.id} className="bg-white rounded-xl border border-[#0F1E3C]/8 px-4 py-3 flex items-center gap-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STAGE_CLS[c.stage] ?? "bg-slate-100 text-slate-600"}`}>
                    {c.stage}
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-[#0F1E3C] truncate">{c.contactName ?? c.phone ?? "—"}</p>
                    {c.contactName && c.phone && (
                      <p className="text-[11px] text-[#0F1E3C]/35 truncate">{c.phone}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <CheckCircle size={12} className="text-emerald-500" />
                    <span className="text-xs text-[#0F1E3C]/40 tabular-nums">{fmtBR(c.sentAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const [tab,              setTab]             = useState<"campanhas" | "lifecycle">("campanhas")
  const [stats,            setStats]           = useState<Stats | null>(null)
  const [groups,           setGroups]          = useState<Group[]>([])
  const [campaigns,        setCampaigns]       = useState<Campaign[]>([])
  const [schedules,        setSchedules]       = useState<Schedule[]>([])
  const [loading,          setLoading]         = useState(true)
  const [createDrawer,     setCreateDrawer]    = useState(false)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null)
  const [scheduleEditIntent, setScheduleEditIntent] = useState(false)

  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const pollingIdRef = useRef<number | null>(null)

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [sR, gR, cR, scR] = await Promise.all([
      fetch("/api/marketing/stats"),
      fetch("/api/marketing/groups"),
      fetch("/api/marketing/campaigns"),
      fetch("/api/marketing/schedules"),
    ])
    if (sR.ok) setStats(await sR.json())
    if (gR.ok) setGroups(await gR.json())
    if (cR.ok) setCampaigns(await cR.json())
    if (scR.ok) setSchedules(await scR.json())
    setLoading(false)
  }, [])

  function stopPolling() {
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
    pollingIdRef.current = null
  }

  const tickCampaign = useCallback(async (campaignId: number) => {
    try {
      const r = await fetch("/api/marketing/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignId }),
      })
      if (!r.ok) return
      const d = await r.json() as { done: boolean; status: string; sentCount: number; totalCount: number; pauseReason: string | null }
      setCampaigns(prev => prev.map(c =>
        c.id === campaignId
          ? { ...c, sentCount: d.sentCount, totalCount: d.totalCount, status: d.status }
          : c
      ))
      if (d.done) stopPolling()
    } catch { /* retry next tick */ }
  }, [])

  function startPolling(campaignId: number) {
    stopPolling()
    pollingIdRef.current = campaignId
    tickCampaign(campaignId)
    tickRef.current = setInterval(() => tickCampaign(campaignId), 30_000)
  }

  useEffect(() => {
    const active = campaigns.find(c => c.status === "sending" || c.status === "generating")
    if (active && pollingIdRef.current !== active.id) startPolling(active.id)
    else if (!active && pollingIdRef.current !== null) stopPolling()
  }, [campaigns])

  useEffect(() => () => { if (tickRef.current) clearInterval(tickRef.current) }, [])

  // Sync open modals when list refreshes
  useEffect(() => {
    if (selectedCampaign) {
      const updated = campaigns.find(c => c.id === selectedCampaign.id)
      setSelectedCampaign(updated ?? null)
    }
  }, [campaigns])

  useEffect(() => {
    if (selectedSchedule) {
      const updated = schedules.find(s => s.id === selectedSchedule.id)
      setSelectedSchedule(updated ?? null)
    }
  }, [schedules])

  useEffect(() => {
    fetch("/api/marketing/migrate", { method: "POST" }).then(() => loadAll())
  }, [loadAll])

  function handleCampaignCreated(campaignId: number, sendNow: boolean) {
    loadAll().then(() => { if (sendNow) startPolling(campaignId) })
  }

  async function cancelCampaign(id: number) {
    if (pollingIdRef.current === id) stopPolling()
    await fetch(`/api/marketing/campaigns/${id}`, { method: "DELETE" })
    await loadAll()
  }

  async function toggleSchedule(s: Schedule) {
    await fetch(`/api/marketing/schedules/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    })
    loadAll()
  }

  // ─── Campaign card (coluna esquerda) ─────────────────────────────────────
  function CampaignCard({ c }: { c: Campaign }) {
    const sm = STATUS_META[c.status] ?? { label: c.status, cls: "bg-slate-100 text-slate-500" }
    const isSending = c.status === "sending"

    const statusLabel = (() => {
      if (c.status === "cancelled" && c.executedAt) {
        const d = new Date(c.executedAt).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ_BR })
        return { text: `Cancelado em ${d}`, cls: "bg-slate-100 text-slate-500" }
      }
      return { text: sm.label, cls: sm.cls }
    })()

    return (
      <div
        onClick={() => setSelectedCampaign(c)}
        className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm px-4 py-3.5 cursor-pointer hover:border-[#4361EE]/30 transition-colors"
      >
        <div className="flex items-start gap-3">
          {c.mediaUrl && (
            <img src={c.mediaUrl} alt="" className="h-12 w-12 rounded-xl object-cover border border-[#0F1E3C]/8 flex-shrink-0" />
          )}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {c.title && <p className="text-sm font-bold text-[#0F1E3C]">{c.title}</p>}
              {isSending ? (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  <Loader2 size={8} className="animate-spin" /> {c.sentCount}/{c.totalCount}
                </span>
              ) : (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${statusLabel.cls}`}>{statusLabel.text}</span>
              )}
            </div>
            <p className="text-xs text-[#0F1E3C]/50 mt-1 truncate">{c.content}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-[11px] text-[#0F1E3C]/35">
                {c.audienceType === "groups" ? `${c.audienceGroupJids.length} grupo(s)`
                  : c.audienceType === "lifecycle" ? (LIFECYCLE_OPTS.find(o => o.value === (c.audienceLifecycle ?? "all"))?.label ?? "—")
                  : "Clientes + grupos"}
              </span>
              {c.scheduledAt && (
                <span className="text-[11px] text-[#0F1E3C]/35 flex items-center gap-1"><Clock size={9} /> {fmtBR(c.scheduledAt)}</span>
              )}
              {c.status === "sent" && (
                <span className="text-[11px] text-emerald-600 flex items-center gap-1">
                  <CheckCircle size={9} /> {c.sentCount} enviados{c.errorCount > 0 ? ` · ${c.errorCount} erros` : ""}
                </span>
              )}
              {isSending && <span className="text-[11px] text-blue-500">~30s</span>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
            Marketing
          </h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Campanhas e programação de mensagens</p>
        </div>
        <button onClick={loadAll} className="p-2 rounded-xl bg-white border border-[#0F1E3C]/8 text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
          <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Users size={14} className="text-[#0F1E3C]/40" />
            <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider">Total</p>
          </div>
          <p className="text-2xl font-black text-[#0F1E3C]">{loading ? "—" : stats?.total ?? 0}</p>
          <p className="text-[10px] text-[#0F1E3C]/30 mt-0.5">clientes</p>
        </div>
        {Object.entries(STATE_META).map(([key, meta]) => {
          const count = Number(stats?.byState.find(s => s.state === key)?.total ?? 0)
          return (
            <div key={key} className={`rounded-2xl border p-4 shadow-sm ${meta.bg}`}>
              <p className={`text-[10px] font-bold uppercase tracking-wider mb-1 ${meta.color}`}>{meta.label}</p>
              <p className={`text-2xl font-black ${meta.color}`}>{loading ? "—" : count}</p>
            </div>
          )
        })}
      </div>

      {/* Tabs — 2 apenas */}
      <div className="flex gap-1 bg-[#F4F6FB] p-1 rounded-xl w-fit">
        {([
          { v: "campanhas", l: "Campanhas",  Icon: Megaphone         },
          { v: "lifecycle", l: "Lifecycle",  Icon: SlidersHorizontal },
        ] as const).map(({ v, l, Icon }) => (
          <button
            key={v}
            onClick={() => setTab(v)}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-bold transition-colors ${
              tab === v ? "bg-white text-[#4361EE] shadow-sm" : "text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
            }`}
          >
            <Icon size={13} />{l}
          </button>
        ))}
      </div>

      {/* ── Campanhas ── */}
      {tab === "campanhas" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[#0F1E3C]">Campanhas</p>
            <button
              onClick={() => setCreateDrawer(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#4361EE] hover:bg-[#3451d1] text-white text-xs font-bold rounded-xl transition-colors"
            >
              <Plus size={13} /> Criar
            </button>
          </div>

          <MarketingMonitor />

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[#4361EE]" /></div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">

              {/* Coluna 1 — Mensagens Diretas */}
              <div className="space-y-3">
                <p className="text-[11px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider flex items-center gap-1.5">
                  <Send size={11} /> Mensagens Diretas
                </p>
                {campaigns.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-8 text-center">
                    <Megaphone size={22} className="mx-auto text-[#0F1E3C]/15 mb-2" />
                    <p className="text-xs font-bold text-[#0F1E3C]/30">Nenhuma campanha</p>
                    <p className="text-[10px] text-[#0F1E3C]/20 mt-0.5">Envios únicos aparecem aqui</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {campaigns.map(c => <CampaignCard key={c.id} c={c} />)}
                  </div>
                )}
              </div>

              {/* Coluna 2 — Programação */}
              <div className="space-y-3">
                <p className="text-[11px] font-bold text-[#0F1E3C]/40 uppercase tracking-wider flex items-center gap-1.5">
                  <CalendarClock size={11} /> Programação
                </p>
                {schedules.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-8 text-center">
                    <CalendarClock size={22} className="mx-auto text-[#0F1E3C]/15 mb-2" />
                    <p className="text-xs font-bold text-[#0F1E3C]/30">Nenhuma programação</p>
                    <p className="text-[10px] text-[#0F1E3C]/20 mt-0.5">Mensagens recorrentes aparecem aqui</p>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {schedules.map(s => (
                      <ScheduleCard
                        key={s.id}
                        schedule={s}
                        groups={groups}
                        onToggle={() => toggleSchedule(s)}
                        onDelete={loadAll}
                        onClick={() => { setScheduleEditIntent(false); setSelectedSchedule(s) }}
                        onEdit={() => { setScheduleEditIntent(true); setSelectedSchedule(s) }}
                      />
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      )}

      {/* ── Lifecycle ── */}
      {tab === "lifecycle" && <LifecycleTab />}

      {/* Drawer unificado */}
      <UnifiedDrawer
        open={createDrawer}
        onClose={() => setCreateDrawer(false)}
        groups={groups}
        stats={stats}
        onCampaignCreated={handleCampaignCreated}
        onScheduleCreated={loadAll}
      />

      {/* Modal de campanha */}
      {selectedCampaign && (
        <CampaignModal
          campaign={selectedCampaign}
          onClose={() => setSelectedCampaign(null)}
          onCancel={cancelCampaign}
        />
      )}

      {/* Modal de programação */}
      {selectedSchedule && (
        <ScheduleModal
          schedule={selectedSchedule}
          groups={groups}
          stats={stats}
          startInEdit={scheduleEditIntent}
          onClose={() => { setSelectedSchedule(null); setScheduleEditIntent(false) }}
          onToggle={() => toggleSchedule(selectedSchedule)}
          onRefresh={loadAll}
        />
      )}
    </div>
  )
}

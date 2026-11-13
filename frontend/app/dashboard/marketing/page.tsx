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
  instanceName: string | null
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
  onCampaignCreated: (ids: number[], sendNow: boolean) => void
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
        const { ids, sendNow: sn } = await r.json() as { ids: number[]; sendNow: boolean }
        onCampaignCreated(ids, sn)
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

// ─── Números de Marketing + Monitor de Envio ──────────────────────────────────

type MonitorCampaign = {
  id: number; title: string; content: string
  sentCount: number; errorCount: number; totalCount: number
  status: string; contentVariants: string[] | null
  pauseReason: string | null; pausedUntil: string | null
  instanceName: string | null; createdAt: string
}
type MonitorInstance = {
  id: number; instanceName: string; label: string; active: boolean
  state: "connected" | "disconnected"
}
type MonitorData = { campaigns: MonitorCampaign[]; instances: MonitorInstance[] }

function InstancesPanel({ instances }: { instances: MonitorInstance[] }) {
  const [selectedId, setSelectedId] = useState<number | null>(null)

  const connectedCount = instances.filter(i => i.state === "connected").length
  const selected = instances.find(i => i.id === selectedId) ?? null

  return (
    <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-[0_1px_2px_rgba(15,30,60,.04),0_8px_24px_-8px_rgba(15,30,60,.08)] overflow-hidden mb-4">
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-[#0F1E3C]/6">
        <p className="text-xs font-bold text-[#0F1E3C]">Números de Marketing</p>
        <a href="/dashboard/settings/whatsapp"
          className="text-[10px] font-bold text-[#3451d1] hover:underline px-1.5 py-1">
          Gerenciar em Configurações →
        </a>
      </div>

      {instances.length === 0 ? (
        <p className="text-xs text-[#0F1E3C]/35 px-4 py-4">
          Nenhum número cadastrado ainda — envio pra cliente cai no número principal enquanto isso.
        </p>
      ) : (
        <div className="flex flex-wrap gap-2 p-3.5">
          {instances.map((inst, i) => {
            const isOn = inst.state === "connected"
            return (
              <button key={inst.id} onClick={() => setSelectedId(v => v === inst.id ? null : inst.id)}
                title={inst.label}
                className={`flex flex-col items-center gap-1.5 py-3 w-16 flex-shrink-0 rounded-2xl border transition-colors ${
                  isOn ? "bg-emerald-50 border-emerald-200" : "bg-[#F9FAFC] border-[#0F1E3C]/8 opacity-60"
                } ${selectedId === inst.id ? "ring-2 ring-[#4361EE]/40" : ""}`}>
                <span className={`w-2 h-2 rounded-full ${isOn ? "bg-emerald-500 shadow-[0_0_0_3px_rgba(5,150,105,.16)]" : "bg-[#0F1E3C]/15"}`} />
                <span className={`text-base font-black ${isOn ? "text-emerald-600" : "text-[#0F1E3C]/35"}`}>{i + 1}</span>
                <span className={`text-[8px] font-bold uppercase tracking-wide ${isOn ? "text-emerald-600" : "text-[#0F1E3C]/30"}`}>
                  {isOn ? "Online" : "Sem QR"}
                </span>
              </button>
            )
          })}
        </div>
      )}

      {instances.length > 0 && (
        <div className="flex items-center justify-between px-4 py-2.5 bg-[#F9FAFC] border-t border-[#0F1E3C]/6">
          <p className="text-[10.5px] text-[#0F1E3C]/50"><b className="text-[#0F1E3C] font-extrabold">{connectedCount}</b> de {instances.length} conectados</p>
          <p className="text-[10.5px] text-[#0F1E3C]/50">Próxima campanha divide em <b className="text-[#0F1E3C] font-extrabold">{Math.max(1, connectedCount)}</b> fatia{connectedCount !== 1 ? "s" : ""}</p>
        </div>
      )}

      {selected && (
        <div className="flex items-center justify-between px-4 py-2.5 border-t border-[#0F1E3C]/6">
          <div className="min-w-0">
            <p className="text-xs font-bold text-[#0F1E3C] truncate">{selected.label}</p>
            <p className="text-[10px] text-[#0F1E3C]/35 truncate">{selected.instanceName}</p>
          </div>
          {!selected.active && <span className="text-[9px] font-bold bg-slate-100 text-slate-400 px-1.5 py-0.5 rounded-full flex-shrink-0">Pausado</span>}
        </div>
      )}
    </div>
  )
}

function MarketingMonitor() {
  const [data, setData] = useState<MonitorData | null>(null)
  const [resumingId, setResumingId] = useState<number | null>(null)

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

  async function resume(campaignId: number) {
    setResumingId(campaignId)
    await fetch(`/api/marketing/campaigns/${campaignId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "resume" }),
    })
    await load()
    setResumingId(null)
  }

  if (!data) return null
  const { campaigns, instances } = data

  return (
    <>
      <InstancesPanel instances={instances} />

      {campaigns.length > 0 && (
        <div className="flex items-baseline justify-between mb-2.5 mt-5">
          <p className="text-[11px] font-bold uppercase tracking-wider text-[#0F1E3C]/35">Envios agora</p>
        </div>
      )}

      {campaigns.map(campaign => {
        const isGenerating = campaign.status === "generating"
        const isPausedCooldown = campaign.pauseReason === "batch_cooldown"
        const isPausedDown = campaign.pauseReason === "disconnected"
        const instIdx = instances.findIndex(i => i.instanceName === campaign.instanceName)
        const inst = instIdx >= 0 ? instances[instIdx] : null
        const numberLabel = inst?.label ?? (campaign.instanceName ? campaign.instanceName : "Número principal")
        const badgeCls = BADGE_COLORS[Math.max(0, instIdx) % BADGE_COLORS.length]
        const pill = isPausedDown ? { label: "Caído", cls: "bg-red-50 text-red-600 border-red-200" }
          : isPausedCooldown ? { label: "Em pausa", cls: "bg-amber-50 text-amber-600 border-amber-200" }
          : isGenerating ? { label: "Preparando", cls: "bg-purple-50 text-purple-600 border-purple-200" }
          : { label: "Enviando", cls: "bg-blue-50 text-blue-600 border-blue-200" }
        const pct = campaign.totalCount > 0 ? Math.min(100, (campaign.sentCount / campaign.totalCount) * 100) : 0

        return (
          <div key={campaign.id} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-[0_1px_2px_rgba(15,30,60,.04),0_8px_24px_-8px_rgba(15,30,60,.08)] overflow-hidden mb-3">
            <div className="flex items-center justify-between px-4 py-3 border-b border-[#0F1E3C]/6">
              <div className="flex items-center gap-2 min-w-0">
                <span className={`w-[22px] h-[22px] rounded-lg flex items-center justify-center text-[10px] font-extrabold flex-shrink-0 ${badgeCls}`}>
                  {instIdx >= 0 ? instIdx + 1 : "•"}
                </span>
                <div className="min-w-0">
                  <p className="text-xs font-extrabold text-[#0F1E3C] truncate">{numberLabel}</p>
                  {campaign.instanceName && <p className="text-[9.5px] text-[#0F1E3C]/35 truncate">{campaign.instanceName}</p>}
                </div>
              </div>
              <span className={`text-[9.5px] font-extrabold px-2.5 py-1 rounded-full border flex-shrink-0 ${pill.cls}`}>{pill.label}</span>
            </div>

            <div className="p-4">
              {isGenerating ? (
                <>
                  <div className="h-[9px] rounded-md bg-[#F4F6FB] overflow-hidden mb-2">
                    <div className="h-full rounded-md bg-gradient-to-r from-[#7C3AED] to-[#4361EE] animate-pulse" style={{ width: "60%" }} />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] text-[#0F1E3C]/50">Gerando textos com IA para <b className="text-[#0F1E3C] font-extrabold">{campaign.totalCount}</b> clientes</span>
                    <span className="text-[10px] text-[#0F1E3C]/35">a fila começa sozinha</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-[9px] rounded-md bg-[#F4F6FB] overflow-hidden mb-2">
                    <div
                      className={`h-full rounded-md transition-all ${
                        isPausedDown ? "bg-[#0F1E3C]/15" : isPausedCooldown ? "bg-amber-500/60" : "bg-gradient-to-r from-[#4361EE] to-[#7C3AED]"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-[10.5px] text-[#0F1E3C]/50">
                      Enviados: <b className="text-[#0F1E3C] font-extrabold">{campaign.sentCount}</b> / {campaign.totalCount}
                      {campaign.errorCount > 0 && <> · Erros: <b className="text-red-500 font-extrabold">{campaign.errorCount}</b></>}
                    </span>
                    {!isPausedDown && !isPausedCooldown && <span className="text-[10px] text-[#0F1E3C]/35">8-20s por envio</span>}
                  </div>
                </>
              )}

              {isPausedDown && (
                <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5 mt-3">
                  <AlertCircle size={14} className="text-red-500 shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <p className="text-xs text-red-700"><strong>{numberLabel} caiu.</strong> Envio pausado pra não arriscar mais.</p>
                    <button onClick={() => resume(campaign.id)} disabled={resumingId === campaign.id}
                      className="mt-2 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-red-600 text-white text-[11px] font-bold hover:bg-red-700 disabled:opacity-50 transition-colors">
                      {resumingId === campaign.id ? <Loader2 size={11} className="animate-spin" /> : null}
                      Já reconectei, retomar envio
                    </button>
                  </div>
                </div>
              )}

              {isPausedCooldown && (
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2.5 mt-3">
                  <Clock size={14} className="text-amber-500 shrink-0 mt-0.5" />
                  <div>
                    <p className="text-xs text-amber-700"><strong>Pausa programada anti-spam.</strong> 30 mensagens enviadas — respirando antes de continuar.</p>
                    {campaign.pausedUntil && (
                      <p className="text-[10px] text-amber-600/70 mt-0.5">
                        Retoma sozinho às {new Date(campaign.pausedUntil).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} — não precisa fazer nada.
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )
      })}
    </>
  )
}

const BADGE_COLORS = [
  "bg-[#4361EE]/12 text-[#3451D4]",
  "bg-[#7C3AED]/12 text-[#6B2FD1]",
  "bg-emerald-500/12 text-emerald-600",
  "bg-amber-500/12 text-amber-600",
  "bg-rose-500/12 text-rose-600",
]

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
                <p className="text-[10px] font-bold text-[#0F1E3C]/35 uppercase tracking-wider">
                  {items.length > 1 ? "Rotaciona — próximo é o mais antigo" : "Só 1 item cadastrado — sem rotação, sempre sai esse. Adicione mais pra variar."}
                </p>

                {loadingQ ? (
                  <div className="flex justify-center py-4"><Loader2 size={16} className="animate-spin text-[#4361EE]" /></div>
                ) : items.length === 0 ? (
                  <p className="text-xs text-[#0F1E3C]/30 text-center py-3">Fila vazia. Adicione conteúdo abaixo.</p>
                ) : (
                  <div className="space-y-2">
                    {items.map((item, idx) => (
                      <div key={item.id} className="flex gap-2 items-start bg-[#F9FAFC] rounded-xl p-3 border border-[#0F1E3C]/6">
                        <span className={`text-[9px] font-bold mt-0.5 w-9 shrink-0 ${idx === 0 ? "text-[#4361EE]" : "text-[#0F1E3C]/25"}`}>
                          {idx === 0 ? "PRÓXIMO" : idx + 1}
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
                            {item.sentCount > 0 && <span className="text-[9px] text-emerald-600 font-bold">{item.sentCount}× enviado (desde sempre)</span>}
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
                  {!editingItemId && (
                    <p className="text-[10px] text-[#0F1E3C]/35 -mt-1">Não envia agora — só entra na rotação pro dia em que for a vez dele.</p>
                  )}
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
    label: "CLIENTE NOVO",
    state: "ainda não comprou",
    badgeCls: "bg-blue-50 text-blue-600 border border-blue-200",
    steps: [
      { type: "msg",    key: "novo_d2_msg",    title: "2 dias sem comprar",          chip: "Sai uma vez, 48 h depois do cadastro" },
      { type: "silent", title: "Não respondeu a primeira",                                desc: "7 dias depois, sem resposta: o cliente vira frio. Não manda mensagem." },
    ],
  },
  {
    id: "ativo",
    label: "CLIENTE QUE JÁ COMPROU",
    state: "comprou há pouco",
    badgeCls: "bg-emerald-50 text-emerald-600 border border-emerald-200",
    steps: [
      { type: "msg",    key: "ausente_d15_msg", title: "15 dias sem comprar",    chip: "Sai uma vez e o cliente passa pra sumido" },
    ],
  },
  {
    id: "ausente",
    label: "CLIENTE SUMIDO",
    state: "parou de comprar",
    badgeCls: "bg-amber-50 text-amber-600 border border-amber-200",
    steps: [
      { type: "msg",    key: "ausente_d30_msg", title: "30 dias sem comprar",        chip: "Segunda tentativa" },
      { type: "msg",    key: "ausente_d45_msg", title: "45 dias sem comprar",          chip: "Última mensagem" },
      { type: "silent", title: "Não respondeu a última",                              desc: "30 dias depois, sem resposta: o cliente vira frio. Não manda mensagem." },
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

  const STAGE_LBL: Record<string, string> = { D2: "2 dias", D15: "15 dias", D30: "30 dias", D45: "45 dias" }

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
          { v: "tarefas",    l: "Próximas"   },
          { v: "concluidas", l: "Enviadas"   },
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
            <p className="text-sm font-bold text-[#0F1E3C]">Mensagens automáticas</p>
            <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
              {loading ? "Carregando..."
                : lifecycleOn
                  ? "Ligadas: saem sozinhas às 7h conforme o cliente fica sem comprar. Cobrança sempre ligada"
                  : "Desligadas. Cobrança de vencimento e chatbot de pedidos continuam funcionando"}
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
              As mensagens de 2, 15, 30 e 45 dias estão paradas. Cobrança e chatbot de pedidos continuam normais.
            </p>
          </div>
        )}
        {/* Legenda do toggle */}
        <div className="mt-4 grid grid-cols-2 gap-2">
          <div className="flex items-center gap-2 bg-[#F4F6FB] rounded-xl px-3 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-[#4361EE] shrink-0" />
            <p className="text-[10px] text-[#0F1E3C]/50 font-medium">Esta chave liga e desliga: 2, 15, 30 e 45 dias</p>
          </div>
          <div className="flex items-center gap-2 bg-[#F4F6FB] rounded-xl px-3 py-2">
            <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 shrink-0" />
            <p className="text-[10px] text-[#0F1E3C]/50 font-medium">Sempre ligada: cobrança de vencimento</p>
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
              <p className="text-sm font-bold text-[#0F1E3C]">No dia do vencimento (um pedido)</p>
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
              <p className="text-sm font-bold text-[#0F1E3C]">No dia do vencimento (todos os pedidos do cliente)</p>
              <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full">data fixa</span>
            </div>
            <div className="bg-white rounded-xl border border-[#0F1E3C]/6 px-3 py-2.5">
              <p className="text-xs text-[#0F1E3C]/60 font-mono leading-relaxed">
                Oi <span className="text-[#4361EE] font-semibold">[nome]</span>! Os pedidos <span className="text-[#4361EE] font-semibold">[números]</span> vencem hoje — total: <span className="text-[#4361EE] font-semibold">[valor total]</span>. Pode efetuar o pagamento quando puder!
              </p>
            </div>
            <p className="text-[10px] text-[#0F1E3C]/30">Estes textos são fixos por enquanto.</p>
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
            <p className="text-xs text-[#0F1E3C]/40">Próximas mensagens por cliente, da mais próxima pra mais longe</p>
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
                      {STAGE_LBL[t.stage] ?? t.stage}
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
              <p className="text-[10px] text-[#0F1E3C]/20 mt-0.5">As mensagens automáticas enviadas aparecem aqui</p>
            </div>
          ) : (
            <div className="space-y-2">
              {completed.map(c => (
                <div key={c.id} className="bg-white rounded-xl border border-[#0F1E3C]/8 px-4 py-3 flex items-center gap-3">
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0 ${STAGE_CLS[c.stage] ?? "bg-slate-100 text-slate-600"}`}>
                    {STAGE_LBL[c.stage] ?? c.stage}
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

// ─── Listas de grupos (PIV 13/11) ─────────────────────────────────────────────
// Guardadas em app_settings.marketing_listas_grupos (JSON). `uso` liga cada
// programação à lista escolhida: mudou a lista, as programações dela são
// atualizadas junto (a programação continua guardando os jids, o motor de envio
// não muda).

type ListaGrupos = { id: number; nome: string; jids: string[] }
type ListasStore = { listas: ListaGrupos[]; uso: Record<string, number> }

const LISTAS_KEY = "marketing_listas_grupos"

function lerListas(raw: string | undefined): ListasStore {
  try {
    const d = JSON.parse(raw || "{}")
    return { listas: Array.isArray(d.listas) ? d.listas : [], uso: d.uso && typeof d.uso === "object" ? d.uso : {} }
  } catch { return { listas: [], uso: {} } }
}

async function salvarListas(store: ListasStore) {
  await fetch("/api/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ [LISTAS_KEY]: JSON.stringify(store) }),
  })
}

const mesmoConjunto = (a: string[], b: string[]) => a.length === b.length && a.every(x => b.includes(x))

function diasLabel(d: number[]) {
  const s = [...d].sort().join()
  if (d.length === 7) return "Todo dia"
  if (s === "1,2,3,4,5") return "Seg a Sex"
  if (s === "1,2,3,4,5,6") return "Seg a Sáb"
  return d.map(x => DAYS[x]).join(", ")
}

function nomeDosGrupos(s: { id: number; audienceGroupJids: string[] }, store: ListasStore) {
  const l = store.listas.find(l => l.id === store.uso[String(s.id)])
  if (l) return `${l.nome} (${l.jids.length})`
  const igual = store.listas.find(l => mesmoConjunto(l.jids, s.audienceGroupJids))
  if (igual) return `${igual.nome} (${igual.jids.length})`
  return `${s.audienceGroupJids.length} grupo${s.audienceGroupJids.length !== 1 ? "s" : ""}`
}

// ─── Escolher grupos ──────────────────────────────────────────────────────────

function EscolherGrupos({ groups, store, jids, listaId, onChange, onNovaLista }: {
  groups: Group[]
  store: ListasStore
  jids: string[]
  listaId: number | null
  onChange: (jids: string[], listaId: number | null) => void
  onNovaLista: (nome: string, jids: string[]) => Promise<number>
}) {
  const [busca, setBusca] = useState("")
  const [nomeNova, setNomeNova] = useState("")
  const [salvando, setSalvando] = useState(false)
  const q = busca.trim().toLowerCase()
  const vis = groups.filter(g => g.name.toLowerCase().includes(q))

  function marcar(next: string[]) {
    const l = store.listas.find(l => mesmoConjunto(l.jids, next))
    onChange(next, l ? l.id : null)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex gap-1.5 flex-wrap">
        {store.listas.map(l => (
          <button key={l.id} type="button" onClick={() => onChange([...l.jids], l.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-bold border transition-colors ${
              listaId === l.id ? "bg-[#4361EE]/10 border-[#4361EE] text-[#4361EE]" : "bg-white border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:border-[#4361EE]/40"
            }`}>
            {l.nome} ({l.jids.length})
          </button>
        ))}
        <span className={`px-3 py-1.5 rounded-full text-xs font-bold border ${listaId === null ? "bg-[#4361EE]/10 border-[#4361EE] text-[#4361EE]" : "bg-white border-[#0F1E3C]/12 text-[#0F1E3C]/40"}`}>
          Escolhidos na mão
        </span>
      </div>

      <div className="border border-[#0F1E3C]/12 rounded-xl overflow-hidden">
        <div className="flex gap-1.5 p-2 border-b border-[#0F1E3C]/8 flex-wrap">
          <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar grupo"
            className="flex-1 min-w-[120px] border border-[#0F1E3C]/12 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
          <button type="button" onClick={() => marcar(groups.map(g => g.jid))}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#F4F6FB] text-[#0F1E3C]/60 hover:text-[#4361EE]">Marcar todos</button>
          <button type="button" onClick={() => marcar([])}
            className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#F4F6FB] text-[#0F1E3C]/60 hover:text-[#4361EE]">Desmarcar</button>
        </div>
        <div className="max-h-60 overflow-y-auto divide-y divide-[#0F1E3C]/6">
          {groups.length === 0 && <p className="text-xs text-[#0F1E3C]/35 p-3">O WhatsApp da SM não está em nenhum grupo agora.</p>}
          {groups.length > 0 && vis.length === 0 && <p className="text-xs text-[#0F1E3C]/35 p-3">Nenhum grupo com esse nome.</p>}
          {vis.map(g => (
            <label key={g.jid} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#F4F6FB]">
              <input type="checkbox" className="w-4 h-4 accent-[#4361EE]" checked={jids.includes(g.jid)}
                onChange={() => marcar(jids.includes(g.jid) ? jids.filter(j => j !== g.jid) : [...jids, g.jid])} />
              <span className="text-sm text-[#0F1E3C] truncate">{g.name}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center justify-between gap-2 flex-wrap px-3 py-2 bg-[#F4F6FB] border-t border-[#0F1E3C]/8">
          <span className="text-xs font-bold text-[#0F1E3C]">{jids.length} de {groups.length} grupos marcados</span>
          {listaId === null && jids.length > 0 && (
            <span className="flex gap-1.5 flex-wrap">
              <input value={nomeNova} onChange={e => setNomeNova(e.target.value)} placeholder="Nome da nova lista"
                className="w-40 border border-[#0F1E3C]/12 rounded-lg px-2 py-1 text-xs bg-white" />
              <button type="button" disabled={!nomeNova.trim() || salvando}
                onClick={async () => { setSalvando(true); const id = await onNovaLista(nomeNova.trim(), jids); onChange(jids, id); setNomeNova(""); setSalvando(false) }}
                className="px-2.5 py-1 rounded-lg text-xs font-bold bg-white border border-[#0F1E3C]/12 text-[#4361EE] disabled:opacity-40">
                Salvar como lista
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Gaveta: postagem nos grupos ──────────────────────────────────────────────

type PostDraft = { schedule: Schedule | null; item: ScheduleItem | null; itemCount: number; horaSugerida?: string }

function PostagemDrawer({ draft, groups, store, onClose, onSaved, onNovaLista, setUso }: {
  draft: PostDraft
  groups: Group[]
  store: ListasStore
  onClose: () => void
  onSaved: (msg: string) => void
  onNovaLista: (nome: string, jids: string[]) => Promise<number>
  setUso: (scheduleId: number, listaId: number | null) => Promise<void>
}) {
  const s = draft.schedule
  const primeiraLista = store.listas[0]
  const [nome,    setNome]    = useState(s?.name ?? "")
  const [texto,   setTexto]   = useState(draft.item?.content ?? "")
  const [foto,    setFoto]    = useState<string | null>(draft.item?.mediaUrl ?? null)
  const [modo,    setModo]    = useState<"prog" | "agora">("prog")
  const [hora,    setHora]    = useState(s?.timeOfDay?.slice(0, 5) ?? draft.horaSugerida ?? "11:00")
  const [dias,    setDias]    = useState<number[]>(s?.daysOfWeek ?? [1, 2, 3, 4, 5, 6])
  const inicialLista = s ? (store.uso[String(s.id)] ?? store.listas.find(l => mesmoConjunto(l.jids, s.audienceGroupJids))?.id ?? null) : (primeiraLista?.id ?? null)
  const [listaId, setListaId] = useState<number | null>(inicialLista)
  const [jids,    setJids]    = useState<string[]>(s ? s.audienceGroupJids : (primeiraLista ? [...primeiraLista.jids] : []))
  const [saving,  setSaving]  = useState(false)
  const [erro,    setErro]    = useState<string | null>(null)

  async function salvar() {
    if (!texto.trim()) return setErro("Escreve o texto da postagem")
    if (jids.length === 0) return setErro("Marca pelo menos 1 grupo")
    setSaving(true); setErro(null)
    const titulo = nome.trim() || texto.replace(/[*_~]/g, "").split("\n").map(x => x.trim()).find(Boolean)?.slice(0, 50) || "Postagem"
    try {
      if (modo === "agora") {
        const r = await fetch("/api/marketing/campaigns", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ title: titulo, content: texto, mediaUrl: foto, audienceType: "groups", audienceLifecycle: null, audienceGroupJids: jids, scheduledAt: null }),
        })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Erro ao enviar")
        onSaved(`Enviando pra ${jids.length} grupos`); return
      }
      if (dias.length === 0) throw new Error("Escolhe pelo menos 1 dia")
      const meta = { name: titulo, daysOfWeek: dias, timeOfDay: hora, audienceType: "groups", audienceLifecycle: null, audienceGroupJids: jids }
      let id = s?.id
      if (s) {
        const r = await fetch(`/api/marketing/schedules/${s.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Erro ao salvar")
        const r2 = draft.item
          ? await fetch(`/api/marketing/schedules/${s.id}/items/${draft.item.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: texto, mediaUrl: foto }) })
          : await fetch(`/api/marketing/schedules/${s.id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: texto, mediaUrl: foto }) })
        if (!r2.ok) throw new Error("Erro ao salvar o texto")
      } else {
        const r = await fetch("/api/marketing/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(meta) })
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Erro ao criar")
        id = (await r.json()).id
        await fetch(`/api/marketing/schedules/${id}/items`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content: texto, mediaUrl: foto }) })
      }
      if (id) await setUso(id, listaId)
      onSaved(s ? "Postagem salva" : "Postagem programada")
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Erro ao salvar")
    } finally { setSaving(false) }
  }

  const lbl = "text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block"

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
          <h2 className="text-base font-bold text-[#0F1E3C]">{s ? "Editar postagem" : "Nova postagem"}</h2>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:text-[#0F1E3C]">Fechar</button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <ImageUpload value={foto} onChange={setFoto} label="Foto" />

          <div>
            <label className={lbl}>Texto</label>
            <textarea value={texto} onChange={e => setTexto(e.target.value)} rows={8}
              className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
            <p className="text-[11px] text-[#0F1E3C]/40 mt-1">Do jeito que aparece no WhatsApp. *negrito* funciona.</p>
            {draft.itemCount > 1 && <p className="text-[11px] text-amber-700 mt-1">Este horário reveza {draft.itemCount} textos. Aqui você edita o primeiro.</p>}
          </div>

          <div>
            <label className={lbl}>Nome <span className="normal-case font-normal text-[#0F1E3C]/35">(se ficar vazio, usa a 1ª linha do texto)</span></label>
            <input value={nome} onChange={e => setNome(e.target.value)}
              className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
          </div>

          <div>
            <label className={lbl}>Quando</label>
            <div className="flex gap-2">
              {([["prog", "Todo dia no horário"], ["agora", "Uma vez, agora"]] as const).map(([v, l]) => (
                <button key={v} type="button" onClick={() => setModo(v)} disabled={!!s && v === "agora"}
                  className={`flex-1 py-2 rounded-xl text-xs font-bold border transition-colors disabled:opacity-30 ${modo === v ? "border-[#4361EE] bg-[#4361EE]/10 text-[#4361EE]" : "border-[#0F1E3C]/12 text-[#0F1E3C]/60"}`}>{l}</button>
              ))}
            </div>
          </div>

          {modo === "prog" && (
            <>
              <div>
                <label className={lbl}>Horário</label>
                <input type="time" value={hora} onChange={e => setHora(e.target.value)}
                  className="border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
                <span className="text-[11px] text-[#0F1E3C]/40 ml-2">sai em até 5 min do horário</span>
              </div>
              <div>
                <label className={lbl}>Dias</label>
                <div className="flex gap-1.5 flex-wrap">
                  {DAYS.map((d, i) => (
                    <button key={i} type="button" onClick={() => setDias(p => p.includes(i) ? p.filter(x => x !== i) : [...p, i].sort())}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors ${dias.includes(i) ? "bg-[#4361EE] border-[#4361EE] text-white" : "bg-white border-[#0F1E3C]/12 text-[#0F1E3C]/50"}`}>{d}</button>
                  ))}
                </div>
              </div>
            </>
          )}

          <div>
            <label className={lbl}>Onde enviar</label>
            <EscolherGrupos groups={groups} store={store} jids={jids} listaId={listaId}
              onChange={(j, l) => { setJids(j); setListaId(l) }} onNovaLista={onNovaLista} />
          </div>

          {erro && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600">{erro}</p>
            </div>
          )}
        </div>

        <div className="px-5 py-4 border-t border-[#0F1E3C]/8 flex gap-2">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[#0F1E3C]/12 text-[#0F1E3C]/60">Cancelar</button>
          <button onClick={salvar} disabled={saving}
            className="flex-[2] flex items-center justify-center gap-2 py-2.5 bg-[#4361EE] hover:bg-[#3451d1] text-white text-sm font-bold rounded-xl disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : modo === "agora" ? <Send size={14} /> : <CalendarClock size={14} />}
            {modo === "agora" ? "Enviar agora" : s ? "Salvar" : "Programar"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Gaveta: listas de grupos ─────────────────────────────────────────────────

function ListasDrawer({ groups, store, schedules, onClose, onSave }: {
  groups: Group[]
  store: ListasStore
  schedules: Schedule[]
  onClose: () => void
  onSave: (store: ListasStore, mudou: ListaGrupos | null) => Promise<void>
}) {
  const [editando, setEditando] = useState<ListaGrupos | null>(null)
  const [nome, setNome] = useState("")
  const [sel, setSel] = useState<string[]>([])
  const [busca, setBusca] = useState("")
  const [aviso, setAviso] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const nomeG = (j: string) => groups.find(g => g.jid === j)?.name ?? j.split("@")[0]

  function abrir(l: ListaGrupos | null) {
    setEditando(l ?? { id: 0, nome: "", jids: [] }); setNome(l?.nome ?? ""); setSel(l ? [...l.jids] : []); setBusca(""); setAviso(null)
  }

  async function salvarLista() {
    if (!editando) return
    if (!nome.trim()) return setAviso("Dá um nome pra lista")
    if (sel.length === 0) return setAviso("Marca pelo menos 1 grupo")
    setSaving(true)
    const l: ListaGrupos = { id: editando.id || Date.now(), nome: nome.trim(), jids: sel }
    const listas = editando.id ? store.listas.map(x => x.id === l.id ? l : x) : [...store.listas, l]
    await onSave({ ...store, listas }, editando.id ? l : null)
    setEditando(null); setSaving(false)
  }

  async function apagar(l: ListaGrupos) {
    const usa = schedules.filter(s => store.uso[String(s.id)] === l.id).length
    if (usa) return setAviso(`"${l.nome}" está em ${usa} postagem(ns). Troque a lista delas antes de apagar.`)
    await onSave({ ...store, listas: store.listas.filter(x => x.id !== l.id) }, null)
  }

  const q = busca.trim().toLowerCase()

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={onClose} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
          <h2 className="text-base font-bold text-[#0F1E3C]">Listas de grupos</h2>
          <button onClick={onClose} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:text-[#0F1E3C]">Fechar</button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-3">
          <p className="text-xs text-[#0F1E3C]/50">Uma lista junta os grupos que recebem a mesma postagem. Mudou a lista, muda em todas as postagens que usam ela.</p>
          {aviso && <p className="text-xs font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2">{aviso}</p>}

          {!editando && (
            <>
              {store.listas.length === 0 && <p className="text-sm text-[#0F1E3C]/40 py-2">Nenhuma lista ainda.</p>}
              {store.listas.map(l => (
                <div key={l.id} className="border border-[#0F1E3C]/10 rounded-xl px-3.5 py-3 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-[#0F1E3C]">{l.nome} <span className="text-xs font-semibold text-[#0F1E3C]/40">· {l.jids.length} grupos</span></p>
                    <p className="text-[11px] text-[#0F1E3C]/40 truncate">{l.jids.map(nomeG).join(", ")}</p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => abrir(l)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-[#0F1E3C]/70 hover:text-[#4361EE]">Editar</button>
                    <button onClick={() => apagar(l)} className="px-2.5 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-red-500 hover:bg-red-50">Apagar</button>
                  </div>
                </div>
              ))}
              <button onClick={() => abrir(null)} className="w-full py-2.5 rounded-xl text-sm font-bold border border-dashed border-[#4361EE]/40 text-[#4361EE] hover:bg-[#4361EE]/5">+ Nova lista</button>
              <p className="text-[11px] text-[#0F1E3C]/35">Os grupos vêm sozinhos: são os grupos em que o WhatsApp da SM está. Entrou num grupo novo, ele aparece aqui pra marcar.</p>
            </>
          )}

          {editando && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Nome da lista</label>
                <input value={nome} onChange={e => setNome(e.target.value)} autoFocus
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
              </div>
              <div className="border border-[#0F1E3C]/12 rounded-xl overflow-hidden">
                <div className="flex gap-1.5 p-2 border-b border-[#0F1E3C]/8 flex-wrap">
                  <input value={busca} onChange={e => setBusca(e.target.value)} placeholder="Buscar grupo"
                    className="flex-1 min-w-[120px] border border-[#0F1E3C]/12 rounded-lg px-2.5 py-1.5 text-sm" />
                  <button onClick={() => setSel(groups.map(g => g.jid))} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#F4F6FB] text-[#0F1E3C]/60">Marcar todos</button>
                  <button onClick={() => setSel([])} className="px-2.5 py-1.5 rounded-lg text-xs font-bold bg-[#F4F6FB] text-[#0F1E3C]/60">Desmarcar</button>
                </div>
                <div className="max-h-72 overflow-y-auto divide-y divide-[#0F1E3C]/6">
                  {groups.filter(g => g.name.toLowerCase().includes(q)).map(g => (
                    <label key={g.jid} className="flex items-center gap-2.5 px-3 py-2 cursor-pointer hover:bg-[#F4F6FB]">
                      <input type="checkbox" className="w-4 h-4 accent-[#4361EE]" checked={sel.includes(g.jid)}
                        onChange={() => setSel(p => p.includes(g.jid) ? p.filter(j => j !== g.jid) : [...p, g.jid])} />
                      <span className="text-sm text-[#0F1E3C] truncate">{g.name}</span>
                    </label>
                  ))}
                </div>
                <div className="px-3 py-2 bg-[#F4F6FB] border-t border-[#0F1E3C]/8 text-xs font-bold text-[#0F1E3C]">{sel.length} grupos</div>
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditando(null)} className="flex-1 py-2.5 rounded-xl text-sm font-bold border border-[#0F1E3C]/12 text-[#0F1E3C]/60">Cancelar</button>
                <button onClick={salvarLista} disabled={saving} className="flex-[2] flex items-center justify-center gap-2 py-2.5 bg-[#4361EE] text-white text-sm font-bold rounded-xl disabled:opacity-50">
                  {saving && <Loader2 size={14} className="animate-spin" />} Salvar lista
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

function hojeBR() {
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: TZ_BR, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date())
  const g = (t: string) => p.find(x => x.type === t)?.value ?? ""
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(g("weekday"))
  return { data: `${g("year")}-${g("month")}-${g("day")}`, dia: wd, hora: `${g("hour").replace("24", "00")}:${g("minute")}` }
}

function dataBR(iso: string) {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_BR })
}

const DIA_NOME = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"]

export default function MarketingPage() {
  const [tab,              setTab]             = useState<"grupos" | "clientes" | "auto">("grupos")
  const [stats,            setStats]           = useState<Stats | null>(null)
  const [groups,           setGroups]          = useState<Group[]>([])
  const [campaigns,        setCampaigns]       = useState<Campaign[]>([])
  const [schedules,        setSchedules]       = useState<Schedule[]>([])
  const [primeiros,        setPrimeiros]       = useState<Record<number, ScheduleItem | null>>({})
  const [store,            setStore]           = useState<ListasStore>({ listas: [], uso: {} })
  const [loading,          setLoading]         = useState(true)
  const [clienteDrawer,    setClienteDrawer]   = useState(false)
  const [postDraft,        setPostDraft]       = useState<PostDraft | null>(null)
  const [listasAberto,     setListasAberto]    = useState(false)
  const [apagando,         setApagando]        = useState<number | null>(null)
  const [selectedCampaign, setSelectedCampaign] = useState<Campaign | null>(null)
  const [historico,        setHistorico]       = useState<Schedule | null>(null)
  const [campaignView,     setCampaignView]    = useState<"ativas" | "historico">("ativas")
  const [toast,            setToast]           = useState<string | null>(null)
  const [hoje,             setHoje]            = useState<{ data: string; dia: number; hora: string } | null>(null)

  const tickRef       = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollingIdsRef = useRef<Set<number>>(new Set())

  function avisar(m: string) { setToast(m); setTimeout(() => setToast(null), 2600) }

  const loadAll = useCallback(async () => {
    setLoading(true)
    const [sR, gR, cR, scR, stR] = await Promise.all([
      fetch("/api/marketing/stats"),
      fetch("/api/marketing/groups"),
      fetch("/api/marketing/campaigns"),
      fetch("/api/marketing/schedules"),
      fetch("/api/settings"),
    ])
    if (sR.ok) setStats(await sR.json())
    if (gR.ok) setGroups(await gR.json())
    if (cR.ok) setCampaigns(await cR.json())
    let scs: Schedule[] = []
    if (scR.ok) { scs = await scR.json(); setSchedules(scs) }
    if (stR.ok) setStore(lerListas(((await stR.json()) as Record<string, string>)[LISTAS_KEY]))
    const itens = await Promise.all(scs.map(async s => {
      const r = await fetch(`/api/marketing/schedules/${s.id}/items`).catch(() => null)
      const l: ScheduleItem[] = r && r.ok ? await r.json() : []
      return [s.id, l[0] ?? null] as const
    }))
    setPrimeiros(Object.fromEntries(itens))
    setHoje(hojeBR())
    setLoading(false)
  }, [])

  function stopPolling() {
    if (tickRef.current) { clearTimeout(tickRef.current); tickRef.current = null }
    pollingIdsRef.current = new Set()
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
        c.id === campaignId ? { ...c, sentCount: d.sentCount, totalCount: d.totalCount, status: d.status } : c
      ))
      if (d.done) pollingIdsRef.current.delete(campaignId)
    } catch { /* retry next tick */ }
  }, [])

  // Mesmo ritmo do motor server-side (40-60s com jitter), reagendado só depois
  // que a rodada anterior termina (ver processCampaign.ts randDelayClient).
  async function pollAll() {
    await Promise.all([...pollingIdsRef.current].map(tickCampaign))
  }
  function scheduleNextPoll() {
    const delay = 40_000 + Math.random() * 20_000
    tickRef.current = setTimeout(async () => {
      await pollAll()
      if (pollingIdsRef.current.size > 0) scheduleNextPoll()
    }, delay)
  }
  function startPolling(campaignIds: number[]) {
    for (const id of campaignIds) pollingIdsRef.current.add(id)
    if (!tickRef.current) { pollAll(); scheduleNextPoll() }
  }

  useEffect(() => {
    const active = campaigns.filter(c => c.status === "sending" || c.status === "generating")
    if (active.length > 0) startPolling(active.map(c => c.id))
    else if (pollingIdsRef.current.size > 0) stopPolling()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns])

  useEffect(() => () => { if (tickRef.current) clearTimeout(tickRef.current) }, [])

  useEffect(() => {
    if (selectedCampaign) setSelectedCampaign(campaigns.find(c => c.id === selectedCampaign.id) ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [campaigns])

  useEffect(() => {
    fetch("/api/marketing/migrate", { method: "POST" }).then(() => loadAll())
  }, [loadAll])

  function handleCampaignCreated(campaignIds: number[], sendNow: boolean) {
    loadAll().then(() => { if (sendNow) startPolling(campaignIds) })
  }

  async function cancelCampaign(id: number) {
    pollingIdsRef.current.delete(id)
    await fetch(`/api/marketing/campaigns/${id}`, { method: "DELETE" })
    await loadAll()
  }

  async function toggleSchedule(s: Schedule) {
    await fetch(`/api/marketing/schedules/${s.id}`, {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    })
    avisar(s.active ? "Postagem pausada" : "Postagem ligada")
    loadAll()
  }

  async function apagarSchedule(s: Schedule) {
    await fetch(`/api/marketing/schedules/${s.id}`, { method: "DELETE" })
    const uso = { ...store.uso }; delete uso[String(s.id)]
    const next = { ...store, uso }; setStore(next); await salvarListas(next)
    setApagando(null); avisar("Postagem apagada"); loadAll()
  }

  async function novaLista(nome: string, jids: string[]) {
    const l = { id: Date.now(), nome, jids: [...jids] }
    const next = { ...store, listas: [...store.listas, l] }
    setStore(next); await salvarListas(next); avisar("Lista salva")
    return l.id
  }

  async function setUso(scheduleId: number, listaId: number | null) {
    const uso = { ...store.uso }
    if (listaId) uso[String(scheduleId)] = listaId; else delete uso[String(scheduleId)]
    const next = { ...store, uso }; setStore(next); await salvarListas(next)
  }

  async function salvarStore(next: ListasStore, mudou: ListaGrupos | null) {
    setStore(next); await salvarListas(next)
    if (mudou) {
      const afetadas = schedules.filter(s => next.uso[String(s.id)] === mudou.id)
      await Promise.all(afetadas.map(s => fetch(`/api/marketing/schedules/${s.id}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audienceGroupJids: mudou.jids }),
      })))
      avisar(afetadas.length ? `Lista salva e ${afetadas.length} postagem(ns) atualizada(s)` : "Lista salva")
      loadAll()
    } else avisar("Listas salvas")
  }

  async function abrirPostagem(s: Schedule | null, horaSugerida?: string) {
    if (!s) return setPostDraft({ schedule: null, item: null, itemCount: 0, horaSugerida })
    const r = await fetch(`/api/marketing/schedules/${s.id}/items`)
    const itens: ScheduleItem[] = r.ok ? await r.json() : []
    setPostDraft({ schedule: s, item: itens[0] ?? null, itemCount: itens.length })
  }

  // ─── Campanha (mensagem direta) ──────────────────────────────────────────
  function CampaignCard({ c }: { c: Campaign }) {
    const sm = STATUS_META[c.status] ?? { label: c.status, cls: "bg-slate-100 text-slate-500" }
    const isSending = c.status === "sending"
    return (
      <div onClick={() => setSelectedCampaign(c)}
        className="bg-white rounded-2xl border border-[#0F1E3C]/8 px-4 py-3.5 cursor-pointer hover:border-[#4361EE]/30 transition-colors">
        <div className="flex items-start gap-3">
          {c.mediaUrl && <img src={c.mediaUrl} alt="" className="h-12 w-12 rounded-xl object-cover border border-[#0F1E3C]/8 flex-shrink-0" />}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {c.title && <p className="text-sm font-bold text-[#0F1E3C]">{c.title}</p>}
              {isSending ? (
                <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-blue-100 text-blue-700">
                  <Loader2 size={8} className="animate-spin" /> {c.sentCount}/{c.totalCount}
                </span>
              ) : (
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
              )}
            </div>
            <p className="text-xs text-[#0F1E3C]/50 mt-1 truncate">{c.content}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap text-[11px] text-[#0F1E3C]/40">
              <span>
                {c.audienceType === "groups" ? `${c.audienceGroupJids.length} grupo(s)`
                  : c.audienceType === "lifecycle" ? (LIFECYCLE_OPTS.find(o => o.value === (c.audienceLifecycle ?? "all"))?.label ?? "—")
                  : "Clientes + grupos"}
              </span>
              {c.scheduledAt && <span className="flex items-center gap-1"><Clock size={9} /> {fmtBR(c.scheduledAt)}</span>}
              {c.status === "sent" && <span className="text-emerald-600 flex items-center gap-1"><CheckCircle size={9} /> {c.sentCount} enviados{c.errorCount > 0 ? ` · ${c.errorCount} erros` : ""}</span>}
            </div>
          </div>
        </div>
      </div>
    )
  }

  const activeCampaigns  = campaigns.filter(c => c.status === "scheduled" || c.status === "generating" || c.status === "sending")
  const historyCampaigns = campaigns.filter(c => c.status === "sent" || c.status === "failed" || c.status === "cancelled")
  const visibleCampaigns = campaignView === "ativas" ? activeCampaigns : historyCampaigns

  // ─── Hoje ────────────────────────────────────────────────────────────────
  const deHoje = hoje
    ? schedules.filter(s => s.active && s.daysOfWeek.includes(hoje.dia)).sort((a, b) => a.timeOfDay.localeCompare(b.timeOfDay))
    : []
  const ordenadas = [...schedules].sort((a, b) => (Number(b.active) - Number(a.active)) || a.timeOfDay.localeCompare(b.timeOfDay))
  const ativas = schedules.filter(s => s.active).length

  function situacao(s: Schedule) {
    if (!hoje) return { t: "", cls: "" }
    if (s.lastExecutedAt && dataBR(s.lastExecutedAt) === hoje.data) return { t: `Saiu às ${fmtTime(s.lastExecutedAt)}`, cls: "bg-emerald-100 text-emerald-700" }
    if (s.timeOfDay.slice(0, 5) < hoje.hora) return { t: "Não saiu", cls: "bg-red-100 text-red-700" }
    return { t: "Vai sair", cls: "bg-[#DCE4FF] text-[#3451D4]" }
  }

  return (
    <div className="space-y-6">
      {/* Cabeçalho */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-[38px] leading-none text-[#0F1E3C]" style={{ fontFamily: "var(--font-anton), Anton, Impact, sans-serif" }}>MARKETING</h1>
          <p className="text-sm text-[#0F1E3C]/50 mt-1.5">O que sai hoje nos grupos e pros clientes</p>
        </div>
        <button onClick={loadAll} className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-[#0F1E3C]/8 text-xs font-bold text-[#0F1E3C]/50 hover:text-[#0F1E3C]">
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Atualizar
        </button>
      </div>

      {/* Hoje */}
      <section className="bg-[#0F1E3C] rounded-2xl p-5 text-white space-y-3.5">
        <p className="text-xs font-bold tracking-[.14em] uppercase text-[#AFC0EA]">
          Hoje{hoje ? ` · ${DIA_NOME[hoje.dia]}, ${hoje.data.slice(8, 10)}/${hoje.data.slice(5, 7)}` : ""}
        </p>
        {loading && !hoje ? (
          <div className="flex justify-center py-4"><Loader2 size={18} className="animate-spin text-[#AFC0EA]" /></div>
        ) : deHoje.length === 0 ? (
          <div className="flex items-center justify-between gap-3 flex-wrap rounded-xl border border-dashed border-white/20 px-4 py-4">
            <p className="text-sm text-[#AFC0EA]">Nenhuma postagem ligada pra hoje.</p>
            <button onClick={() => abrirPostagem(null)} className="px-3 py-2 rounded-lg text-xs font-bold bg-white/10 hover:bg-white/20">+ Nova postagem</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {deHoje.map(s => {
              const st = situacao(s)
              const foto = primeiros[s.id]?.mediaUrl ?? s.firstItemMediaUrl
              return (
                <button key={s.id} onClick={() => abrirPostagem(s)}
                  className="text-left flex items-center gap-3 min-w-0 rounded-xl bg-white/5 border border-white/10 hover:border-white/30 p-3 transition-colors">
                  {foto ? <img src={foto} alt="" className="w-[62px] h-[62px] rounded-lg object-cover flex-shrink-0" />
                    : <div className="w-[62px] h-[62px] rounded-lg bg-white/10 flex-shrink-0" />}
                  <div className="min-w-0 flex flex-col gap-1">
                    <span className="text-2xl leading-none" style={{ fontFamily: "var(--font-anton), Anton, Impact, sans-serif" }}>{s.timeOfDay.slice(0, 5)}</span>
                    <span className="text-sm font-semibold truncate">{s.name}</span>
                    <span className="text-xs text-[#AFC0EA] truncate">{nomeDosGrupos(s, store)}</span>
                    <span className={`w-fit text-[11px] font-bold px-2 py-0.5 rounded-full ${st.cls}`}>{st.t}</span>
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </section>

      {/* Abas */}
      <div className="flex gap-1 bg-[#E6EAF4] p-1 rounded-xl w-fit max-w-full overflow-x-auto">
        {([
          { v: "grupos",   l: "Grupos",      n: ativas ? `${ativas} ligada${ativas !== 1 ? "s" : ""}` : "" },
          { v: "clientes", l: "Clientes",    n: "" },
          { v: "auto",     l: "Automáticas", n: "" },
        ] as const).map(({ v, l, n }) => (
          <button key={v} onClick={() => setTab(v)}
            className={`px-4 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors ${tab === v ? "bg-white text-[#4361EE] shadow-sm" : "text-[#0F1E3C]/50 hover:text-[#0F1E3C]"}`}>
            {l}{n && <span className="ml-1.5 text-[11px] bg-[#4361EE]/10 text-[#4361EE] rounded-full px-1.5 py-0.5">{n}</span>}
          </button>
        ))}
      </div>

      {/* ── Grupos ── */}
      {tab === "grupos" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-[#0F1E3C]/55">Postagens que saem sozinhas nos grupos de WhatsApp, no horário e nos dias marcados.</p>
            <div className="flex gap-2">
              <button onClick={() => setListasAberto(true)} className="px-4 py-2 rounded-xl text-sm font-bold bg-white border border-[#0F1E3C]/12 text-[#0F1E3C] hover:border-[#4361EE] hover:text-[#4361EE]">Listas de grupos</button>
              <button onClick={() => abrirPostagem(null)} className="flex items-center gap-1.5 px-4 py-2 bg-[#4361EE] hover:bg-[#3451d1] text-white text-sm font-bold rounded-xl"><Plus size={14} /> Nova postagem</button>
            </div>
          </div>

          {loading && schedules.length === 0 ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[#4361EE]" /></div>
          ) : ordenadas.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-8 text-center">
              <CalendarClock size={22} className="mx-auto text-[#0F1E3C]/15 mb-2" />
              <p className="text-sm font-bold text-[#0F1E3C]/40">Nenhuma postagem ainda</p>
              <p className="text-xs text-[#0F1E3C]/30 mt-0.5">Clica em Nova postagem pra programar a primeira.</p>
            </div>
          ) : ordenadas.map(s => {
            const it = primeiros[s.id]
            const foto = it?.mediaUrl ?? s.firstItemMediaUrl
            return (
              <article key={s.id} className={`bg-white rounded-2xl border border-[#0F1E3C]/8 p-3.5 grid grid-cols-[64px_minmax(0,1fr)] md:grid-cols-[76px_minmax(0,1fr)_auto] gap-4 items-center ${s.active ? "" : "opacity-75"}`}>
                {foto ? <img src={foto} alt="" className="w-16 h-16 md:w-[76px] md:h-[76px] rounded-xl object-cover" />
                  : <div className="w-16 h-16 md:w-[76px] md:h-[76px] rounded-xl bg-[#EEF1FD] flex items-center justify-center text-[#4361EE] font-black">SM</div>}
                <div className="min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <b className="text-[15px] text-[#0F1E3C]">{s.name}</b>
                    <span className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${s.active ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"}`}>{s.active ? "Ligada" : "Pausada"}</span>
                  </div>
                  <div className="flex gap-1.5 flex-wrap text-xs">
                    <span className="px-2 py-0.5 rounded-full border border-[#0F1E3C]/10 bg-[#F4F6FB] font-bold text-[#0F1E3C] tabular-nums">{s.timeOfDay.slice(0, 5)}</span>
                    <span className="px-2 py-0.5 rounded-full border border-[#0F1E3C]/10 bg-[#F4F6FB] text-[#0F1E3C]/60">{diasLabel(s.daysOfWeek)}</span>
                    <span className="px-2 py-0.5 rounded-full border border-[#0F1E3C]/10 bg-[#F4F6FB] text-[#0F1E3C]/60">{nomeDosGrupos(s, store)}</span>
                    {s.itemCount > 1 && <span className="px-2 py-0.5 rounded-full border border-amber-200 bg-amber-50 text-amber-700">reveza {s.itemCount} textos</span>}
                  </div>
                  <p className="text-[13px] text-[#0F1E3C]/50 truncate">{it?.content.split("\n").find(x => x.trim()) ?? ""}</p>
                </div>
                <div className="col-span-2 md:col-span-1 flex gap-1.5 flex-wrap md:justify-end">
                  <button onClick={() => toggleSchedule(s)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-[#0F1E3C] hover:border-[#4361EE] hover:text-[#4361EE]">{s.active ? "Pausar" : "Ligar"}</button>
                  <button onClick={() => abrirPostagem(s)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-[#0F1E3C] hover:border-[#4361EE] hover:text-[#4361EE]">Editar</button>
                  <button onClick={() => setHistorico(s)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-[#0F1E3C]/60 hover:text-[#4361EE]">Histórico</button>
                  <button onClick={() => setApagando(s.id)} className="px-3 py-1.5 rounded-lg text-xs font-bold border border-[#0F1E3C]/12 text-red-500 hover:bg-red-50">Apagar</button>
                </div>
                {apagando === s.id && (
                  <div className="col-span-2 md:col-span-3 flex items-center justify-between gap-2 flex-wrap bg-red-50 rounded-xl px-3 py-2.5 text-sm font-semibold text-red-700">
                    <span>Apagar &quot;{s.name}&quot;? Ela para de sair nos grupos.</span>
                    <span className="flex gap-1.5">
                      <button onClick={() => setApagando(null)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-white border border-[#0F1E3C]/12 text-[#0F1E3C]">Manter</button>
                      <button onClick={() => apagarSchedule(s)} className="px-3 py-1.5 rounded-lg text-xs font-bold bg-red-600 text-white">Apagar</button>
                    </span>
                  </div>
                )}
              </article>
            )
          })}
        </div>
      )}

      {/* ── Clientes ── */}
      {tab === "clientes" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { k: "total",   l: "Clientes", sub: "no total",            cls: "text-[#0F1E3C]", v: (stats?.total ?? 0) as number | null },
              { k: "new",     l: "Novos",    sub: "ainda sem pedido",    cls: "text-[#4361EE]", v: null },
              { k: "active",  l: "Ativos",   sub: "compraram há pouco",  cls: "text-emerald-700", v: null },
              { k: "ausente", l: "Sumidos",  sub: "pararam de comprar",  cls: "text-amber-700", v: null },
            ].map(x => (
              <div key={x.k} className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4">
                <p className="text-[11px] font-bold tracking-[.12em] uppercase text-[#0F1E3C]/40">{x.l}</p>
                <p className={`text-[32px] leading-tight tabular-nums ${x.cls}`} style={{ fontFamily: "var(--font-anton), Anton, Impact, sans-serif" }}>
                  {loading && !stats ? "—" : x.v ?? Number(stats?.byState.find(s => s.state === x.k)?.total ?? 0)}
                </p>
                <p className="text-xs text-[#0F1E3C]/45">{x.sub}</p>
              </div>
            ))}
          </div>

          <div className="flex items-center justify-between gap-3 flex-wrap">
            <p className="text-sm text-[#0F1E3C]/55">Mensagem direta no WhatsApp de cada cliente. Sai uma vez só.</p>
            <button onClick={() => setClienteDrawer(true)} className="flex items-center gap-1.5 px-4 py-2 bg-[#4361EE] hover:bg-[#3451d1] text-white text-sm font-bold rounded-xl"><Plus size={14} /> Mensagem pros clientes</button>
          </div>

          <MarketingMonitor />

          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold tracking-[.14em] uppercase text-[#0F1E3C]/40">Envios</p>
            <div className="flex gap-1 bg-[#F4F6FB] p-0.5 rounded-lg">
              {([
                { v: "ativas",    l: `Em andamento${activeCampaigns.length ? ` (${activeCampaigns.length})` : ""}` },
                { v: "historico", l: `Já enviados${historyCampaigns.length ? ` (${historyCampaigns.length})` : ""}` },
              ] as const).map(({ v, l }) => (
                <button key={v} onClick={() => setCampaignView(v)}
                  className={`px-2.5 py-1 rounded-md text-[11px] font-bold transition-colors ${campaignView === v ? "bg-white text-[#4361EE] shadow-sm" : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]"}`}>{l}</button>
              ))}
            </div>
          </div>
          {visibleCampaigns.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-8 text-center">
              <Megaphone size={22} className="mx-auto text-[#0F1E3C]/15 mb-2" />
              <p className="text-sm font-bold text-[#0F1E3C]/35">{campaignView === "ativas" ? "Nenhum envio em andamento" : "Nenhum envio ainda"}</p>
            </div>
          ) : (
            <div className="space-y-2.5">{visibleCampaigns.map(c => <CampaignCard key={c.id} c={c} />)}</div>
          )}
        </div>
      )}

      {/* ── Automáticas ── */}
      {tab === "auto" && <LifecycleTab />}

      {/* Gavetas e janelas */}
      <UnifiedDrawer
        open={clienteDrawer}
        onClose={() => setClienteDrawer(false)}
        groups={groups}
        stats={stats}
        onCampaignCreated={handleCampaignCreated}
        onScheduleCreated={loadAll}
      />

      {postDraft && (
        <PostagemDrawer
          key={postDraft.schedule?.id ?? "nova"}
          draft={postDraft}
          groups={groups}
          store={store}
          onClose={() => setPostDraft(null)}
          onSaved={m => { setPostDraft(null); avisar(m); loadAll() }}
          onNovaLista={novaLista}
          setUso={setUso}
        />
      )}

      {listasAberto && (
        <ListasDrawer groups={groups} store={store} schedules={schedules}
          onClose={() => setListasAberto(false)} onSave={salvarStore} />
      )}

      {selectedCampaign && (
        <CampaignModal campaign={selectedCampaign} onClose={() => setSelectedCampaign(null)} onCancel={cancelCampaign} />
      )}

      {historico && (
        <ScheduleModal
          schedule={historico}
          groups={groups}
          stats={stats}
          startInEdit={false}
          onClose={() => setHistorico(null)}
          onToggle={() => toggleSchedule(historico)}
          onRefresh={loadAll}
        />
      )}

      {toast && (
        <div className="fixed left-1/2 -translate-x-1/2 bottom-6 z-[60] bg-[#0F1E3C] text-white text-sm font-semibold px-4 py-2.5 rounded-xl shadow-lg">{toast}</div>
      )}
    </div>
  )
}

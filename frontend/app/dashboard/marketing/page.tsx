"use client"

import {
  useState, useEffect, useCallback, useRef,
} from "react"
import {
  Megaphone, Calendar, Plus, Trash2, Send, Image, X,
  Clock, Users, RefreshCw, ChevronDown, ChevronUp,
  CheckCircle, AlertCircle, Loader2, ToggleLeft, ToggleRight,
  CalendarClock, Layers,
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
  scheduled: { label: "Agendado",  cls: "bg-amber-100 text-amber-700" },
  sending:   { label: "Enviando",  cls: "bg-blue-100 text-blue-700"   },
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
}: {
  audienceType: string
  lifecycle: string
  groupJids: string[]
  groups: Group[]
  onType: (v: string) => void
  onLifecycle: (v: string) => void
  onGroups: (v: string[]) => void
  stats: Stats | null
}) {
  function toggleGroup(jid: string) {
    onGroups(groupJids.includes(jid)
      ? groupJids.filter(j => j !== jid)
      : [...groupJids, jid])
  }

  const reach = (() => {
    if (!stats) return 0
    if (audienceType === "groups") return groupJids.length
    const base = lifecycle === "all" ? stats.total
      : Number(stats.byState.find(s => s.state === lifecycle)?.total ?? 0)
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

// ─── Campaign Drawer ──────────────────────────────────────────────────────────

function CampaignDrawer({
  open, onClose, groups, stats, onCreated,
}: {
  open: boolean
  onClose: () => void
  groups: Group[]
  stats: Stats | null
  onCreated: () => void
}) {
  const [title,        setTitle]        = useState("")
  const [content,      setContent]      = useState("")
  const [mediaUrl,     setMediaUrl]     = useState<string | null>(null)
  const [audienceType, setAudienceType] = useState("lifecycle")
  const [lifecycle,    setLifecycle]    = useState("all")
  const [groupJids,    setGroupJids]    = useState<string[]>([])
  const [mode,         setMode]         = useState<"now" | "schedule">("now")
  const [schedDate,    setSchedDate]    = useState("")
  const [schedTime,    setSchedTime]    = useState("08:00")
  const [sending,      setSending]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  function reset() {
    setTitle(""); setContent(""); setMediaUrl(null)
    setAudienceType("lifecycle"); setLifecycle("all"); setGroupJids([])
    setMode("now"); setSchedDate(""); setSchedTime("08:00")
    setSending(false); setError(null)
  }

  function close() { reset(); onClose() }

  async function submit() {
    if (!content.trim()) { setError("Mensagem obrigatória"); return }
    if (audienceType === "groups" && groupJids.length === 0) { setError("Selecione ao menos um grupo"); return }
    if (mode === "schedule" && !schedDate) { setError("Data obrigatória"); return }

    setSending(true); setError(null)

    const scheduledAt = mode === "schedule"
      ? new Date(`${schedDate}T${schedTime}:00`).toISOString()
      : null

    const r = await fetch("/api/marketing/campaigns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title, content, mediaUrl,
        audienceType,
        audienceLifecycle: audienceType !== "groups" ? lifecycle : null,
        audienceGroupJids: groupJids,
        scheduledAt,
      }),
    })

    setSending(false)
    if (r.ok) { onCreated(); close() }
    else { const d = await r.json(); setError(d.error ?? "Erro ao criar campanha") }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={close} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
          <h2 className="text-sm font-bold text-[#0F1E3C]">Nova Campanha</h2>
          <button onClick={close} className="p-1 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40">
            <X size={16} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          {/* Title */}
          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Nome da campanha (opcional)</label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="Ex: Lançamento coleção inverno"
              className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            />
          </div>

          {/* Content */}
          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Mensagem</label>
            <textarea
              value={content}
              onChange={e => setContent(e.target.value)}
              rows={4}
              placeholder={"Oi {nome}, novidade chegando! 🔥"}
              className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
            />
            <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Use <code className="bg-[#F4F6FB] px-1 rounded">{"{nome}"}</code> para personalizar</p>
          </div>

          {/* Image */}
          <ImageUpload value={mediaUrl} onChange={setMediaUrl} />

          {/* Audience */}
          <AudiencePicker
            audienceType={audienceType} lifecycle={lifecycle}
            groupJids={groupJids} groups={groups} stats={stats}
            onType={setAudienceType} onLifecycle={setLifecycle} onGroups={setGroupJids}
          />

          {/* Schedule */}
          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2 block">Envio</label>
            <div className="flex gap-2 mb-3">
              {[{ v: "now", l: "Agora" }, { v: "schedule", l: "Agendar" }].map(({ v, l }) => (
                <button
                  key={v}
                  onClick={() => setMode(v as "now" | "schedule")}
                  className={`px-4 py-2 rounded-xl text-xs font-semibold transition-colors ${
                    mode === v ? "bg-[#4361EE] text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/60 hover:bg-[#4361EE]/10"
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
            {mode === "schedule" && (
              <div className="flex gap-2">
                <input
                  type="date"
                  value={schedDate}
                  onChange={e => setSchedDate(e.target.value)}
                  className="flex-1 border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
                <input
                  type="time"
                  value={schedTime}
                  onChange={e => setSchedTime(e.target.value)}
                  className="w-28 border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20"
                />
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
            disabled={sending}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#4361EE] hover:bg-[#3451d1] text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50"
          >
            {sending
              ? <><Loader2 size={14} className="animate-spin" /> Processando...</>
              : mode === "now"
                ? <><Send size={14} /> Enviar agora</>
                : <><Calendar size={14} /> Agendar</>}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Schedule Drawer ──────────────────────────────────────────────────────────

function ScheduleDrawer({
  open, onClose, groups, stats, onCreated,
}: {
  open: boolean
  onClose: () => void
  groups: Group[]
  stats: Stats | null
  onCreated: () => void
}) {
  const [name,         setName]         = useState("")
  const [daysOfWeek,   setDaysOfWeek]   = useState<number[]>([1,2,3,4,5])
  const [timeOfDay,    setTimeOfDay]    = useState("08:00")
  const [audienceType, setAudienceType] = useState("groups")
  const [lifecycle,    setLifecycle]    = useState("all")
  const [groupJids,    setGroupJids]    = useState<string[]>([])
  const [saving,       setSaving]       = useState(false)
  const [error,        setError]        = useState<string | null>(null)

  function reset() {
    setName(""); setDaysOfWeek([1,2,3,4,5]); setTimeOfDay("08:00")
    setAudienceType("groups"); setLifecycle("all"); setGroupJids([])
    setSaving(false); setError(null)
  }
  function close() { reset(); onClose() }

  function toggleDay(d: number) {
    setDaysOfWeek(prev => prev.includes(d) ? prev.filter(x => x !== d) : [...prev, d].sort())
  }

  async function submit() {
    if (!name.trim()) { setError("Nome obrigatório"); return }
    if (daysOfWeek.length === 0) { setError("Selecione ao menos um dia"); return }
    if ((audienceType === "groups" || audienceType === "mixed") && groupJids.length === 0) {
      setError("Selecione ao menos um grupo"); return
    }
    setSaving(true); setError(null)
    const r = await fetch("/api/marketing/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name, daysOfWeek, timeOfDay, audienceType,
        audienceLifecycle: audienceType !== "groups" ? lifecycle : null,
        audienceGroupJids: groupJids,
      }),
    })
    setSaving(false)
    if (r.ok) { onCreated(); close() }
    else { const d = await r.json(); setError(d.error ?? "Erro") }
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex">
      <div className="flex-1 bg-black/30" onClick={close} />
      <div className="w-full max-w-md bg-white shadow-2xl flex flex-col overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
          <h2 className="text-sm font-bold text-[#0F1E3C]">Nova Programação</h2>
          <button onClick={close} className="p-1 rounded-lg hover:bg-[#F4F6FB] text-[#0F1E3C]/40"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Nome</label>
            <input value={name} onChange={e => setName(e.target.value)} placeholder="Ex: Post semanal de novidades"
              className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
          </div>

          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-2 block">Dias da semana</label>
            <div className="flex gap-1.5 flex-wrap">
              {DAYS.map((d, i) => (
                <button key={i} onClick={() => toggleDay(i)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                    daysOfWeek.includes(i) ? "bg-[#4361EE] text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/50 hover:bg-[#4361EE]/10"
                  }`}
                >{d}</button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-semibold text-[#0F1E3C]/50 uppercase tracking-wider mb-1.5 block">Horário</label>
            <div className="flex items-center gap-2">
              <input type="time" step="3600" value={timeOfDay}
                onChange={e => {
                  const v = e.target.value
                  // Snap to :00 — cron fires on the hour
                  setTimeOfDay(v ? v.slice(0, 3) + "00" : "08:00")
                }}
                className="border border-[#0F1E3C]/12 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
              <span className="text-[11px] text-[#0F1E3C]/35">disparo na hora exata</span>
            </div>
          </div>

          <AudiencePicker
            audienceType={audienceType} lifecycle={lifecycle}
            groupJids={groupJids} groups={groups} stats={stats}
            onType={setAudienceType} onLifecycle={setLifecycle} onGroups={setGroupJids}
          />

          {error && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-xl px-3 py-2.5">
              <AlertCircle size={14} className="text-red-500 shrink-0" />
              <p className="text-xs text-red-600">{error}</p>
            </div>
          )}
        </div>
        <div className="px-5 py-4 border-t border-[#0F1E3C]/8">
          <button onClick={submit} disabled={saving}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-[#4361EE] hover:bg-[#3451d1] text-white text-sm font-bold rounded-xl transition-colors disabled:opacity-50">
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
            {saving ? "Salvando..." : "Criar programação"}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Schedule Row (expanded with queue) ───────────────────────────────────────

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

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function MarketingPage() {
  const [tab,          setTab]          = useState<"campanhas" | "programacao">("campanhas")
  const [stats,        setStats]        = useState<Stats | null>(null)
  const [groups,       setGroups]       = useState<Group[]>([])
  const [campaigns,    setCampaigns]    = useState<Campaign[]>([])
  const [schedules,    setSchedules]    = useState<Schedule[]>([])
  const [loading,      setLoading]      = useState(true)
  const [campDrawer,   setCampDrawer]   = useState(false)
  const [schedDrawer,  setSchedDrawer]  = useState(false)

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

  // Run migration on first load
  useEffect(() => {
    fetch("/api/marketing/migrate", { method: "POST" }).then(() => loadAll())
  }, [loadAll])

  async function cancelCampaign(id: number) {
    await fetch(`/api/marketing/campaigns/${id}`, { method: "DELETE" })
    loadAll()
  }

  async function toggleSchedule(s: Schedule) {
    await fetch(`/api/marketing/schedules/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !s.active }),
    })
    loadAll()
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

      {/* Tabs */}
      <div className="flex gap-1 bg-[#F4F6FB] p-1 rounded-xl w-fit">
        {([
          { v: "campanhas",   l: "Campanhas",    Icon: Megaphone   },
          { v: "programacao", l: "Programação", Icon: CalendarClock },
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
              onClick={() => setCampDrawer(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#4361EE] hover:bg-[#3451d1] text-white text-xs font-bold rounded-xl transition-colors"
            >
              <Plus size={13} /> Nova campanha
            </button>
          </div>

          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[#4361EE]" /></div>
          ) : campaigns.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-12 text-center">
              <Megaphone size={28} className="mx-auto text-[#0F1E3C]/15 mb-3" />
              <p className="text-sm font-bold text-[#0F1E3C]/30">Nenhuma campanha ainda</p>
              <p className="text-xs text-[#0F1E3C]/20 mt-1">Crie sua primeira campanha para começar</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {campaigns.map(c => {
                const sm = STATUS_META[c.status] ?? { label: c.status, cls: "bg-slate-100 text-slate-500" }
                return (
                  <div key={c.id} className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm px-4 py-3.5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          {c.title && <p className="text-sm font-bold text-[#0F1E3C]">{c.title}</p>}
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sm.cls}`}>{sm.label}</span>
                          {c.mediaUrl && <span className="text-[10px] text-[#0F1E3C]/30 flex items-center gap-0.5"><Image size={9} /> foto</span>}
                        </div>
                        <p className="text-xs text-[#0F1E3C]/50 mt-1 truncate">{c.content}</p>
                        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                          <span className="text-[11px] text-[#0F1E3C]/35">
                            {c.audienceType === "groups" ? `${c.audienceGroupJids.length} grupo(s)`
                              : c.audienceType === "lifecycle" ? (LIFECYCLE_OPTS.find(o => o.value === (c.audienceLifecycle ?? "all"))?.label ?? "—")
                              : "Clientes + grupos"}
                          </span>
                          {c.scheduledAt && (
                            <span className="text-[11px] text-[#0F1E3C]/35 flex items-center gap-1">
                              <Clock size={9} /> {fmtBR(c.scheduledAt)}
                            </span>
                          )}
                          {c.status === "sent" && (
                            <span className="text-[11px] text-emerald-600 flex items-center gap-1">
                              <CheckCircle size={9} /> {c.sentCount} enviados
                              {c.errorCount > 0 && ` · ${c.errorCount} erros`}
                            </span>
                          )}
                        </div>
                      </div>
                      {c.status === "scheduled" && (
                        <button
                          onClick={() => cancelCampaign(c.id)}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-[#0F1E3C]/30 hover:text-red-500 transition-colors shrink-0"
                        >
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Programação ── */}
      {tab === "programacao" && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-bold text-[#0F1E3C]">Programações recorrentes</p>
            <button
              onClick={() => setSchedDrawer(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-[#4361EE] hover:bg-[#3451d1] text-white text-xs font-bold rounded-xl transition-colors"
            >
              <Plus size={13} /> Nova programação
            </button>
          </div>


          {loading ? (
            <div className="flex justify-center py-8"><Loader2 size={20} className="animate-spin text-[#4361EE]" /></div>
          ) : schedules.length === 0 ? (
            <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-12 text-center">
              <CalendarClock size={28} className="mx-auto text-[#0F1E3C]/15 mb-3" />
              <p className="text-sm font-bold text-[#0F1E3C]/30">Nenhuma programação ainda</p>
              <p className="text-xs text-[#0F1E3C]/20 mt-1">Crie slots recorrentes para divulgar fotos e novidades automaticamente</p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {schedules.map(s => (
                <ScheduleRow
                  key={s.id}
                  schedule={s}
                  groups={groups}
                  onToggle={() => toggleSchedule(s)}
                  onDelete={loadAll}
                  onRefresh={loadAll}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Drawers */}
      <CampaignDrawer
        open={campDrawer} onClose={() => setCampDrawer(false)}
        groups={groups} stats={stats} onCreated={loadAll}
      />
      <ScheduleDrawer
        open={schedDrawer} onClose={() => setSchedDrawer(false)}
        groups={groups} stats={stats} onCreated={loadAll}
      />
    </div>
  )
}

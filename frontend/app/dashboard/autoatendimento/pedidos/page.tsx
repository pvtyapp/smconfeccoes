"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  RefreshCw, ShoppingBag,
  Search, Send, MessageCircle, ChevronLeft, Printer, History,
  ChevronDown, ChevronUp, Users, AlertCircle, BotOff, Bot, UserCheck,
  Reply, Trash2, X, Phone, Paperclip, Download, PanelRight,
} from "lucide-react"
import OrderCard from "./OrderCard"
import OrderModal from "./OrderModal"
import DtfOrderCard, { type DtfOrder } from "./DtfOrderCard"
import DtfOrderModal from "./DtfOrderModal"

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tip({ text }: { text: string }) {
  return (
    <div className="relative group/tip flex-shrink-0">
      <span className="text-[9px] text-[#0F1E3C]/25 cursor-default select-none group-hover/tip:text-[#0F1E3C]/50 transition-colors">ⓘ</span>
      <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 bg-[#0F1E3C] text-white text-[9px] leading-relaxed rounded-xl px-3 py-2 text-center pointer-events-none z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity shadow-lg whitespace-normal">
        {text}
        <span className="absolute top-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-t-[#0F1E3C]" />
      </div>
    </div>
  )
}

// ─── Order types ──────────────────────────────────────────────────────────────

export type OrderItem = {
  id: number
  productId: string | null
  productName: string
  color: string | null
  size: string | null
  qty: number
  qtyConfirmed: number | null
  isService: boolean
  variantNote: string | null
}

export type Order = {
  id: number
  number: string
  status: string
  source: string
  notes: string | null
  deliveryDate: string | null
  totalValue: number | null
  dueDate: string | null
  createdAt: string
  updatedAt: string
  contactId: number
  contactName: string
  contactPhone: string
  contactJid: string | null
  paymentTermEnabled: boolean
  paymentTermType: string | null
  paymentTermDays: number | null
  items: OrderItem[]
}

// ─── Chat types ───────────────────────────────────────────────────────────────

type Conversation = {
  id: number
  name: string | null
  phone: string
  jid: string
  profilePic: string | null
  lifecycleState: string | null
  needsAttention: boolean
  chatbotPausedUntil: string | null
  lastMessage: string | null
  lastDirection: "in" | "out" | null
  lastAt: string | null
  unread: number
}

type Message = {
  id: number
  messageId: string | null
  direction: "in" | "out"
  content: string | null
  mediaType: string | null
  mediaUrl: string | null
  mediaCategory: string | null
  fileName: string | null
  caption: string | null
  status: "sent" | "delivered" | "read" | "played" | null
  quotedMessageId: string | null
  quotedContent: string | null
  createdAt: string
}

// ─── Group types (Evolution-direct) ──────────────────────────────────────────

type Group = {
  jid: string
  name: string
  profilePic: string | null
  lastMessage: string | null
  lastAt: string | null
  lastSender: string | null
  fromMe: boolean
  unread: number
}

type GroupMessage = {
  id: string
  fromMe: boolean
  senderJid: string
  senderName: string
  content: string
  mediaType: string | null
  thumbnail: string | null
  caption: string | null
  fileName: string | null
  createdAt: string
  status: string | null
}

// ─── History types ────────────────────────────────────────────────────────────

type HistPeriod = "1d" | "ontem" | "7d" | "15d" | "30d" | "range"

type HistItem = {
  id: number; number: string; tipo: "produto" | "dtf"
  status: string; valor: number | null; dueDate: string | null
  concludedAt: string; contactName: string | null; contactPhone: string | null
  itemCount?: number; totalQty?: number; metrosFinais?: number; metros?: number
}

const HIST_OPTIONS: { key: HistPeriod; label: string }[] = [
  { key: "1d",    label: "Hoje"   },
  { key: "ontem", label: "Ontem"  },
  { key: "7d",    label: "7d"     },
  { key: "15d",   label: "15d"    },
  { key: "30d",   label: "30d"    },
  { key: "range", label: "Período"},
]

function getHistDates(key: HistPeriod, rs: string, re: string): [string, string] {
  const fmt = (d: Date) => d.toISOString().slice(0, 10)
  const sub = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return d }
  switch (key) {
    case "1d":    return [fmt(new Date()), fmt(new Date())]
    case "ontem": return [fmt(sub(1)), fmt(sub(1))]
    case "7d":    return [fmt(sub(6)), fmt(new Date())]
    case "15d":   return [fmt(sub(14)), fmt(new Date())]
    case "30d":   return [fmt(sub(29)), fmt(new Date())]
    case "range": return [rs, re]
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const PROD_COLS = [
  { key: "triagem",      label: "Triagem",      hdr: "bg-amber-50 border-amber-200",   badge: "bg-amber-100 text-amber-700",   txt: "text-amber-700"   },
  { key: "confirmando",  label: "Confirmando",  hdr: "bg-purple-50 border-purple-200", badge: "bg-purple-100 text-purple-700", txt: "text-purple-700"  },
  { key: "em_separacao", label: "Em Separação", hdr: "bg-blue-50 border-blue-200",     badge: "bg-blue-100 text-blue-700",     txt: "text-blue-700"    },
  { key: "pronto",       label: "Pronto",       hdr: "bg-green-50 border-green-200",   badge: "bg-green-100 text-green-700",   txt: "text-green-700"   },
]

const DTF_COLS = [
  { key: "triagem",     label: "Triagem",     hdr: "bg-amber-50 border-amber-200",   badge: "bg-amber-100 text-amber-700",   txt: "text-amber-700"   },
  { key: "em_producao", label: "Em Produção", hdr: "bg-blue-50 border-blue-200",     badge: "bg-blue-100 text-blue-700",     txt: "text-blue-700"    },
  { key: "pronto",      label: "Pronto",      hdr: "bg-green-50 border-green-200",   badge: "bg-green-100 text-green-700",   txt: "text-green-700"   },
]

const LIFECYCLE_COLOR: Record<string, string> = {
  new:     "bg-blue-100 text-blue-700",
  active:  "bg-emerald-100 text-emerald-700",
  ausente: "bg-amber-100 text-amber-700",
  curioso: "bg-purple-100 text-purple-700",
  frio:    "bg-gray-100 text-gray-500",
}

const LIFECYCLE_LABEL: Record<string, string> = {
  new:     "Novo",
  active:  "Ativo",
  ausente: "Ausente",
  curioso: "Curioso",
  frio:    "Frio",
}

function fmtPhone(phone: string) {
  const p = phone.replace(/\D/g, "")
  if (p.length === 11) return `(${p.slice(0,2)}) ${p.slice(2,7)}-${p.slice(7)}`
  return phone
}

const TZ_BR = "America/Sao_Paulo"

function dateBRKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_BR })
}

function fmtTime(s: string | null) {
  if (!s) return ""
  const d = new Date(s)
  const isToday = dateBRKey(s) === dateBRKey(new Date().toISOString())
  if (isToday) return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ_BR })
  return d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", timeZone: TZ_BR })
}

const MEDIA_EMOJI: Record<string, string> = {
  image: "📷 Foto", video: "🎥 Vídeo", audio: "🎤 Áudio",
  document: "📄 Documento", sticker: "🖼 Sticker",
}

const CATEGORY_BADGE: Record<string, { label: string; cls: string }> = {
  pix:       { label: "PIX",       cls: "bg-emerald-100 text-emerald-700" },
  dtf:       { label: "DTF",       cls: "bg-violet-100 text-violet-700"   },
  documento: { label: "Doc",       cls: "bg-gray-100 text-gray-600"       },
  audio:     { label: "Áudio",     cls: "bg-blue-100 text-blue-600"       },
}

function formatMsgPreview(content: string | null): string {
  if (!content) return "Sem mensagens"
  const m = content.match(/^\[(\w+)\]$/)
  if (m && MEDIA_EMOJI[m[1]]) return MEDIA_EMOJI[m[1]]
  return content
}

function isBlobUrl(url: string | null): boolean {
  return !!url && url.startsWith("https://")
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function PedidosPage() {
  // Orders
  const [orders,         setOrders]         = useState<Order[]>([])
  const [loadingOrders,  setLoadingOrders]  = useState(true)
  const [selected,       setSelected]       = useState<Order | null>(null)
  const selectedIdRef                       = useRef<number | null>(null)
  // DTF
  const [dtfOrders,      setDtfOrders]      = useState<DtfOrder[]>([])
  const [selectedDtf,    setSelectedDtf]    = useState<DtfOrder | null>(null)
  const selectedDtfIdRef                    = useRef<number | null>(null)

  // History
  const [histPeriod,     setHistPeriod]     = useState<HistPeriod>("7d")
  const [histRangeStart, setHistRangeStart] = useState("")
  const [histRangeEnd,   setHistRangeEnd]   = useState("")
  const [historico,      setHistorico]      = useState<{ produto: HistItem[]; dtf: HistItem[]; total: number } | null>(null)
  const [histLoading,    setHistLoading]    = useState(false)
  const [histOpen,       setHistOpen]       = useState(false)

  // Chat
  const [chatTab,        setChatTab]        = useState<"conversas" | "grupos">("conversas")
  const [convs,          setConvs]          = useState<Conversation[]>([])
  const [chatContact,    setChatContact]    = useState<Conversation | null>(null)
  const [messages,       setMessages]       = useState<Message[]>([])
  const [chatInput,      setChatInput]      = useState("")
  const [sendingChat,    setSendingChat]    = useState(false)
  const [chatSearch,     setChatSearch]     = useState("")
  const [replyTo,        setReplyTo]        = useState<Message | null>(null)
  const [hoveredMsg,     setHoveredMsg]     = useState<number | null>(null)
  const [deletingMsg,    setDeletingMsg]    = useState<number | null>(null)

  // Groups
  const [groups,         setGroups]         = useState<Group[]>([])
  const [selectedGroup,  setSelectedGroup]  = useState<Group | null>(null)
  const [groupMessages,  setGroupMessages]  = useState<GroupMessage[]>([])
  const [loadingGroups,  setLoadingGroups]  = useState(false)
  const [groupMsgSkip,   setGroupMsgSkip]   = useState(0)
  const [groupHasMore,   setGroupHasMore]   = useState(false)
  const [loadingGrpMsg,  setLoadingGrpMsg]  = useState(false)

  const [attLoading, setAttLoading] = useState(false)

  // DTF panel within chat modal
  const [showDtfPanel,    setShowDtfPanel]    = useState(false)
  const [contactDtfOrders,setContactDtfOrders]= useState<DtfOrder[]>([])
  const [linkingDtfMsg,   setLinkingDtfMsg]   = useState<number | null>(null) // message id being linked

  // File upload (send media from PIV)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const [stagedFile,  setStagedFile]  = useState<File | null>(null)
  const [sendingFile, setSendingFile] = useState(false)

  // Delete conversation
  const [deletingConv, setDeletingConv] = useState(false)

  // DTF link toast
  const [dtfLinkToast, setDtfLinkToast] = useState<string | null>(null)

  // Lightbox
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null)

  // Pagination (load older)
  const [msgOffset,        setMsgOffset]        = useState(0)
  const [hasMoreMsgs,      setHasMoreMsgs]      = useState(false)
  const [loadingOlderMsgs, setLoadingOlderMsgs] = useState(false)

  // Drag-and-drop
  const [isDragging, setIsDragging] = useState(false)

  // Global bot settings
  const [chatbotAtivo,  setChatbotAtivo]  = useState(true)
  const [pedidosAuto,   setPedidosAuto]   = useState(true)
  const [togglingBot,   setTogglingBot]   = useState(false)
  const [togglingPed,   setTogglingPed]   = useState(false)

  // Per-service toggles
  const [dtfAtivo,      setDtfAtivo]      = useState(true)
  const [togglingDtf,   setTogglingDtf]   = useState(false)

  // Per-product list
  type ProdConfig = { id: number; name: string; disponivel: boolean; ativoNoCadastro: boolean }
  const [showProdList,  setShowProdList]  = useState(false)
  const [prodList,      setProdList]      = useState<ProdConfig[]>([])

  // Schedule panel
  const [showSchedule,  setShowSchedule]  = useState(false)
  const [savingSchedule,setSavingSchedule]= useState(false)
  // Produto schedule
  const [prodDias,      setProdDias]      = useState<number[]>([1,2,3,4,5,6])
  const [prodInicio,    setProdInicio]    = useState("08:00")
  const [prodFim,       setProdFim]       = useState("18:00")
  const [prodFechadoAte,setProdFechadoAte]= useState("")
  // DTF schedule
  const [dtfDias,       setDtfDias]       = useState<number[]>([1,2,3,4,5,6])
  const [dtfInicio,     setDtfInicio]     = useState("08:00")
  const [dtfFim,        setDtfFim]        = useState("18:00")
  const [dtfFechadoAte, setDtfFechadoAte] = useState("")

  const messagesEndRef  = useRef<HTMLDivElement>(null)
  const chatInputRef    = useRef<HTMLTextAreaElement>(null)
  const latestMsgAt     = useRef<string | null>(null)
  const isFirstLoad     = useRef(false)

  // ── Load global settings ───────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then((s: Record<string, string>) => {
        if (s.chatbot_ativo   !== undefined) setChatbotAtivo(s.chatbot_ativo  !== "false")
        if (s.pedidos_auto    !== undefined) setPedidosAuto(s.pedidos_auto    !== "false")
        if (s.dtf_ativo       !== undefined) setDtfAtivo(s.dtf_ativo          !== "false")
        if (s.produto_horario_dias)   setProdDias(s.produto_horario_dias.split(",").map(Number))
        if (s.produto_horario_inicio) setProdInicio(s.produto_horario_inicio)
        if (s.produto_horario_fim)    setProdFim(s.produto_horario_fim)
        if (s.produto_fechado_ate)    setProdFechadoAte(s.produto_fechado_ate)
        if (s.dtf_horario_dias)       setDtfDias(s.dtf_horario_dias.split(",").map(Number))
        if (s.dtf_horario_inicio)     setDtfInicio(s.dtf_horario_inicio)
        if (s.dtf_horario_fim)        setDtfFim(s.dtf_horario_fim)
        if (s.dtf_fechado_ate)        setDtfFechadoAte(s.dtf_fechado_ate)
      })
      .catch(() => {})
  }, [])

  const loadProdList = useCallback(async () => {
    const r = await fetch("/api/autoatendimento/produtos-config")
    if (r.ok) setProdList(await r.json())
  }, [])

  useEffect(() => { loadProdList() }, [loadProdList])

  async function toggleProdDisponivel(id: number, current: boolean) {
    setProdList(prev => prev.map(p => p.id === id ? { ...p, disponivel: !current } : p))
    await fetch("/api/autoatendimento/produtos-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, disponivel: !current }),
    }).catch(() => setProdList(prev => prev.map(p => p.id === id ? { ...p, disponivel: current } : p)))
  }

  async function toggleChatbot() {
    setTogglingBot(true)
    const next = !chatbotAtivo
    setChatbotAtivo(next)
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chatbot_ativo: String(next) }),
    }).catch(() => setChatbotAtivo(!next))
    setTogglingBot(false)
  }

  async function togglePedidos() {
    setTogglingPed(true)
    const next = !pedidosAuto
    setPedidosAuto(next)
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pedidos_auto: String(next) }),
    }).catch(() => setPedidosAuto(!next))
    setTogglingPed(false)
  }

  async function toggleDtf() {
    setTogglingDtf(true)
    const next = !dtfAtivo
    setDtfAtivo(next)
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dtf_ativo: String(next) }),
    }).catch(() => setDtfAtivo(!next))
    setTogglingDtf(false)
  }

  function toggleDia(set: React.Dispatch<React.SetStateAction<number[]>>, dias: number[], dia: number) {
    set(dias.includes(dia) ? dias.filter(d => d !== dia) : [...dias, dia].sort())
  }

  async function saveSchedule() {
    setSavingSchedule(true)
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        produto_horario_dias:   prodDias.join(","),
        produto_horario_inicio: prodInicio,
        produto_horario_fim:    prodFim,
        produto_fechado_ate:    prodFechadoAte,
        dtf_horario_dias:       dtfDias.join(","),
        dtf_horario_inicio:     dtfInicio,
        dtf_horario_fim:        dtfFim,
        dtf_fechado_ate:        dtfFechadoAte,
      }),
    }).catch(() => {})
    setSavingSchedule(false)
    setShowSchedule(false)
  }

  // ── Load orders ────────────────────────────────────────────────────────────

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await fetch("/api/orders?source=whatsapp")
      const data = await res.json()
      const fresh: Order[] = Array.isArray(data) ? data : []
      setOrders(fresh)
      if (selectedIdRef.current) {
        const refreshed = fresh.find(o => o.id === selectedIdRef.current)
        if (refreshed) setSelected(refreshed)
        else { setSelected(null); selectedIdRef.current = null }
      }
    } finally { setLoadingOrders(false) }
  }, [])

  useEffect(() => { loadOrders() }, [loadOrders])
  useEffect(() => {
    const t = setInterval(loadOrders, 30_000)
    return () => clearInterval(t)
  }, [loadOrders])

  // ── Load DTF orders ─────────────────────────────────────────────────────────

  const loadDtf = useCallback(async () => {
    const r = await fetch(`/api/dtf/pedidos`)
    if (r.ok) {
      const all: DtfOrder[] = await r.json()
      const active = all.filter(p => !["concluido", "cancelado"].includes(p.status))
      setDtfOrders(active)
      if (selectedDtfIdRef.current) {
        const refreshed = active.find(p => p.id === selectedDtfIdRef.current)
        if (refreshed) setSelectedDtf(refreshed)
        else { setSelectedDtf(null); selectedDtfIdRef.current = null }
      }
    }
  }, [])

  // ── Load history ────────────────────────────────────────────────────────────

  const loadHistorico = useCallback(async () => {
    if (histPeriod === "range" && (!histRangeStart || !histRangeEnd)) return
    const [from, to] = getHistDates(histPeriod, histRangeStart, histRangeEnd)
    setHistLoading(true)
    const r = await fetch(`/api/autoatendimento/historico?from=${from}&to=${to}`)
    if (r.ok) setHistorico(await r.json())
    setHistLoading(false)
  }, [histPeriod, histRangeStart, histRangeEnd])

  useEffect(() => { loadDtf() }, [loadDtf])
  useEffect(() => {
    const t = setInterval(loadDtf, 30_000)
    return () => clearInterval(t)
  }, [loadDtf])
  useEffect(() => { if (histOpen) loadHistorico() }, [histOpen, loadHistorico])

  // ── Load conversations ─────────────────────────────────────────────────────

  const loadConvs = useCallback(async () => {
    const r = await fetch("/api/chat/conversations")
    if (r.ok) setConvs(await r.json())
  }, [])

  useEffect(() => {
    fetch("/api/chat/sync", { method: "POST" }).then(() => loadConvs())
  }, [loadConvs])

  // Poll conversations from DB every 5s (fast, local)
  useEffect(() => {
    const t = setInterval(loadConvs, 5_000)
    return () => clearInterval(t)
  }, [loadConvs])

  // Re-sync with Evolution every 5min to update names + profile pics
  useEffect(() => {
    const t = setInterval(() => {
      fetch("/api/chat/sync", { method: "POST" }).catch(() => {})
    }, 5 * 60 * 1000)
    return () => clearInterval(t)
  }, [])

  // ── Load groups (Evolution-direct) ────────────────────────────────────────

  const loadGroups = useCallback(async () => {
    setLoadingGroups(true)
    const r = await fetch("/api/chat/chats?type=groups&skip=0&limit=30")
    if (r.ok) setGroups(await r.json())
    setLoadingGroups(false)
  }, [])

  const loadGroupMessages = useCallback(async (jid: string, replace = true) => {
    if (replace) { setLoadingGrpMsg(true); setGroupMessages([]) }
    const r = await fetch(`/api/chat/thread?jid=${encodeURIComponent(jid)}&skip=0&limit=300`)
    if (r.ok) {
      const { messages: msgs, hasMore } = await r.json()
      setGroupMessages(msgs ?? [])
      setGroupHasMore(hasMore)
      setGroupMsgSkip(msgs?.length ?? 0)
    }
    if (replace) setLoadingGrpMsg(false)
  }, [])

  const loadOlderGroupMsgs = useCallback(async () => {
    if (!selectedGroup || loadingGrpMsg || !groupHasMore) return
    setLoadingGrpMsg(true)
    const r = await fetch(`/api/chat/thread?jid=${encodeURIComponent(selectedGroup.jid)}&skip=${groupMsgSkip}&limit=300`)
    if (r.ok) {
      const { messages: older, hasMore } = await r.json()
      if (older?.length) {
        setGroupMessages(prev => [...(older as GroupMessage[]), ...prev])
        setGroupMsgSkip(prev => prev + older.length)
        setGroupHasMore(hasMore)
      }
    }
    setLoadingGrpMsg(false)
  }, [selectedGroup, groupMsgSkip, groupHasMore, loadingGrpMsg])

  useEffect(() => {
    if (chatTab === "grupos") loadGroups()
  }, [chatTab, loadGroups])

  useEffect(() => {
    if (!selectedGroup) return
    loadGroupMessages(selectedGroup.jid)
    const t = setInterval(() => {
      fetch(`/api/chat/thread?jid=${encodeURIComponent(selectedGroup.jid)}&skip=0&limit=20`)
        .then(r => r.ok ? r.json() : null)
        .then(data => {
          if (!data?.messages?.length) return
          setGroupMessages(prev => {
            const ids = new Set(prev.map(m => m.id))
            const newOnes = data.messages.filter((m: GroupMessage) => !ids.has(m.id))
            return newOnes.length ? [...prev, ...newOnes] : prev
          })
        })
    }, 5_000)
    return () => clearInterval(t)
  }, [selectedGroup, loadGroupMessages])

  // ── Load messages (full load ao selecionar, incremental poll) ─────────────

  const refreshMediaUrls = useCallback(async (
    contactId: number, pendingIds: Set<number>, attempt = 0
  ) => {
    const r = await fetch(`/api/chat/messages?contactId=${contactId}&noSync=1`)
    if (!r.ok) return
    const data = await r.json()
    const msgs: Message[] = Array.isArray(data) ? data : (data.messages ?? [])
    const byId = new Map(msgs.map(m => [m.id, m]))
    const stillPending = new Set<number>()
    setMessages(prev => prev.map(m => {
      if (!pendingIds.has(m.id)) return m
      const updated = byId.get(m.id)
      if (!updated?.mediaUrl) { stillPending.add(m.id); return m }
      return { ...m, mediaUrl: updated.mediaUrl, mediaCategory: updated.mediaCategory }
    }))
    // Retry with backoff: 8s, 16s, 30s — para dar tempo ao waitUntil de terminar
    const delays = [8_000, 16_000, 30_000]
    if (stillPending.size > 0 && attempt < delays.length) {
      setTimeout(() => refreshMediaUrls(contactId, stillPending, attempt + 1), delays[attempt])
    }
  }, [])

  const loadMessages = useCallback(async (contactId: number) => {
    const r = await fetch(`/api/chat/messages?contactId=${contactId}`)
    if (!r.ok) return
    const data = await r.json()
    const msgs: Message[] = Array.isArray(data) ? data : (data.messages ?? [])
    const more: boolean   = Array.isArray(data) ? false : (data.hasMore ?? false)
    setMessages(msgs)
    setHasMoreMsgs(more)
    setMsgOffset(0)
    latestMsgAt.current = msgs.length > 0 ? msgs[msgs.length - 1].createdAt : null

    const pendingIds = new Set(msgs.filter(m => m.mediaType && !m.mediaUrl).map(m => m.id))
    if (pendingIds.size > 0) {
      setTimeout(() => refreshMediaUrls(contactId, pendingIds), 5_000)
    }
  }, [refreshMediaUrls])

  const loadOlderMsgs = useCallback(async (contactId: number, currentOffset: number) => {
    setLoadingOlderMsgs(true)
    const newOffset = currentOffset + 60
    const r = await fetch(`/api/chat/messages?contactId=${contactId}&offset=${newOffset}`)
    if (r.ok) {
      const data = await r.json()
      const older: Message[] = Array.isArray(data) ? data : (data.messages ?? [])
      const more: boolean    = Array.isArray(data) ? false : (data.hasMore ?? false)
      if (older.length > 0) {
        setMessages(prev => [...older, ...prev])
        setMsgOffset(newOffset)
      }
      setHasMoreMsgs(more)
    }
    setLoadingOlderMsgs(false)
  }, [])

  const pollMessages = useCallback(async (contactId: number) => {
    if (!latestMsgAt.current) return
    const r = await fetch(`/api/chat/messages?contactId=${contactId}&since=${encodeURIComponent(latestMsgAt.current)}`)
    if (!r.ok) return
    const newMsgs: Message[] = await r.json()
    if (newMsgs.length === 0) return
    setMessages(prev => {
      const existingIds = new Set(prev.map(m => m.id))
      const deduped = newMsgs.filter(m => !existingIds.has(m.id))
      if (deduped.length === 0) return prev
      return [...prev, ...deduped]
    })
    latestMsgAt.current = newMsgs[newMsgs.length - 1].createdAt
    loadConvs()
  }, [loadConvs])

  const loadContactDtfOrders = useCallback(async (contactId: number) => {
    const r = await fetch(`/api/dtf/pedidos?contactId=${contactId}`)
    if (r.ok) setContactDtfOrders(await r.json())
  }, [])

  const syncOutgoing = useCallback(async (contactId: number, jid: string) => {
    await fetch(`/api/chat/sync-outgoing?contactId=${contactId}&jid=${encodeURIComponent(jid)}`).catch(() => {})
  }, [])

  useEffect(() => {
    if (!chatContact) return
    latestMsgAt.current = null
    isFirstLoad.current = true
    // Carrega do DB imediatamente; sync de saída em paralelo + poll rápido depois
    loadMessages(chatContact.id)
    syncOutgoing(chatContact.id, chatContact.jid).then(() => pollMessages(chatContact.id))
    loadContactDtfOrders(chatContact.id)
    // Mark as read in DB + send read receipt to WA (bidirectional)
    fetch("/api/chat/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: chatContact.id, jid: chatContact.jid }),
    }).then(() => loadConvs())
  }, [chatContact, syncOutgoing, loadMessages, pollMessages, loadConvs, loadContactDtfOrders])

  useEffect(() => {
    if (!chatContact) return
    const t = setInterval(() => pollMessages(chatContact.id), 3_000)
    // Sync outgoing every 15s so messages PIV sends while chat is open appear
    const s = setInterval(() => {
      syncOutgoing(chatContact.id, chatContact.jid).then(() => pollMessages(chatContact.id))
    }, 15_000)
    return () => { clearInterval(t); clearInterval(s) }
  }, [chatContact, pollMessages, syncOutgoing])

  // ── Attention actions ──────────────────────────────────────────────────────

  async function attAction(action: "dismiss" | "pause_temp" | "pause_perm") {
    if (!chatContact) return
    setAttLoading(true)
    await fetch("/api/chat/attention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: chatContact.id, action }),
    })
    await loadConvs()
    setAttLoading(false)
  }

  useEffect(() => {
    if (messages.length === 0) return
    messagesEndRef.current?.scrollIntoView({ behavior: "instant" })
  }, [messages])

  // ── Send message ───────────────────────────────────────────────────────────

  async function sendMessage() {
    if (!chatContact || !chatInput.trim() || sendingChat) return
    setSendingChat(true)
    const text = chatInput.trim()
    const quoted = replyTo
    setChatInput("")
    setReplyTo(null)

    const tempId = -Date.now()
    setMessages(prev => [...prev, {
      id: tempId,
      messageId: null,
      direction: "out" as const,
      content: text,
      mediaType: null, mediaUrl: null, mediaCategory: null,
      fileName: null, caption: null,
      status: "sent" as const,
      quotedMessageId: quoted?.messageId ?? null,
      quotedContent: quoted?.content ?? null,
      createdAt: new Date().toISOString(),
    }])
    setSendingChat(false)
    chatInputRef.current?.focus()

    fetch("/api/chat/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contactId: chatContact.id,
        jid: chatContact.jid,
        content: text,
        quotedMsgId: quoted?.messageId ?? undefined,
        quotedContent: quoted?.content ?? undefined,
        quotedFromMe: quoted?.direction === "out",
      }),
    })
      .then(() => { loadMessages(chatContact.id); loadConvs() })
      .catch(() => { loadMessages(chatContact.id) })
  }

  // Clipboard paste → staged file
  useEffect(() => {
    if (!chatContact) return
    const onPaste = (e: ClipboardEvent) => {
      const file = e.clipboardData?.files?.[0]
      if (file) { e.preventDefault(); setStagedFile(file) }
    }
    window.addEventListener("paste", onPaste)
    return () => window.removeEventListener("paste", onPaste)
  }, [chatContact])

  function onChatKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }

  async function deleteMessage(m: Message) {
    if (!chatContact) return
    setDeletingMsg(m.id)
    await fetch("/api/chat/delete-message", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        messageDbId: m.id,
        messageId: null,
        jid: chatContact.jid,
        fromMe: m.direction === "out",
        onlyLocally: m.direction === "in", // in = delete local only; out = delete for everyone
      }),
    }).catch(() => {})
    setMessages(prev => prev.filter(x => x.id !== m.id))
    setDeletingMsg(null)
  }

  async function deleteConversation() {
    if (!chatContact || !confirm(`Apagar toda a conversa com ${chatContact.name || chatContact.phone}? Isso remove as mensagens daqui e do WhatsApp da SM.`)) return
    setDeletingConv(true)
    await fetch("/api/chat/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: chatContact.id, jid: chatContact.jid }),
    }).catch(() => {})
    setMessages([])
    setChatContact(null)
    loadConvs()
    setDeletingConv(false)
  }

  async function linkDtfFile(m: Message) {
    if (!chatContact || !m.mediaUrl) return
    setLinkingDtfMsg(m.id)
    setDtfLinkToast(null)
    try {
      const r = await fetch("/api/chat/dtf-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: chatContact.id,
          waMessageId: m.id,
          fileUrl: m.mediaUrl,
          fileName: m.fileName,
          mimeType: null,
        }),
      })
      const data = await r.json()
      if (!r.ok) {
        setDtfLinkToast(`Erro: ${data.error ?? "falha ao vincular"}`)
        return
      }
      const toast = data.alreadyLinked
        ? `Já vinculado ao pedido ${data.pedidoNumber}`
        : `${data.created ? "Pedido criado" : "Vinculado ao pedido"} ${data.pedidoNumber}`
      setDtfLinkToast(toast)
      setShowDtfPanel(true)
      // Await so the panel renders with fresh data
      await loadContactDtfOrders(chatContact.id)
    } finally {
      setLinkingDtfMsg(null)
    }
  }

  async function downloadDtfOrder(orderId: number, attachCount: number, contactName: string) {
    try {
      const r = await fetch(`/api/dtf/pedidos/${orderId}/download`)
      if (!r.ok) return
      const blob = await r.blob()
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement("a")
      a.href     = url
      // Browser will use Content-Disposition filename from server
      a.download = attachCount > 1 ? `${contactName}-artes.zip` : `${contactName}-arte`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch { /* silent */ }
  }

  async function sendFile() {
    if (!chatContact || !stagedFile || sendingFile) return
    setSendingFile(true)
    const form = new FormData()
    form.append("jid", chatContact.jid)
    form.append("contactId", String(chatContact.id))
    form.append("caption", chatInput.trim())
    form.append("file", stagedFile)
    setChatInput("")
    setStagedFile(null)
    await fetch("/api/chat/send-media", { method: "POST", body: form }).catch(() => {})
    await loadMessages(chatContact.id)
    setSendingFile(false)
  }

  function onDragOver(e: React.DragEvent) { e.preventDefault(); setIsDragging(true) }
  function onDragLeave(e: React.DragEvent) { if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDragging(false) }
  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files?.[0]
    if (file) setStagedFile(file)
  }

  function initials(name: string | null, phone: string) {
    const n = name || phone
    const parts = n.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    return n.slice(0, 2).toUpperCase()
  }

  function avatarColor(id: number) {
    const colors = ["#4361EE","#7B2FBE","#E63946","#2EC4B6","#F4A261","#2A9D8F","#E76F51"]
    return colors[id % colors.length]
  }

  // ── Filter ─────────────────────────────────────────────────────────────────

  const filteredConvs  = chatSearch
    ? convs.filter(c => (c.name ?? "").toLowerCase().includes(chatSearch.toLowerCase()) || c.phone.includes(chatSearch))
    : convs

  const totalUnread = convs.reduce((s, c) => s + c.unread, 0)

  return (
    <div className="flex h-[calc(100vh-88px)] -m-6 overflow-hidden">

      {/* ── LEFT: Chat panel ── */}
      <div className="w-[300px] flex-shrink-0 flex flex-col bg-white border-r border-[#0F1E3C]/6">

        {/* Chat tabs */}
        <div className="flex border-b border-[#0F1E3C]/6 flex-shrink-0">
          <button
            onClick={() => { setChatTab("conversas"); setChatContact(null); setMessages([]) }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors ${
              chatTab === "conversas"
                ? "text-[#4361EE] border-b-2 border-[#4361EE]"
                : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]"
            }`}
          >
            <MessageCircle size={13} />
            Conversas
            {totalUnread > 0 && chatTab !== "conversas" && (
              <span className="text-[8px] font-black bg-[#4361EE] text-white w-4 h-4 rounded-full flex items-center justify-center">{totalUnread > 9 ? "9+" : totalUnread}</span>
            )}
          </button>
          <button
            onClick={() => { setChatTab("grupos"); setSelectedGroup(null); setGroupMessages([]) }}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs font-bold transition-colors ${
              chatTab === "grupos"
                ? "text-[#0F1E3C] border-b-2 border-[#0F1E3C]"
                : "text-[#0F1E3C]/40 hover:text-[#0F1E3C]"
            }`}
          >
            <Users size={13} />
            Grupos
          </button>
        </div>

        {/* ── CONVERSAS ── */}
        {chatTab === "conversas" && (
          <>
            <div className="px-3 py-2 flex-shrink-0">
              <div className="relative">
                <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[#0F1E3C]/25 pointer-events-none" />
                <input value={chatSearch} onChange={e => setChatSearch(e.target.value)} placeholder="Buscar..."
                  className="w-full pl-7 pr-3 py-1.5 rounded-lg bg-[#F4F6FB] text-xs text-[#0F1E3C] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/20" />
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {filteredConvs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#0F1E3C]/20">
                  <MessageCircle size={24} strokeWidth={1.2} />
                  <p className="text-[10px]">Nenhuma conversa</p>
                </div>
              ) : [...filteredConvs]
                  .sort((a, b) => (b.needsAttention ? 1 : 0) - (a.needsAttention ? 1 : 0))
                  .map(c => (
                <button key={c.id} onClick={() => { latestMsgAt.current = null; setReplyTo(null); setChatContact(c) }}
                  className={`w-full text-left px-3 py-2.5 border-b border-[#0F1E3C]/4 transition-colors ${
                    chatContact?.id === c.id ? "bg-[#4361EE]/8" :
                    c.needsAttention ? "bg-orange-50 border-l-2 border-l-orange-400 hover:bg-orange-100"
                    : "hover:bg-[#F4F6FB]"
                  }`}>
                  <div className="flex items-center gap-2.5">
                    {/* Avatar */}
                    <div className="flex-shrink-0 w-9 h-9 rounded-full overflow-hidden flex-shrink-0">
                      {c.profilePic ? (
                        <img src={c.profilePic} alt={c.name || c.phone}
                          className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white text-[11px] font-black"
                          style={{ background: avatarColor(c.id) }}>
                          {initials(c.name, c.phone)}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <div className="flex items-center gap-1 min-w-0">
                          {c.needsAttention && <AlertCircle size={10} className="flex-shrink-0 text-orange-500" />}
                          <p className="text-[11px] font-bold text-[#0F1E3C] truncate">{c.name || fmtPhone(c.phone)}</p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          {c.unread > 0 && (
                            <span className="text-[8px] font-black bg-[#4361EE] text-white w-3.5 h-3.5 rounded-full flex items-center justify-center">{c.unread > 9 ? "9+" : c.unread}</span>
                          )}
                          <p className="text-[9px] text-[#0F1E3C]/20">{fmtTime(c.lastAt)}</p>
                        </div>
                      </div>
                      <p className="text-[9px] text-[#0F1E3C]/35 truncate">{fmtPhone(c.phone)}</p>
                      <p className={`text-[10px] truncate ${c.unread > 0 ? "font-semibold text-[#0F1E3C]/60" : "text-[#0F1E3C]/30"}`}>
                        {c.lastDirection === "out" && <span className="text-[#4361EE]/50">Você: </span>}
                        {formatMsgPreview(c.lastMessage)}
                      </p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {/* ── GRUPOS ── */}
        {chatTab === "grupos" && (
          <div className="flex-1 overflow-y-auto">
            {loadingGroups ? (
              <div className="flex items-center justify-center py-12">
                <div className="w-4 h-4 border-2 border-[#0F1E3C]/30 border-t-transparent rounded-full animate-spin" />
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2 text-[#0F1E3C]/20">
                <Users size={24} strokeWidth={1.2} />
                <p className="text-[10px]">Nenhum grupo ainda</p>
              </div>
            ) : groups.map(g => (
              <button key={g.jid} onClick={() => setSelectedGroup(g)}
                className={`w-full text-left px-3 py-2.5 border-b border-[#0F1E3C]/4 transition-colors ${selectedGroup?.jid === g.jid ? "bg-[#4361EE]/8" : "hover:bg-[#F4F6FB]"}`}>
                <div className="flex items-center gap-2.5">
                  <div className="flex-shrink-0 w-9 h-9 rounded-full bg-emerald-50 flex items-center justify-center text-emerald-600">
                    <Users size={14} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <p className="text-[11px] font-bold text-[#0F1E3C] truncate">{g.name || g.jid}</p>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {g.unread > 0 && (
                          <span className="text-[8px] font-black bg-[#25D366] text-white w-3.5 h-3.5 rounded-full flex items-center justify-center">{g.unread > 9 ? "9+" : g.unread}</span>
                        )}
                        <p className="text-[9px] text-[#0F1E3C]/20">{fmtTime(g.lastAt)}</p>
                      </div>
                    </div>
                    <p className="text-[10px] truncate text-[#0F1E3C]/30">
                      {g.lastSender && !g.fromMe && <span className="text-[#0F1E3C]/50">{g.lastSender.split(" ")[0]}: </span>}
                      {g.fromMe && <span className="text-[#4361EE]/40">Você: </span>}
                      {g.lastMessage ?? "—"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT: Orders panel ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden bg-[#F4F6FB]">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 bg-white border-b border-[#0F1E3C]/6 flex-shrink-0">
          <div>
            <h1 className="text-lg font-bold text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>
              Autoatendimento
            </h1>
            <p className="text-[10px] text-[#0F1E3C]/40 mt-0.5">Pedidos recebidos via WhatsApp</p>
          </div>

          <div className="flex items-center gap-3">

            {/* Toggle Chatbot */}
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold text-[#0F1E3C]/50">Chatbot</p>
              <Tip text="Liga ou desliga as respostas automáticas do bot para todos os contatos." />
              <button onClick={toggleChatbot} disabled={togglingBot}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${chatbotAtivo ? "bg-[#4361EE]" : "bg-[#0F1E3C]/15"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${chatbotAtivo ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            {/* Toggle Pedidos auto */}
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold text-[#0F1E3C]/50">Auto</p>
              <Tip text="Com o chatbot mudo, detecta pedidos nas mensagens e cria na triagem automaticamente, sem responder o cliente." />
              <button onClick={togglePedidos} disabled={togglingPed}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${pedidosAuto ? "bg-amber-500" : "bg-[#0F1E3C]/15"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${pedidosAuto ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            <div className="w-px h-5 bg-[#0F1E3C]/8" />

            {/* Produto — lista por produto */}
            <div className="flex items-center gap-1">
              <Tip text="Controla quais produtos estão disponíveis para pedido via chatbot. Produtos desativados não aparecem no catálogo e somem do estoque consultado." />
              <button onClick={() => setShowProdList(v => !v)}
                className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-colors border ${
                  showProdList
                    ? "bg-emerald-600 text-white border-emerald-600"
                    : "bg-white text-[#0F1E3C]/50 border-[#0F1E3C]/12 hover:text-[#0F1E3C]"
                }`}>
                Produtos
                {prodList.length > 0 && (
                  <span className={`text-[9px] font-black px-1.5 py-0.5 rounded-full ${
                    showProdList ? "bg-white/20 text-white" : "bg-[#0F1E3C]/8 text-[#0F1E3C]/50"
                  }`}>
                    {prodList.filter(p => p.disponivel).length}/{prodList.length}
                  </span>
                )}
                <span className="text-[8px]">{showProdList ? "▲" : "▼"}</span>
              </button>
            </div>

            {/* Toggle DTF */}
            <div className="flex items-center gap-1.5">
              <p className="text-[10px] font-bold text-[#0F1E3C]/50">DTF</p>
              <Tip text="Liga ou desliga o serviço de impressão DTF no chatbot. Quando desligado, o bot não aceita artes nem cria pedidos DTF." />
              <button onClick={toggleDtf} disabled={togglingDtf}
                className={`relative inline-flex h-5 w-9 flex-shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ${dtfAtivo ? "bg-[#7C3AED]" : "bg-[#0F1E3C]/15"}`}>
                <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${dtfAtivo ? "translate-x-4" : "translate-x-0.5"}`} />
              </button>
            </div>

            <div className="w-px h-5 bg-[#0F1E3C]/8" />

            {/* Horários */}
            <div className="flex items-center gap-1">
              <Tip text="Define dias e horários de funcionamento por serviço, e permite programar um fechamento temporário com data de retorno." />
              <button onClick={() => setShowSchedule(v => !v)}
                className={`flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-[10px] font-bold transition-colors border ${
                  showSchedule
                    ? "bg-[#0F1E3C] text-white border-[#0F1E3C]"
                    : "bg-white text-[#0F1E3C]/50 border-[#0F1E3C]/12 hover:text-[#0F1E3C]"
                }`}>
                ⏰ Horários
              </button>
            </div>

            <button onClick={() => { loadOrders(); loadDtf() }}
              className="p-2 rounded-xl text-[#0F1E3C]/40 hover:bg-white hover:text-[#0F1E3C] transition-colors">
              <RefreshCw size={14} className={loadingOrders ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* ── Product availability panel ── */}
        {showProdList && (
          <div className="border-b border-[#0F1E3C]/6 bg-white px-5 py-3 flex-shrink-0">
            <p className="text-[10px] font-bold text-[#0F1E3C]/40 uppercase tracking-widest mb-3">Disponibilidade por produto</p>
            {prodList.length === 0 ? (
              <p className="text-xs text-[#0F1E3C]/30">Nenhum produto cadastrado.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {prodList.map(p => {
                  if (!p.ativoNoCadastro) {
                    return (
                      <div key={p.id} title="Desativado no cadastro do produto — ative em Produtos para usar no chatbot"
                        className="flex items-center gap-2 px-3 py-2 rounded-xl border border-dashed border-[#0F1E3C]/12 text-xs font-semibold text-[#0F1E3C]/25 cursor-not-allowed select-none">
                        <span className="w-2 h-2 rounded-full flex-shrink-0 bg-[#0F1E3C]/15" />
                        {p.name}
                        <span className="text-[9px] font-bold bg-[#0F1E3C]/8 text-[#0F1E3C]/30 px-1.5 py-0.5 rounded-full">cadastro off</span>
                      </div>
                    )
                  }
                  return (
                    <button key={p.id} onClick={() => toggleProdDisponivel(p.id, p.disponivel)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                        p.disponivel
                          ? "bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100"
                          : "bg-[#F4F6FB] border-[#0F1E3C]/10 text-[#0F1E3C]/35 line-through hover:bg-[#eee]"
                      }`}>
                      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${p.disponivel ? "bg-emerald-500" : "bg-[#0F1E3C]/20"}`} />
                      {p.name}
                    </button>
                  )
                })}
              </div>
            )}
            {prodList.some(p => !p.ativoNoCadastro) && (
              <p className="text-[9px] text-[#0F1E3C]/30 mt-3">
                Produtos com <span className="font-bold">cadastro off</span> precisam ser ativados em <span className="font-bold">Produtos → Chatbot</span> antes de aparecerem aqui.
              </p>
            )}
          </div>
        )}

        {/* ── Schedule panel ── */}
        {showSchedule && (
          <div className="border-b border-[#0F1E3C]/6 bg-white px-5 py-4 flex-shrink-0">
            {(() => {
              const DIAS = [
                { n: 0, l: "D" }, { n: 1, l: "S" }, { n: 2, l: "T" },
                { n: 3, l: "Q" }, { n: 4, l: "Q" }, { n: 5, l: "S" }, { n: 6, l: "S" },
              ]
              return (
                <div className="grid grid-cols-2 gap-6">
                  {/* Produto */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-emerald-700 uppercase tracking-widest">Produto</p>
                    <div>
                      <p className="text-[10px] text-[#0F1E3C]/40 mb-1.5">Dias</p>
                      <div className="flex gap-1">
                        {DIAS.map(({ n, l }) => (
                          <button key={n} onClick={() => toggleDia(setProdDias, prodDias, n)}
                            className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-colors ${
                              prodDias.includes(n) ? "bg-emerald-500 text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/30"
                            }`}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-[10px] text-[#0F1E3C]/40 mb-1">Das</p>
                        <input type="time" value={prodInicio} onChange={e => setProdInicio(e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400/30" />
                      </div>
                      <div className="mt-4 text-[#0F1E3C]/30 text-xs">às</div>
                      <div>
                        <p className="text-[10px] text-[#0F1E3C]/40 mb-1">Até</p>
                        <input type="time" value={prodFim} onChange={e => setProdFim(e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400/30" />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#0F1E3C]/40 mb-1">Fechado até (opcional)</p>
                      <div className="flex items-center gap-2">
                        <input type="datetime-local" value={prodFechadoAte} onChange={e => setProdFechadoAte(e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-emerald-400/30" />
                        {prodFechadoAte && (
                          <button onClick={() => setProdFechadoAte("")}
                            className="text-[10px] text-[#0F1E3C]/30 hover:text-red-500">Limpar</button>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* DTF */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold text-[#7C3AED] uppercase tracking-widest">DTF</p>
                    <div>
                      <p className="text-[10px] text-[#0F1E3C]/40 mb-1.5">Dias</p>
                      <div className="flex gap-1">
                        {DIAS.map(({ n, l }) => (
                          <button key={n} onClick={() => toggleDia(setDtfDias, dtfDias, n)}
                            className={`w-7 h-7 rounded-lg text-[10px] font-bold transition-colors ${
                              dtfDias.includes(n) ? "bg-[#7C3AED] text-white" : "bg-[#F4F6FB] text-[#0F1E3C]/30"
                            }`}>{l}</button>
                        ))}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div>
                        <p className="text-[10px] text-[#0F1E3C]/40 mb-1">Das</p>
                        <input type="time" value={dtfInicio} onChange={e => setDtfInicio(e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400/30" />
                      </div>
                      <div className="mt-4 text-[#0F1E3C]/30 text-xs">às</div>
                      <div>
                        <p className="text-[10px] text-[#0F1E3C]/40 mb-1">Até</p>
                        <input type="time" value={dtfFim} onChange={e => setDtfFim(e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400/30" />
                      </div>
                    </div>
                    <div>
                      <p className="text-[10px] text-[#0F1E3C]/40 mb-1">Fechado até (opcional)</p>
                      <div className="flex items-center gap-2">
                        <input type="datetime-local" value={dtfFechadoAte} onChange={e => setDtfFechadoAte(e.target.value)}
                          className="px-2 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400/30" />
                        {dtfFechadoAte && (
                          <button onClick={() => setDtfFechadoAte("")}
                            className="text-[10px] text-[#0F1E3C]/30 hover:text-red-500">Limpar</button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })()}
            <div className="mt-4 flex justify-end">
              <button onClick={saveSchedule} disabled={savingSchedule}
                className="px-4 py-2 rounded-xl bg-[#0F1E3C] text-white text-xs font-bold hover:bg-[#0F1E3C]/80 disabled:opacity-50 transition-colors">
                {savingSchedule ? "Salvando..." : "Salvar horários"}
              </button>
            </div>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-6">

          {/* ── Produto kanban ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <ShoppingBag size={13} className="text-[#4361EE]" />
              <p className="text-xs font-bold text-[#4361EE] uppercase tracking-widest">Produto</p>
              {loadingOrders && orders.length === 0 && (
                <div className="w-3 h-3 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
              )}
            </div>
            <div className="overflow-x-auto">
              <div className="flex gap-3 pb-2" style={{ minWidth: "max-content" }}>
                {PROD_COLS.map(col => {
                  const colOrders = orders.filter(o => o.status === col.key)
                  return (
                    <div key={col.key} className="w-64 flex-shrink-0">
                      <div className={`flex items-center justify-between mb-2 px-3 py-2 rounded-xl border ${col.hdr}`}>
                        <p className={`text-xs font-bold ${col.txt}`}>{col.label}</p>
                        {colOrders.length > 0 && (
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${col.badge}`}>{colOrders.length}</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {colOrders.length === 0 ? (
                          <div className="h-16 flex items-center justify-center rounded-xl border border-dashed border-[#0F1E3C]/10">
                            <p className="text-[10px] text-[#0F1E3C]/20">vazio</p>
                          </div>
                        ) : colOrders.map(order => (
                          <OrderCard key={order.id} order={order} onClick={() => { selectedIdRef.current = order.id; setSelected(order) }} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── DTF kanban ── */}
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Printer size={13} className="text-[#7C3AED]" />
              <p className="text-xs font-bold text-[#7C3AED] uppercase tracking-widest">DTF</p>
            </div>
            <div className="overflow-x-auto">
              <div className="flex gap-3 pb-2" style={{ minWidth: "max-content" }}>
                {DTF_COLS.map(col => {
                  const colDtf = dtfOrders.filter(p => p.status === col.key)
                  return (
                    <div key={col.key} className="w-64 flex-shrink-0">
                      <div className={`flex items-center justify-between mb-2 px-3 py-2 rounded-xl border ${col.hdr}`}>
                        <p className={`text-xs font-bold ${col.txt}`}>{col.label}</p>
                        {colDtf.length > 0 && (
                          <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${col.badge}`}>{colDtf.length}</span>
                        )}
                      </div>
                      <div className="space-y-2">
                        {colDtf.length === 0 ? (
                          <div className="h-16 flex items-center justify-center rounded-xl border border-dashed border-[#0F1E3C]/10">
                            <p className="text-[10px] text-[#0F1E3C]/20">vazio</p>
                          </div>
                        ) : colDtf.map(p => (
                          <DtfOrderCard key={p.id} order={p} onClick={() => { selectedDtfIdRef.current = p.id; setSelectedDtf(p) }} />
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>

          {/* ── Histórico concluídos ── */}
          <div className="border border-[#0F1E3C]/8 rounded-2xl bg-white overflow-hidden">
            <button
              onClick={() => setHistOpen(v => !v)}
              className="w-full flex items-center justify-between px-5 py-3 hover:bg-[#F4F6FB] transition-colors"
            >
              <div className="flex items-center gap-2">
                <History size={13} className="text-[#0F1E3C]/35" />
                <p className="text-xs font-bold text-[#0F1E3C]/50 uppercase tracking-widest">Histórico Concluídos</p>
                {historico && (
                  <span className="text-[10px] font-bold bg-[#0F1E3C]/8 text-[#0F1E3C]/50 px-2 py-0.5 rounded-full">
                    {historico.total}
                  </span>
                )}
              </div>
              {histOpen ? <ChevronUp size={14} className="text-[#0F1E3C]/30" /> : <ChevronDown size={14} className="text-[#0F1E3C]/30" />}
            </button>

            {histOpen && (
              <div className="border-t border-[#0F1E3C]/6 px-5 py-4 space-y-4">
                {/* Period filter */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-center gap-1 flex-wrap">
                    {HIST_OPTIONS.map(opt => (
                      <button key={opt.key} onClick={() => setHistPeriod(opt.key)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                          histPeriod === opt.key
                            ? "bg-[#4361EE] text-white"
                            : "bg-[#F4F6FB] text-[#0F1E3C]/50 hover:text-[#0F1E3C]"
                        }`}>
                        {opt.label}
                      </button>
                    ))}
                  </div>
                  {histPeriod === "range" && (
                    <div className="flex items-center gap-2">
                      <input type="date" value={histRangeStart} onChange={e => setHistRangeStart(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
                      <span className="text-xs text-[#0F1E3C]/40">até</span>
                      <input type="date" value={histRangeEnd} onChange={e => setHistRangeEnd(e.target.value)}
                        className="px-3 py-1.5 rounded-lg border border-[#0F1E3C]/12 text-xs focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
                    </div>
                  )}
                </div>

                {histLoading ? (
                  <div className="flex justify-center py-6">
                    <div className="w-5 h-5 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
                  </div>
                ) : !historico || historico.total === 0 ? (
                  <p className="text-center text-xs text-[#0F1E3C]/25 py-6">Nenhum pedido concluído no período.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="bg-[#F4F6FB] text-[#0F1E3C]/40 uppercase tracking-wider text-[10px]">
                          <th className="px-4 py-2 text-left">Pedido</th>
                          <th className="px-4 py-2 text-left">Tipo</th>
                          <th className="px-4 py-2 text-left">Cliente</th>
                          <th className="px-4 py-2 text-right">Valor</th>
                          <th className="px-4 py-2 text-left">Vencimento</th>
                          <th className="px-4 py-2 text-left">Concluído</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[#0F1E3C]/4">
                        {[...(historico.produto ?? []), ...(historico.dtf ?? [])]
                          .sort((a, b) => new Date(b.concludedAt).getTime() - new Date(a.concludedAt).getTime())
                          .map(h => (
                            <tr key={`${h.tipo}-${h.id}`} className="hover:bg-[#F4F6FB]/60 transition-colors">
                              <td className="px-4 py-2.5 font-bold text-[#0F1E3C]">{h.number}</td>
                              <td className="px-4 py-2.5">
                                <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                                  h.tipo === "dtf" ? "bg-purple-100 text-purple-700" : "bg-blue-100 text-blue-700"
                                }`}>
                                  {h.tipo === "dtf" ? "DTF" : "Produto"}
                                </span>
                              </td>
                              <td className="px-4 py-2.5 text-[#0F1E3C]/60">{h.contactName ?? "—"}</td>
                              <td className="px-4 py-2.5 text-right font-semibold text-[#0F1E3C]">
                                {h.valor ? `R$ ${Number(h.valor).toFixed(2).replace(".", ",")}` : "—"}
                              </td>
                              <td className="px-4 py-2.5 text-[#0F1E3C]/50">
                                {h.dueDate ? new Date(h.dueDate + "T12:00:00").toLocaleDateString("pt-BR") : "À vista"}
                              </td>
                              <td className="px-4 py-2.5 text-[#0F1E3C]/40">
                                {new Date(h.concludedAt).toLocaleDateString("pt-BR", { timeZone: TZ_BR })}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Modals */}
      {selected && (
        <OrderModal order={selected} onClose={() => { setSelected(null); selectedIdRef.current = null }} onRefresh={() => loadOrders()} />
      )}
      {selectedDtf && (
        <DtfOrderModal order={selectedDtf} onClose={() => { setSelectedDtf(null); selectedDtfIdRef.current = null }} onRefresh={() => loadDtf()} />
      )}

      {/* ── MODAL: Chat individual ── */}
      {chatContact && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) { setChatContact(null); setReplyTo(null); setShowDtfPanel(false) } }}>
          <div className={`bg-white rounded-2xl shadow-2xl w-full flex overflow-hidden ${showDtfPanel ? "max-w-5xl" : "max-w-3xl"}`}
            style={{ height: "82vh" }}>

          {/* Chat column */}
          <div className="flex-1 min-w-0 flex flex-col overflow-hidden">

            {/* Header */}
            <div className={`flex items-center gap-3 px-4 py-3 flex-shrink-0 border-b ${chatContact.needsAttention ? "bg-orange-50 border-orange-200" : "bg-white border-[#0F1E3C]/6"}`}>
              <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                {chatContact.profilePic ? (
                  <img src={chatContact.profilePic} alt={chatContact.name || chatContact.phone}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-xs font-black"
                    style={{ background: avatarColor(chatContact.id) }}>
                    {initials(chatContact.name, chatContact.phone)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#0F1E3C] truncate">{chatContact.name || fmtPhone(chatContact.phone)}</p>
                <div className="flex items-center gap-2">
                  <p className="text-[10px] text-[#0F1E3C]/40 flex items-center gap-0.5">
                    <Phone size={9} /> {fmtPhone(chatContact.phone)}
                  </p>
                  {chatContact.lifecycleState && (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${LIFECYCLE_COLOR[chatContact.lifecycleState] ?? "bg-gray-100 text-gray-500"}`}>
                      {LIFECYCLE_LABEL[chatContact.lifecycleState] ?? chatContact.lifecycleState}
                    </span>
                  )}
                </div>
              </div>
              {/* Bot actions — always visible */}
              <div className="flex items-center gap-1 flex-shrink-0">
                {chatContact.needsAttention && (
                  <span className="text-[9px] font-bold text-orange-600 flex items-center gap-1 mr-1">
                    <AlertCircle size={10} /> Quer atendimento
                  </span>
                )}
                <button onClick={() => attAction("pause_temp")} disabled={attLoading} title="Silenciar bot 12h"
                  className="flex items-center gap-0.5 text-[9px] font-bold px-2 py-1 rounded-lg bg-[#F4F6FB] border border-[#0F1E3C]/10 text-[#0F1E3C]/60 hover:bg-amber-50 hover:text-amber-700 hover:border-amber-200 disabled:opacity-40 transition-colors">
                  <BotOff size={10} /> 12h
                </button>
                <button onClick={() => attAction("pause_perm")} disabled={attLoading} title="Silenciar bot permanente"
                  className="flex items-center gap-0.5 text-[9px] font-bold px-2 py-1 rounded-lg bg-[#F4F6FB] border border-[#0F1E3C]/10 text-[#0F1E3C]/60 hover:bg-red-50 hover:text-red-700 hover:border-red-200 disabled:opacity-40 transition-colors">
                  <Bot size={10} /> Perm.
                </button>
                {chatContact.needsAttention && (
                  <button onClick={() => attAction("dismiss")} disabled={attLoading} title="Encerrar atendimento humano"
                    className="flex items-center gap-0.5 text-[9px] font-bold px-2 py-1 rounded-lg bg-orange-500 text-white hover:bg-orange-600 disabled:opacity-40 transition-colors">
                    <UserCheck size={10} /> Encerrar
                  </button>
                )}
                <button onClick={() => { setShowDtfPanel(v => !v) }} title="Pedidos DTF do contato"
                  className={`w-7 h-7 rounded-lg flex items-center justify-center transition-colors ${showDtfPanel ? "bg-violet-100 text-violet-600" : "bg-[#F4F6FB] text-[#0F1E3C]/40 hover:text-[#7C3AED]"}`}>
                  <PanelRight size={14} />
                </button>
                <button onClick={deleteConversation} disabled={deletingConv} title="Apagar conversa"
                  className="w-7 h-7 rounded-lg bg-[#F4F6FB] hover:bg-red-50 flex items-center justify-center text-[#0F1E3C]/40 hover:text-red-500 transition-colors disabled:opacity-40">
                  <Trash2 size={14} />
                </button>
                <button onClick={() => { setChatContact(null); setReplyTo(null); setShowDtfPanel(false) }}
                  className="ml-1 w-7 h-7 rounded-lg bg-[#F4F6FB] hover:bg-[#0F1E3C]/10 flex items-center justify-center text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
                  <X size={14} />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div
              className={`flex-1 overflow-y-auto px-4 py-3 space-y-1.5 bg-[#F4F6FB] relative transition-all ${isDragging ? "ring-2 ring-inset ring-[#4361EE]/40 bg-[#4361EE]/5" : ""}`}
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}
            >
              {isDragging && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                  <div className="bg-white border-2 border-dashed border-[#4361EE]/40 rounded-2xl px-8 py-6 text-center">
                    <Paperclip size={24} className="text-[#4361EE]/50 mx-auto mb-1" />
                    <p className="text-xs font-bold text-[#4361EE]/60">Solte o arquivo aqui</p>
                  </div>
                </div>
              )}
              {/* Load older button */}
              {hasMoreMsgs && (
                <div className="flex justify-center pb-1">
                  <button onClick={() => loadOlderMsgs(chatContact!.id, msgOffset)} disabled={loadingOlderMsgs}
                    className="flex items-center gap-1.5 text-[10px] font-semibold text-[#4361EE] bg-white hover:bg-[#4361EE]/6 px-3 py-1.5 rounded-full border border-[#4361EE]/20 transition-colors disabled:opacity-50">
                    {loadingOlderMsgs
                      ? <div className="w-3 h-3 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
                      : <><ChevronUp size={11} /> Carregar mais antigas</>
                    }
                  </button>
                </div>
              )}
              {messages.length === 0 ? (
                <p className="text-center text-[10px] text-[#0F1E3C]/20 py-12">Nenhuma mensagem ainda.</p>
              ) : messages.map((m, i) => {
                const isOut = m.direction === "out"
                const showDate = i === 0 || dateBRKey(messages[i-1].createdAt) !== dateBRKey(m.createdAt)
                const showTime = i === 0 || new Date(messages[i-1].createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ_BR }) !== new Date(m.createdAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ_BR })
                return (
                  <div key={m.id}>
                    {showDate && (
                      <p className="text-center text-[9px] text-[#0F1E3C]/30 my-2 font-medium">
                        {new Date(m.createdAt).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
                      </p>
                    )}
                    <div className={`flex ${isOut ? "justify-end" : "justify-start"}`}
                      onMouseEnter={() => setHoveredMsg(m.id)}
                      onMouseLeave={() => setHoveredMsg(null)}>
                      <div className="relative group max-w-[72%]">
                        <div className={`rounded-2xl text-[11.5px] leading-relaxed shadow-sm overflow-hidden ${
                          isOut ? "bg-[#4361EE] text-white rounded-br-none" : "bg-white text-[#0F1E3C] rounded-bl-none"
                        }`}>
                          {/* Category badge */}
                          {m.mediaCategory && CATEGORY_BADGE[m.mediaCategory] && (
                            <div className={`text-[8px] font-black uppercase tracking-widest px-3 pt-1.5 ${CATEGORY_BADGE[m.mediaCategory].cls} rounded-t-2xl`}>
                              {CATEGORY_BADGE[m.mediaCategory].label}
                            </div>
                          )}

                          {/* Quote bubble */}
                          {m.quotedContent && (
                            <div className={`mx-2 mt-2 px-2 py-1.5 rounded-lg border-l-2 text-[10px] ${
                              isOut
                                ? "bg-white/10 border-white/40 text-white/70"
                                : "bg-[#0F1E3C]/5 border-[#4361EE]/40 text-[#0F1E3C]/50"
                            }`}>
                              <p className="truncate">{m.quotedContent}</p>
                            </div>
                          )}

                          {/* Time + status helper */}
                          {(() => {
                            const tick = isOut ? (
                              m.status === "read" || m.status === "played"
                                ? <span className="text-[10px] text-blue-200 font-bold">✓✓</span>
                                : m.status === "delivered"
                                  ? <span className="text-[10px] text-white/40 font-bold">✓✓</span>
                                  : <span className="text-[10px] text-white/40 font-bold">✓</span>
                            ) : null

                            const timeEl = (extra?: string) => (
                              <span className={`flex items-center justify-end gap-1 text-[9px] ${extra ?? ""} ${isOut ? "text-white/50" : "text-[#0F1E3C]/30"}`}>
                                {fmtTime(m.createdAt)}{tick}
                              </span>
                            )

                            /* Image / video */
                            if ((m.mediaType === "image" || m.mediaType === "video" || m.mediaType === "sticker") && m.mediaUrl) return (
                              <div>
                                <div className="relative">
                                  {m.mediaType === "video" && isBlobUrl(m.mediaUrl) ? (
                                    // eslint-disable-next-line jsx-a11y/media-has-caption
                                    <video controls src={m.mediaUrl} className="w-full max-w-[240px] object-cover rounded" />
                                  ) : (
                                    <>
                                      {/* eslint-disable-next-line @next/next/no-img-element */}
                                      <img
                                        src={m.mediaUrl}
                                        alt={m.mediaType === "video" ? "Vídeo" : "Foto"}
                                        className={`w-full max-w-[240px] object-cover ${m.mediaUrl ? "cursor-zoom-in" : ""}`}
                                        onClick={() => m.mediaUrl && setLightboxSrc(m.mediaUrl)}
                                      />
                                      {m.mediaType === "video" && !isBlobUrl(m.mediaUrl) && (
                                        <div className="absolute inset-0 flex items-center justify-center">
                                          <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white text-sm">▶</div>
                                        </div>
                                      )}
                                    </>
                                  )}
                                  {!m.mediaUrl && (
                                    <div className="absolute bottom-1 right-1 bg-black/40 text-white text-[8px] px-1.5 py-0.5 rounded-full">carregando...</div>
                                  )}
                                </div>
                                {m.caption && <p className="px-3 pt-1 pb-0 whitespace-pre-wrap break-words">{m.caption}</p>}
                                {showTime && timeEl("px-3 pb-1.5")}
                              </div>
                            )

                            /* Document / DTF / PIX */
                            if (m.mediaType === "document" || m.mediaCategory === "dtf" || m.mediaCategory === "pix") return (
                              <div className="px-3 py-2">
                                <div className="flex items-start gap-2">
                                  <span className="text-lg flex-shrink-0">{m.mediaCategory === "pix" ? "🧾" : m.mediaCategory === "dtf" ? "🎨" : "📄"}</span>
                                  <div className="min-w-0 flex-1">
                                    <p className={`text-[11px] font-semibold ${isOut ? "text-white" : "text-[#0F1E3C]"}`}>
                                      {m.fileName || (m.mediaCategory === "pix" ? "Comprovante PIX" : m.mediaCategory === "dtf" ? "Arte DTF" : "Documento")}
                                    </p>
                                    {m.caption && <p className={`text-[10px] mt-0.5 ${isOut ? "text-white/70" : "text-[#0F1E3C]/60"}`}>{m.caption}</p>}
                                    {isBlobUrl(m.mediaUrl)
                                      ? <a href={m.mediaUrl!} target="_blank" rel="noopener noreferrer" className={`text-[9px] underline ${isOut ? "text-white/70" : "text-[#4361EE]"}`}>Baixar arquivo</a>
                                      : <span className={`text-[9px] ${isOut ? "text-white/50" : "text-[#0F1E3C]/30"}`}>Carregando...</span>
                                    }
                                  </div>
                                </div>
                                {!isOut && (m.mediaCategory === "dtf" || m.mediaCategory === "documento") && isBlobUrl(m.mediaUrl) && (
                                  <button onClick={() => linkDtfFile(m)} disabled={linkingDtfMsg === m.id}
                                    className="mt-1.5 w-full flex items-center justify-center gap-1.5 py-1 rounded-lg bg-violet-50 border border-violet-200 text-[9px] font-bold text-violet-700 hover:bg-violet-100 transition-colors disabled:opacity-50">
                                    {linkingDtfMsg === m.id
                                      ? <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
                                      : <><Printer size={10} /> Adicionar ao pedido DTF</>}
                                  </button>
                                )}
                                {showTime && timeEl("mt-1")}
                              </div>
                            )

                            /* Audio */
                            if (m.mediaType === "audio") return (
                              <div className="px-3 py-2">
                                {isBlobUrl(m.mediaUrl)
                                  // eslint-disable-next-line jsx-a11y/media-has-caption
                                  ? <audio controls src={m.mediaUrl!} className="w-full max-w-[220px]" style={{ height: "32px" }} />
                                  : <span className={`text-[11px] ${isOut ? "text-white/70" : "text-[#0F1E3C]/50"}`}>🎤 Áudio</span>
                                }
                                {showTime && timeEl("mt-1")}
                              </div>
                            )

                            /* Text / fallback */
                            return (
                              <div className="px-3 py-2 whitespace-pre-wrap break-words">
                                {m.mediaType && !m.mediaUrl
                                  ? <span className={isOut ? "text-white/70" : "text-[#0F1E3C]/50"}>{MEDIA_EMOJI[m.mediaType] ?? formatMsgPreview(m.content)}</span>
                                  : formatMsgPreview(m.content)
                                }
                                {showTime && timeEl("mt-0.5")}
                              </div>
                            )
                          })()}
                        </div>
                        {/* Actions on hover */}
                        {hoveredMsg === m.id && (
                          <div className={`absolute top-0 ${isOut ? "left-0 -translate-x-full pr-1" : "right-0 translate-x-full pl-1"} flex items-center gap-0.5`}>
                            <button onClick={() => setReplyTo(m)}
                              className="w-6 h-6 rounded-lg bg-white border border-[#0F1E3C]/10 shadow-sm flex items-center justify-center text-[#0F1E3C]/40 hover:text-[#4361EE] transition-colors">
                              <Reply size={11} />
                            </button>
                            <button
                              onClick={() => deleteMessage(m)}
                              disabled={deletingMsg === m.id}
                              title={isOut ? "Apagar para todos" : "Apagar aqui"}
                              className="w-6 h-6 rounded-lg bg-white border border-[#0F1E3C]/10 shadow-sm flex items-center justify-center text-[#0F1E3C]/40 hover:text-red-500 transition-colors disabled:opacity-40">
                              <Trash2 size={11} />
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
              <div ref={messagesEndRef} />
            </div>

            {/* Reply preview */}
            {replyTo && (
              <div className="flex-shrink-0 mx-4 mb-0 bg-[#4361EE]/8 border-l-2 border-[#4361EE] rounded-lg px-3 py-1.5 flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[9px] font-bold text-[#4361EE]">{replyTo.direction === "out" ? "Você disse" : "Respondendo"}</p>
                  <p className="text-[10px] text-[#0F1E3C]/50 truncate">
                    {replyTo.mediaType ? (MEDIA_EMOJI[replyTo.mediaType] ?? replyTo.content?.slice(0, 80)) : replyTo.content?.slice(0, 80) || "—"}
                  </p>
                </div>
                <button onClick={() => setReplyTo(null)} className="flex-shrink-0 text-[#0F1E3C]/30 hover:text-[#0F1E3C]">
                  <X size={12} />
                </button>
              </div>
            )}

            {/* Input */}
            <div className="flex-shrink-0 border-t border-[#0F1E3C]/6 px-4 py-3 bg-white">
              {/* File staging preview */}
              {stagedFile && (
                <div className="flex items-center gap-2 mb-2 px-3 py-1.5 bg-violet-50 border border-violet-200 rounded-xl">
                  <Paperclip size={12} className="text-violet-500 flex-shrink-0" />
                  <span className="text-[10px] font-semibold text-violet-700 truncate flex-1">{stagedFile.name}</span>
                  <button onClick={() => setStagedFile(null)} className="text-violet-400 hover:text-violet-700">
                    <X size={12} />
                  </button>
                </div>
              )}
              <div className="flex items-end gap-2">
                {/* Attach file button */}
                <button onClick={() => fileInputRef.current?.click()} title="Enviar arquivo"
                  className="w-9 h-9 rounded-xl border border-[#0F1E3C]/10 bg-[#F4F6FB] hover:bg-violet-50 hover:border-violet-200 flex items-center justify-center text-[#0F1E3C]/40 hover:text-violet-600 transition-colors flex-shrink-0">
                  <Paperclip size={14} />
                </button>
                <input ref={fileInputRef} type="file" className="hidden"
                  onChange={e => { if (e.target.files?.[0]) { setStagedFile(e.target.files[0]); e.target.value = "" } }} />
                <textarea ref={chatInputRef} value={chatInput} onChange={e => setChatInput(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); stagedFile ? sendFile() : sendMessage() } }}
                  placeholder={stagedFile ? "Legenda (opcional)..." : "Mensagem... (Enter para enviar, Shift+Enter nova linha)"}
                  rows={1}
                  className="flex-1 resize-none px-3 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-xs text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 max-h-24 overflow-y-auto bg-[#F4F6FB]"
                  style={{ minHeight: "40px" }} />
                <button
                  onClick={stagedFile ? sendFile : sendMessage}
                  disabled={stagedFile ? sendingFile : (!chatInput.trim() || sendingChat)}
                  className="w-10 h-10 rounded-xl bg-[#4361EE] hover:bg-[#3451d1] text-white flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0 shadow-sm">
                  {sendingFile ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </div>{/* end chat column */}

          {/* DTF panel */}
          {showDtfPanel && (
            <div className="w-72 flex-shrink-0 border-l border-[#0F1E3C]/8 flex flex-col bg-[#F4F6FB]">
              <div className="px-4 py-3 border-b border-[#0F1E3C]/8 bg-white flex items-center justify-between flex-shrink-0">
                <div className="flex items-center gap-2">
                  <Printer size={13} className="text-[#7C3AED]" />
                  <p className="text-xs font-bold text-[#0F1E3C]">Pedidos DTF</p>
                </div>
                <span className="text-[10px] font-semibold text-[#0F1E3C]/30">{contactDtfOrders.length} pedido{contactDtfOrders.length !== 1 ? "s" : ""}</span>
              </div>
              {dtfLinkToast && (
                <div className="mx-3 mt-2 px-3 py-2 bg-violet-50 border border-violet-200 rounded-xl flex items-center justify-between gap-2 flex-shrink-0">
                  <p className="text-[10px] font-semibold text-violet-700 flex-1">{dtfLinkToast}</p>
                  <button onClick={() => setDtfLinkToast(null)} className="text-violet-400 hover:text-violet-600"><X size={11} /></button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-3 space-y-2">
                {contactDtfOrders.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#0F1E3C]/20">
                    <Printer size={22} strokeWidth={1.2} />
                    <p className="text-[10px] text-center">Nenhum pedido DTF.<br />Vincule um arquivo para criar.</p>
                  </div>
                ) : contactDtfOrders.map(o => (
                  <DtfOrderCard key={o.id} order={o} onClick={() => { selectedDtfIdRef.current = o.id; setSelectedDtf(o) }} />
                ))}
              </div>
              {/* Download button — uses programmatic fetch to force browser download */}
              {contactDtfOrders.some(o => o.attachments.length > 0) && (
                <div className="p-3 border-t border-[#0F1E3C]/8 bg-white space-y-1.5">
                  {contactDtfOrders
                    .filter(o => o.attachments.length > 0 && o.status !== "concluido" && o.status !== "cancelado")
                    .slice(0, 1)
                    .map(o => (
                      <button
                        key={o.id}
                        onClick={() => downloadDtfOrder(o.id, o.attachments.length, o.contactName ?? chatContact?.name ?? "arte")}
                        className="flex items-center justify-center gap-2 w-full py-2 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold rounded-xl transition-colors">
                        <Download size={13} />
                        {o.attachments.length > 1 ? `Baixar ${o.attachments.length} artes (ZIP)` : "Baixar arte (renomeado)"}
                      </button>
                    ))}
                </div>
              )}
            </div>
          )}

          </div>{/* end modal inner */}
        </div>
      )}

      {/* ── LIGHTBOX ── */}
      {lightboxSrc && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex items-center justify-center p-4"
          onClick={() => setLightboxSrc(null)}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lightboxSrc} alt="Imagem ampliada"
            className="max-w-full max-h-full object-contain rounded-xl shadow-2xl"
            onClick={e => e.stopPropagation()} />
          <button onClick={() => setLightboxSrc(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      )}

      {/* ── MODAL: Grupo ── */}
      {chatTab === "grupos" && selectedGroup && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) { setSelectedGroup(null); setGroupMessages([]) } }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden"
            style={{ height: "82vh" }}>

            {/* Header */}
            <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0 border-b border-[#0F1E3C]/6">
              <div className="w-10 h-10 rounded-full bg-emerald-50 flex items-center justify-center flex-shrink-0">
                <Users size={18} className="text-emerald-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-[#0F1E3C] truncate">{selectedGroup.name || selectedGroup.jid}</p>
                <p className="text-[10px] text-[#0F1E3C]/30">Grupo · {groupMessages.length} msgs</p>
              </div>
              <button onClick={() => { setSelectedGroup(null); setGroupMessages([]) }}
                className="w-7 h-7 rounded-lg bg-[#F4F6FB] hover:bg-[#0F1E3C]/10 flex items-center justify-center text-[#0F1E3C]/40 hover:text-[#0F1E3C] transition-colors">
                <X size={14} />
              </button>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-3 bg-[#F4F6FB]">
              {/* Load older */}
              {groupHasMore && (
                <div className="flex justify-center mb-3">
                  <button onClick={loadOlderGroupMsgs} disabled={loadingGrpMsg}
                    className="flex items-center gap-1.5 text-[10px] font-semibold text-[#4361EE] bg-white hover:bg-[#4361EE]/6 px-3 py-1.5 rounded-full border border-[#4361EE]/20 transition-colors disabled:opacity-50">
                    {loadingGrpMsg
                      ? <div className="w-3 h-3 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
                      : <><ChevronUp size={11} /> Carregar mais antigas</>
                    }
                  </button>
                </div>
              )}
              {loadingGrpMsg && groupMessages.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-[#4361EE] border-t-transparent rounded-full animate-spin" />
                </div>
              ) : groupMessages.length === 0 ? (
                <p className="text-center text-[10px] text-[#0F1E3C]/20 py-12">Nenhuma mensagem ainda.</p>
              ) : (
                <div className="space-y-1.5">
                  {groupMessages.map((m, i) => {
                    const prev = groupMessages[i - 1]
                    const showDate = i === 0 || dateBRKey(prev.createdAt) !== dateBRKey(m.createdAt)
                    const showSender = !m.fromMe && (!prev || prev.senderJid !== m.senderJid || showDate)
                    return (
                      <div key={m.id}>
                        {showDate && (
                          <p className="text-center text-[9px] text-[#0F1E3C]/30 my-2 font-medium">
                            {new Date(m.createdAt).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short" })}
                          </p>
                        )}
                        <div className={`flex ${m.fromMe ? "justify-end" : "justify-start"}`}>
                          <div className="max-w-[72%]">
                            {showSender && (
                              <p className="text-[9px] text-emerald-600 font-bold mb-0.5 px-1">
                                {m.senderName?.split(" ")[0] || "?"}
                              </p>
                            )}
                            <div className={`rounded-2xl text-[11.5px] leading-relaxed shadow-sm overflow-hidden ${
                              m.fromMe
                                ? "bg-[#4361EE] text-white rounded-br-none"
                                : "bg-white text-[#0F1E3C] rounded-bl-none"
                            }`}>
                              {(m.mediaType === "image" || m.mediaType === "video") && m.thumbnail ? (
                                <div>
                                  <div className="relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img
                                      src={`data:image/jpeg;base64,${m.thumbnail}`}
                                      alt={m.mediaType === "video" ? "Vídeo" : "Foto"}
                                      className="w-full max-w-[220px] object-cover"
                                    />
                                    {m.mediaType === "video" && (
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-9 h-9 rounded-full bg-black/50 flex items-center justify-center text-white text-sm">▶</div>
                                      </div>
                                    )}
                                  </div>
                                  {m.caption && <p className="px-3 pt-1.5 pb-0 whitespace-pre-wrap break-words">{m.caption}</p>}
                                  <span className={`block text-right text-[9px] px-3 pb-1.5 ${m.fromMe ? "text-white/50" : "text-[#0F1E3C]/30"}`}>{fmtTime(m.createdAt)}</span>
                                </div>
                              ) : (
                                <div className="px-3 py-2 whitespace-pre-wrap break-words">
                                  {m.mediaType && !m.thumbnail ? (
                                    <span className={m.fromMe ? "text-white/70" : "text-[#0F1E3C]/50"}>{MEDIA_EMOJI[m.mediaType] ?? m.content}</span>
                                  ) : m.content}
                                  <span className={`block text-right text-[9px] mt-0.5 ${m.fromMe ? "text-white/50" : "text-[#0F1E3C]/30"}`}>{fmtTime(m.createdAt)}</span>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <div className="flex-shrink-0 border-t border-[#0F1E3C]/6 px-4 py-2 bg-white">
              <p className="text-[10px] text-[#0F1E3C]/25 text-center">Chatbot não responde em grupos · somente leitura</p>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

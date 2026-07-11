"use client"

import { useEffect, useState, useCallback, useRef } from "react"
import {
  RefreshCw, ShoppingBag,
  Search, Send, MessageCircle, ChevronLeft, Printer, History,
  ChevronDown, ChevronUp, Users, AlertCircle, BotOff, Bot, UserCheck,
  Reply, Trash2, X, Phone, Paperclip, Download, PanelRight, Loader2, Check,
  Image as ImageIcon, Video as VideoIcon, Plus,
} from "lucide-react"
import OrderCard from "./OrderCard"
import OrderModal from "./OrderModal"
import AudioPlayer from "./AudioPlayer"
import DtfOrderCard, { type DtfOrder, type DtfAttachment } from "./DtfOrderCard"
import DtfOrderModal from "./DtfOrderModal"
import NewManualOrderForm from "./NewManualOrderForm"
import Toggle from "@/components/Toggle"

// ─── Tooltip ─────────────────────────────────────────────────────────────────

function Tip({ text }: { text: string }) {
  return (
    <div className="relative group/tip flex-shrink-0">
      <span className="text-[9px] text-[#0F1E3C]/25 cursor-default select-none group-hover/tip:text-[#0F1E3C]/50 transition-colors">ⓘ</span>
      <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 w-48 bg-[#0F1E3C] text-white text-[9px] leading-relaxed rounded-xl px-3 py-2 text-center pointer-events-none z-50 opacity-0 group-hover/tip:opacity-100 transition-opacity shadow-lg whitespace-normal">
        {text}
        <span className="absolute bottom-full left-1/2 -translate-x-1/2 border-[5px] border-transparent border-b-[#0F1E3C]" />
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
  variantId: string | null
  unitPrice: number | null
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
  needsAttention: boolean | null
  contactId: number
  contactName: string
  contactPhone: string
  contactJid: string | null
  paymentTermEnabled: boolean
  paymentTermType: string | null
  paymentTermDays: number | null
  paidAt: string | null
  needsPrint: boolean
  isPartial: boolean
  stockAlert: { productName: string; color: string; size: string; requested: number; available: number }[] | null
  alterationSent: boolean
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
  attentionReason: string | null
  state: string | null
  chatbotPausedUntil: string | null
  chatbotSilenced: boolean
  isOperator: boolean
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
  mediaThumb: string | null
  mediaData: string | null
  mediaCategory: string | null
  fileName: string | null
  caption: string | null
  status: "sent" | "delivered" | "read" | "played" | null
  quotedId: string | null
  quotedText: string | null
  createdAt: string
  mediaFailed?: boolean
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
  { key: "triagem",      label: "Triagem",             hdr: "bg-amber-50 border-amber-200",       badge: "bg-amber-100 text-amber-700",      txt: "text-amber-700"      },
  { key: "confirmando",  label: "Aguard. Confirmação", hdr: "bg-purple-50 border-purple-200",     badge: "bg-purple-100 text-purple-700",    txt: "text-purple-700"     },
  { key: "em_separacao", label: "Em Separação",        hdr: "bg-blue-50 border-blue-200",         badge: "bg-blue-100 text-blue-700",        txt: "text-blue-700"       },
  { key: "pronto",       label: "Pronto p/ Retirada",  hdr: "bg-orange-50 border-orange-200",     badge: "bg-orange-100 text-orange-700",    txt: "text-orange-700"     },
  { key: "pago",         label: "Pago",                hdr: "bg-green-50 border-green-200",       badge: "bg-green-100 text-green-700",      txt: "text-green-700"      },
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
  // Strip Brazil country code if present (55 + 11 digits = 13, or 55 + 10 digits = 12)
  const local = (p.startsWith("55") && (p.length === 13 || p.length === 12)) ? p.slice(2) : p
  if (local.length === 11) return `(${local.slice(0,2)}) ${local.slice(2,7)}-${local.slice(7)}`
  if (local.length === 10) return `(${local.slice(0,2)}) ${local.slice(2,6)}-${local.slice(6)}`
  return phone
}

const TZ_BR = "America/Sao_Paulo"

function dateBRKey(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: TZ_BR })
}

function fmtTime(s: string | null) {
  if (!s) return ""
  return new Date(s).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: TZ_BR })
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
  const [numImpressoras, setNumImpressoras] = useState(1)
  const [filmBobinas,    setFilmBobinas]    = useState<Array<{
    id: number; impressoraId: number; tamanhoM: number
    metrosUsados: number; metrosRestantes: number; pctUsado: number
  }>>([])
  const [filmAlertaM,    setFilmAlertaM]    = useState(80)

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
  const [hasMoreConvs,   setHasMoreConvs]   = useState(false)
  const [loadingMoreConvs, setLoadingMoreConvs] = useState(false)
  const convLimitRef     = useRef(20)
  const convListRef      = useRef<HTMLDivElement>(null)
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
  const [showDtfPanel,      setShowDtfPanel]      = useState(false)
  const [showNewOrderForm,  setShowNewOrderForm]  = useState(false)
  const [showHistProdutos,  setShowHistProdutos]  = useState(false)
  const [showHistDtf,       setShowHistDtf]       = useState(false)
  const [contactDtfOrders,  setContactDtfOrders]  = useState<DtfOrder[]>([])
  const contactProductOrders = chatContact ? orders.filter(o => o.contactId === chatContact.id) : []
  const [linkingDtfMsg,     setLinkingDtfMsg]     = useState<number | null>(null)
  const [downloadingMsgId,  setDownloadingMsgId]  = useState<number | null>(null)
  const [downloadingDtfId,  setDownloadingDtfId]  = useState<number | null>(null)
  const [downloadedDtfIds,  setDownloadedDtfIds]  = useState<Set<number>>(new Set())

  // File upload (send media from PIV)
  const fileInputRef  = useRef<HTMLInputElement>(null)
  const [stagedFile,  setStagedFile]  = useState<File | null>(null)
  const [sendingFile, setSendingFile] = useState(false)

  // Delete conversation
  const [deletingConv, setDeletingConv] = useState(false)

  // DTF link toast
  const [dtfLinkToast, setDtfLinkToast] = useState<string | null>(null)

  // Lightbox
  const [lightboxMsg, setLightboxMsg] = useState<Message | null>(null)

  // Lazy media loading — só busca o arquivo completo sob demanda (clique), nunca sozinho
  const [mediaLoaded, setMediaLoaded] = useState<Record<number, string | "expired">>({})
  const [fetchingMedia, setFetchingMedia] = useState<Set<number>>(new Set())

  // Pagination (load older)
  const [msgOffset,        setMsgOffset]        = useState(0)
  const [hasMoreMsgs,      setHasMoreMsgs]      = useState(false)
  const [loadingOlderMsgs, setLoadingOlderMsgs] = useState(false)

  // Drag-and-drop
  const [isDragging, setIsDragging] = useState(false)

  // Global bot settings
  const [chatbotAtivo,      setChatbotAtivo]      = useState(true)
  const [togglingBot,       setTogglingBot]        = useState(false)
  const [resetting,         setResetting]          = useState(false)
  const [mergingDupes,      setMergingDupes]       = useState(false)

  // Per-service toggles
  const [dtfAtivo,          setDtfAtivo]           = useState(true)
  const [togglingDtf,       setTogglingDtf]        = useState(false)

  // Reservas
  type Reservation = { id: number; productName: string; color: string; size: string; qty: number; contactName: string; contactPhone: string; status: string; createdAt: string }
  const [reservations,    setReservations]    = useState<Reservation[]>([])
  const [showReservations,setShowReservations]= useState(false)

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
  // Rastreia o maior id já visto — usado no poll incremental (afterId)
  // Garante que mensagens sincronizadas com timestamp histórico nunca sejam perdidas
  const lastSeenId      = useRef<number>(0)
  // Ref síncrono para acessar chatContact dentro de callbacks sem stale closure
  const chatContactRef  = useRef<Conversation | null>(null)

  // ── Load global settings ───────────────────────────────────────────────────

  useEffect(() => {
    fetch("/api/settings")
      .then(r => r.json())
      .then((s: Record<string, string>) => {
        if (s.chatbot_ativo           !== undefined) setChatbotAtivo(s.chatbot_ativo         !== "false")
        if (s.dtf_ativo               !== undefined) setDtfAtivo(s.dtf_ativo                !== "false")
        if (s.produto_horario_dias)   setProdDias(s.produto_horario_dias.split(",").map(Number))
        if (s.produto_horario_inicio) setProdInicio(s.produto_horario_inicio)
        if (s.produto_horario_fim)    setProdFim(s.produto_horario_fim)
        if (s.produto_fechado_ate)    setProdFechadoAte(s.produto_fechado_ate)
        if (s.dtf_horario_dias)       setDtfDias(s.dtf_horario_dias.split(",").map(Number))
        if (s.dtf_horario_inicio)     setDtfInicio(s.dtf_horario_inicio)
        if (s.dtf_horario_fim)        setDtfFim(s.dtf_horario_fim)
        if (s.dtf_fechado_ate)        setDtfFechadoAte(s.dtf_fechado_ate)
      })
      .catch((err) => { console.error("[settings] falha ao carregar:", err) })
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

  async function mergeDupeContacts() {
    if (!confirm("Juntar conversas duplicadas do mesmo número?\n\nMensagens das duplicatas são movidas para o contato original.")) return
    setMergingDupes(true)
    const r = await fetch("/api/chat/cleanup-dupes", { method: "POST" }).catch(() => null)
    const data = r?.ok ? await r.json() : null
    setMergingDupes(false)
    await loadConvs()
    alert(data ? `Pronto! ${data.cleaned} duplicata(s) removida(s).` : "Erro ao executar limpeza.")
  }

  async function resetWA() {
    if (!confirm("Apagar todas as mensagens e resetar estados dos contatos?\n\nContatos, pedidos e dados de lifecycle são preservados.")) return
    setResetting(true)
    await fetch("/api/chat/reset", { method: "POST" }).catch(() => {})
    setResetting(false)
    alert("Limpo. Reconecte o WhatsApp para sincronizar.")
  }

  function toggleDia(set: React.Dispatch<React.SetStateAction<number[]>>, dias: number[], dia: number) {
    set(dias.includes(dia) ? dias.filter(d => d !== dia) : [...dias, dia].sort())
  }

  async function saveSchedule() {
    setSavingSchedule(true)
    try {
      const r = await fetch("/api/settings", {
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
      })
      if (!r.ok) throw new Error("status " + r.status)
      setShowSchedule(false)
    } catch (err) {
      console.error("[saveSchedule] falhou:", err)
      alert("Erro ao salvar horários. Tente novamente.")
    } finally {
      setSavingSchedule(false)
    }
  }

  // ── Load orders ────────────────────────────────────────────────────────────

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await fetch("/api/orders?source=whatsapp,manual&activeOnly=true")
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

  const loadReservations = useCallback(async () => {
    const r = await fetch("/api/orders/reservations")
    if (r.ok) setReservations(await r.json())
  }, [])

  useEffect(() => { loadOrders(); loadReservations() }, [loadOrders, loadReservations])
  useEffect(() => {
    const t = setInterval(() => { loadOrders(); loadReservations() }, 10_000)
    return () => clearInterval(t)
  }, [loadOrders, loadReservations])

  // ── Load DTF orders ─────────────────────────────────────────────────────────

  const loadDtf = useCallback(async () => {
    const r = await fetch(`/api/dtf/pedidos?activeOnly=1`)
    if (r.ok) {
      const active: DtfOrder[] = await r.json()
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

  const loadFilmBobinas = useCallback(async () => {
    const r = await fetch("/api/dtf/film-bobinas")
    if (r.ok) setFilmBobinas(await r.json())
  }, [])

  useEffect(() => { loadDtf() }, [loadDtf])
  useEffect(() => { loadFilmBobinas() }, [loadFilmBobinas])
  useEffect(() => {
    const t = setInterval(() => { loadDtf(); loadFilmBobinas() }, 10_000)
    return () => clearInterval(t)
  }, [loadDtf, loadFilmBobinas])
  useEffect(() => {
    fetch("/api/settings").then(r => r.ok ? r.json() : null).then((d: Record<string, string> | null) => {
      if (d?.dtf_num_impressoras) setNumImpressoras(Number(d.dtf_num_impressoras) || 1)
      if (d?.dtf_film_alerta_m)   setFilmAlertaM(Number(d.dtf_film_alerta_m) || 80)
    })
  }, [])
  useEffect(() => { if (histOpen) loadHistorico() }, [histOpen, loadHistorico])

  // ── Load conversations ─────────────────────────────────────────────────────

  const loadConvs = useCallback(async () => {
    const r = await fetch(`/api/chat/conversations?limit=${convLimitRef.current}`)
    if (r.ok) {
      const data = await r.json()
      setConvs(data.conversations ?? [])
      setHasMoreConvs(data.hasMore ?? false)
    }
  }, [])

  const loadMoreConvs = useCallback(async () => {
    if (loadingMoreConvs || !hasMoreConvs) return
    setLoadingMoreConvs(true)
    const offset = convLimitRef.current
    const r = await fetch(`/api/chat/conversations?limit=20&offset=${offset}`)
    if (r.ok) {
      const data = await r.json()
      setConvs(prev => [...prev, ...(data.conversations ?? [])])
      setHasMoreConvs(data.hasMore ?? false)
      convLimitRef.current += 20
    }
    setLoadingMoreConvs(false)
  }, [loadingMoreConvs, hasMoreConvs])

  useEffect(() => {
    loadConvs()
  }, [loadConvs])

  // Sync chatContactRef with state so pollMessages can access jid without stale closure
  useEffect(() => { chatContactRef.current = chatContact }, [chatContact])

  // Poll conversations from DB every 3s (fast, local)
  useEffect(() => {
    const t = setInterval(loadConvs, 3_000)
    return () => clearInterval(t)
  }, [loadConvs])

  // Reload conversations when user returns to this tab
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") loadConvs() }
    document.addEventListener("visibilitychange", onVisible)
    return () => document.removeEventListener("visibilitychange", onVisible)
  }, [loadConvs])

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
    const jid = selectedGroup.jid
    const t = setInterval(() => {
      fetch(`/api/chat/thread?jid=${encodeURIComponent(jid)}&skip=0&limit=20`)
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedGroup])

  // ── Load messages (full load ao selecionar, incremental poll) ─────────────

  const fetchMessageMedia = useCallback(async (msgId: number, attempt = 0) => {
    const r = await fetch(`/api/chat/media/${msgId}`)
    if (!r.ok) return null
    const d = await r.json() as {
      mediaData: string | null; mediaThumb: string | null
      mediaCategory: string | null; mediaFailed: boolean; expired: boolean
    }
    if (d.mediaFailed || d.expired) {
      setMediaLoaded(prev => ({ ...prev, [msgId]: "expired" }))
      return "expired" as const
    }
    if (d.mediaData) {
      setMediaLoaded(prev => ({ ...prev, [msgId]: d.mediaData! }))
      if (d.mediaCategory || d.mediaThumb) {
        setMessages(prev => prev.map(m => m.id === msgId
          ? { ...m, mediaCategory: d.mediaCategory ?? m.mediaCategory, mediaThumb: d.mediaThumb ?? m.mediaThumb }
          : m
        ))
      }
      return d.mediaData
    }
    // Mídia ainda processando — retry com backoff
    const delays = [8_000, 16_000, 30_000]
    if (attempt < delays.length) {
      setTimeout(() => fetchMessageMedia(msgId, attempt + 1), delays[attempt])
    } else {
      setMediaLoaded(prev => ({ ...prev, [msgId]: "expired" }))
    }
    return null
  }, [])

  // Busca mídia sob demanda (clique em foto/vídeo/áudio/documento) — nunca automático,
  // pra não rebaixar arquivos completos só de a mensagem aparecer na tela
  const loadMediaOnDemand = useCallback((msgId: number) => {
    if (fetchingMedia.has(msgId) || typeof mediaLoaded[msgId] === "string") return
    setFetchingMedia(prev => new Set(prev).add(msgId))
    fetchMessageMedia(msgId)
  }, [fetchMessageMedia, fetchingMedia, mediaLoaded])

  const loadMessages = useCallback(async (contactId: number, noSync = false) => {
    try {
      const r = await fetch(`/api/chat/messages?contactId=${contactId}${noSync ? "&noSync=1" : ""}`)
      if (!r.ok) return
      const data = await r.json()
      const msgs: Message[] = Array.isArray(data) ? data : (data.messages ?? [])
      const more: boolean   = Array.isArray(data) ? false : (data.hasMore ?? false)
      setMessages(msgs)
      setHasMoreMsgs(more)
      setMsgOffset(0)
      latestMsgAt.current = msgs.length > 0 ? msgs[msgs.length - 1].createdAt : null
      const newMax = msgs.length > 0 ? Math.max(...msgs.map(m => m.id)) : 0
      if (newMax > lastSeenId.current) lastSeenId.current = newMax

    } finally {
      // Libera o poll mesmo quando o load retorna vazio (contato sem histórico no DB)
      isFirstLoad.current = false
    }
  }, [fetchMessageMedia])

  const loadOlderMsgs = useCallback(async (contactId: number, currentOffset: number) => {
    setLoadingOlderMsgs(true)
    const newOffset = currentOffset + 50
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

  const loadContactDtfOrders = useCallback(async (contactId: number) => {
    const r = await fetch(`/api/dtf/pedidos?contactId=${contactId}`)
    if (r.ok) setContactDtfOrders(await r.json())
  }, [])

  const pollMessages = useCallback(async (contactId: number) => {
    if (isFirstLoad.current) return
    if (lastSeenId.current === 0) return
    const r = await fetch(`/api/chat/messages?contactId=${contactId}&afterId=${lastSeenId.current}`)
    if (!r.ok) return
    const newMsgs: Message[] = await r.json()
    if (newMsgs.length === 0) return
    setMessages(prev => {
      const existingIds = new Set(prev.map(m => m.id))
      const deduped = newMsgs.filter(m => !existingIds.has(m.id))
      if (deduped.length === 0) return prev
      return [...prev, ...deduped].sort((a, b) =>
        a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id - b.id
      )
    })
    const maxId = Math.max(...newMsgs.map(m => m.id))
    if (maxId > lastSeenId.current) lastSeenId.current = maxId
    latestMsgAt.current = newMsgs[newMsgs.length - 1].createdAt
    // Se chegaram mensagens novas do cliente com o chat aberto, marca como lidas via Evolution
    const hasNewIncoming = newMsgs.some(m => m.direction === "in")
    // Refresh DTF panel se chegou arquivo novo do cliente
    if (newMsgs.some(m => m.direction === "in" && m.mediaType)) {
      loadContactDtfOrders(contactId)
    }
    if (hasNewIncoming && chatContactRef.current) {
      fetch("/api/chat/mark-read", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId, jid: chatContactRef.current.jid }),
      }).then(() => loadConvs()).catch(() => {})
    } else {
      loadConvs()
    }
  }, [loadConvs, loadContactDtfOrders])

  const syncOutgoing = useCallback(async (contactId: number, jid: string) => {
    await fetch(`/api/chat/sync-outgoing?contactId=${contactId}&jid=${encodeURIComponent(jid)}`).catch(() => {})
  }, [])

  // Limpa media APENAS quando o contato muda de fato (por id) — não por recriação de callbacks
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    setMediaLoaded({})
    setFetchingMedia(new Set())
  }, [chatContact?.id])

  useEffect(() => {
    if (!chatContact) return
    latestMsgAt.current = null
    lastSeenId.current  = 0
    isFirstLoad.current = true
    // Carrega mensagens imediatamente; sync em paralelo (não bloqueia exibição)
    loadMessages(chatContact.id)
    syncOutgoing(chatContact.id, chatContact.jid)
    loadContactDtfOrders(chatContact.id)
    // Mark as read in DB + send read receipt to WA (bidirectional)
    fetch("/api/chat/mark-read", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: chatContact.id, jid: chatContact.jid }),
    }).then(() => loadConvs())
  }, [chatContact, syncOutgoing, loadMessages, loadConvs, loadContactDtfOrders])

  useEffect(() => {
    if (!chatContact) return
    const t = setInterval(() => pollMessages(chatContact.id), 2_000)
    return () => clearInterval(t)
  }, [chatContact, pollMessages])

  // Atualiza status dos ticks (sent/delivered/read) nas mensagens existentes a cada 30s
  // sem fazer sync com Evolution — só lê do DB local
  useEffect(() => {
    if (!chatContact) return
    const contactId = chatContact.id
    const t = setInterval(async () => {
      const r = await fetch(`/api/chat/messages?contactId=${contactId}&noSync=1`)
      if (!r.ok) return
      const data = await r.json()
      const fresh: Message[] = Array.isArray(data) ? data : (data.messages ?? [])
      if (!fresh.length) return
      setMessages(prev => {
        const byId = new Map(fresh.map(m => [m.id, m]))
        let changed = false
        const updated = prev.map(m => {
          const f = byId.get(m.id)
          if (f && (f.status !== m.status)) { changed = true; return { ...m, status: f.status } }
          return m
        })
        return changed ? updated : prev
      })
    }, 30_000)
    return () => clearInterval(t)
  }, [chatContact])

  // ── Attention actions ──────────────────────────────────────────────────────

  async function attAction(action: "dismiss" | "toggle_silence") {
    if (!chatContact) return
    setAttLoading(true)
    const contactId = chatContact.id
    const res = await fetch("/api/chat/attention", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, action }),
    })
    if (action === "dismiss") {
      setChatContact(prev => prev?.id === contactId ? { ...prev, needsAttention: false, attentionReason: null } : prev)
    } else if (action === "toggle_silence" && res.ok) {
      const d = await res.json().catch(() => ({}))
      if (typeof d.chatbotSilenced === "boolean") {
        setChatContact(prev => prev?.id === contactId ? { ...prev, chatbotSilenced: d.chatbotSilenced } : prev)
      }
    }
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
      mediaType: null, mediaUrl: null, mediaThumb: null, mediaData: null, mediaCategory: null,
      fileName: null, caption: null,
      status: "sent" as const,
      quotedId: quoted?.messageId ?? null,
      quotedText: quoted?.content ?? null,
      createdAt: new Date().toISOString(),
    }])
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
      .then(() => { loadMessages(chatContact.id, true); loadConvs() })
      .catch(() => { loadMessages(chatContact.id, true) })
      .finally(() => setSendingChat(false))
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
    // Remove card imediatamente do estado (optimistic)
    const deletedId = chatContact.id
    setConvs(prev => prev.filter(c => c.id !== deletedId))
    setMessages([])
    setChatContact(null)
    await fetch("/api/chat/conversations", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: deletedId, jid: chatContact.jid }),
    }).catch(() => {})
    await loadConvs()
    setDeletingConv(false)
  }

  async function linkDtfFile(m: Message) {
    if (!chatContact) return
    setLinkingDtfMsg(m.id)
    setDtfLinkToast(null)
    try {
      const cached = typeof mediaLoaded[m.id] === "string" && mediaLoaded[m.id] !== "expired"
        ? (mediaLoaded[m.id] as string) : null
      const fileUrl = cached ?? await fetchMessageMedia(m.id)
      if (!fileUrl || fileUrl === "expired") {
        setDtfLinkToast("Arquivo ainda não disponível — tente de novo em instantes")
        return
      }
      const r = await fetch("/api/chat/dtf-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactId: chatContact.id,
          waMessageId: m.id,
          fileUrl,
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

  async function downloadDtfOrder(order: DtfOrder) {
    if (downloadingDtfId === order.id) return
    if (order.attachments.length === 0) return
    setDownloadingDtfId(order.id)
    try {
      const r = await fetch(`/api/dtf/pedidos/${order.id}/download`)
      if (!r.ok) throw new Error()
      const blob = await r.blob()
      const cd   = r.headers.get("Content-Disposition") ?? ""
      const nameMatch = cd.match(/filename="(.+)"/)
      const filename  = nameMatch?.[1] ?? (order.attachments.length > 1 ? "artes.zip" : "arte")
      const a = document.createElement("a")
      a.href = URL.createObjectURL(blob); a.download = filename
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(a.href)
      setDownloadedDtfIds(prev => new Set(prev).add(order.id))
    } catch { /* silent */ }
    finally { setDownloadingDtfId(null) }
  }

  async function downloadChatFile(msgId: number, filename: string | null) {
    setDownloadingMsgId(msgId)
    try {
      let url: string | undefined = typeof mediaLoaded[msgId] === "string" && mediaLoaded[msgId] !== "expired"
        ? (mediaLoaded[msgId] as string)
        : undefined
      if (!url) {
        const r = await fetch(`/api/chat/media/${msgId}`)
        if (!r.ok) return
        const d = await r.json()
        url = d.mediaData ?? undefined
      }
      if (!url) return
      let blob: Blob
      if (url.startsWith("data:")) {
        const comma = url.indexOf(",")
        const mime  = url.slice(5, comma).split(";")[0]
        blob = new Blob([Uint8Array.from(atob(url.slice(comma + 1)), c => c.charCodeAt(0))], { type: mime })
      } else {
        const r = await fetch(url)
        if (!r.ok) return
        blob = await r.blob()
      }
      const objUrl = URL.createObjectURL(blob)
      const a      = document.createElement("a")
      a.href = objUrl; a.download = filename ?? "arquivo"
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(objUrl)
    } catch { /* silent */ }
    finally { setDownloadingMsgId(null) }
  }

  async function sendFile() {
    if (!chatContact || !stagedFile || sendingFile) return
    setSendingFile(true)
    const file = stagedFile
    const form = new FormData()
    form.append("jid", chatContact.jid)
    form.append("contactId", String(chatContact.id))
    form.append("caption", chatInput.trim())
    form.append("file", file)
    setChatInput("")
    setStagedFile(null)
    try {
      const r = await fetch("/api/chat/send-media", { method: "POST", body: form })
      if (!r.ok) throw new Error("status " + r.status)
      await loadMessages(chatContact.id)
    } catch (err) {
      console.error("[sendFile] falhou:", err)
      setStagedFile(file)
      alert("Erro ao enviar arquivo. Tente novamente.")
    } finally {
      setSendingFile(false)
    }
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

  function fmtDateSep(iso: string): string {
    const today = dateBRKey(new Date().toISOString())
    const yesterday = dateBRKey(new Date(Date.now() - 86_400_000).toISOString())
    const key = dateBRKey(iso)
    if (key === today) return "Hoje"
    if (key === yesterday) return "Ontem"
    return new Date(iso).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "short", timeZone: TZ_BR })
  }

  return (
    <div className="absolute inset-0 flex overflow-hidden">

      {/* ── LEFT: WA-style contact panel ── */}
      <div className="w-[360px] flex-shrink-0 flex flex-col border-r border-black/30" style={{ background: "#111B21" }}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ background: "#202C33" }}>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(0,168,132,0.15)" }}>
              <MessageCircle size={18} style={{ color: "#00A884" }} />
            </div>
            <div>
              <p className="text-[13px] font-semibold" style={{ color: "#E9EDEF" }}>SM Confecções</p>
              <p className="text-[10px]" style={{ color: "#8696A0" }}>Autoatendimento</p>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            <button onClick={toggleChatbot} disabled={togglingBot} title={chatbotAtivo ? "Bot ativo" : "Bot pausado"}
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: chatbotAtivo ? "#00A884" : "#8696A0" }}>
              {chatbotAtivo ? <Bot size={16} /> : <BotOff size={16} />}
            </button>
            <button onClick={() => { loadOrders(); loadDtf(); loadConvs() }} title="Atualizar"
              className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
              style={{ color: "#8696A0" }}>
              <RefreshCw size={14} className={loadingOrders ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Tabs */}
        <div className="flex border-b flex-shrink-0" style={{ background: "#111B21", borderColor: "rgba(255,255,255,0.08)" }}>
          <button
            onClick={() => { setChatTab("conversas"); setChatContact(null); setMessages([]) }}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-semibold transition-colors relative"
            style={{ color: chatTab === "conversas" ? "#00A884" : "#8696A0" }}>
            <MessageCircle size={13} />
            Conversas
            {totalUnread > 0 && (
              <span className="text-[9px] font-black w-4 h-4 rounded-full flex items-center justify-center" style={{ background: "#00A884", color: "#fff" }}>
                {totalUnread > 9 ? "9+" : totalUnread}
              </span>
            )}
            {chatTab === "conversas" && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: "#00A884" }} />}
          </button>
          <button
            onClick={() => { setChatTab("grupos"); setSelectedGroup(null); setGroupMessages([]) }}
            className="flex-1 flex items-center justify-center gap-1.5 py-3 text-[12px] font-semibold transition-colors relative"
            style={{ color: chatTab === "grupos" ? "#00A884" : "#8696A0" }}>
            <Users size={13} />
            Grupos
            {chatTab === "grupos" && <div className="absolute bottom-0 left-0 right-0 h-0.5" style={{ background: "#00A884" }} />}
          </button>
        </div>

        {/* ── CONVERSAS ── */}
        {chatTab === "conversas" && (
          <>
            <div className="px-3 py-2 flex-shrink-0" style={{ background: "#111B21" }}>
              <div className="relative">
                <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" style={{ color: "#8696A0" }} />
                <input value={chatSearch} onChange={e => setChatSearch(e.target.value)} placeholder="Pesquisar..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg text-[13px] focus:outline-none"
                  style={{ background: "#2A3942", color: "#E9EDEF", border: "none" }} />
              </div>
            </div>
            <div ref={convListRef} className="flex-1 overflow-y-auto"
              onScroll={() => {
                const el = convListRef.current
                if (!el || loadingMoreConvs || !hasMoreConvs || chatSearch) return
                if (el.scrollHeight - el.scrollTop - el.clientHeight < 80) loadMoreConvs()
              }}>
              {filteredConvs.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: "#8696A0" }}>
                  <MessageCircle size={28} strokeWidth={1.2} />
                  <p className="text-[11px]">Nenhuma conversa</p>
                </div>
              ) : [...filteredConvs]
                  .sort((a, b) => (b.needsAttention ? 1 : 0) - (a.needsAttention ? 1 : 0))
                  .map(c => (
                <button key={c.id} onClick={() => {
                  latestMsgAt.current = null
                  setReplyTo(null)
                  setChatContact(c)
                  if (c.needsAttention) {
                    fetch("/api/chat/attention", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ contactId: c.id, action: "dismiss" }),
                    }).then(() => {
                      setConvs(prev => prev.map(x => x.id === c.id ? { ...x, needsAttention: false, attentionReason: null } : x))
                      setChatContact(prev => prev?.id === c.id ? { ...prev, needsAttention: false, attentionReason: null } : prev)
                    }).catch(() => {})
                  }
                }}
                  className="w-full text-left px-3 py-3 transition-colors"
                  style={{
                    background: chatContact?.id === c.id
                      ? "#2A3942"
                      : c.needsAttention
                        ? "rgba(217,119,6,0.10)"
                        : "transparent",
                    borderBottom: "1px solid rgba(255,255,255,0.04)",
                  }}>
                  <div className="flex items-center gap-3">
                    <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden relative">
                      {c.profilePic ? (
                        <img src={c.profilePic} alt={c.name || c.phone}
                          className="w-full h-full object-cover"
                          onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-white text-sm font-bold"
                          style={{ background: avatarColor(c.id) }}>
                          {initials(c.name, c.phone)}
                        </div>
                      )}
                      {(() => {
                        const isBotPaused = c.chatbotPausedUntil && new Date(c.chatbotPausedUntil) > new Date()
                        if (c.needsAttention) {
                          const bg = c.attentionReason === 'remover' ? '#EF4444'
                            : c.attentionReason === 'novo_pedido' ? '#3B82F6'
                            : '#F97316'
                          return (
                            <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center"
                              style={{ background: bg, borderColor: '#111B21' }}>
                              <span className="text-white text-[7px] font-black leading-none">!</span>
                            </div>
                          )
                        }
                        return (
                          <div className="absolute -bottom-0.5 -right-0.5 w-4 h-4 rounded-full border-2 flex items-center justify-center text-[9px] leading-none select-none"
                            style={{ background: '#111B21', borderColor: '#111B21' }}>
                            {isBotPaused ? '👤' : '🤖'}
                          </div>
                        )
                      })()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <p className="text-[14px] font-medium truncate" style={{ color: "#E9EDEF" }}>{c.name || fmtPhone(c.phone)}</p>
                          {c.isOperator && (
                            <span className="text-[8px] font-bold px-1.5 py-0.5 rounded-full bg-[#4361EE]/20 text-[#7C93FF] flex-shrink-0">OPERADOR</span>
                          )}
                        </div>
                        <p className="text-[11px] flex-shrink-0 ml-2" style={{ color: "#8696A0" }}>{fmtTime(c.lastAt)}</p>
                      </div>
                      <div className="flex items-center justify-between mt-0.5">
                        {c.needsAttention ? (
                          <p className="text-[12px] truncate flex-1 font-medium" style={{
                            color: c.attentionReason === 'remover' ? '#EF4444'
                              : c.attentionReason === 'novo_pedido' ? '#60A5FA'
                              : '#F97316'
                          }}>
                            {c.attentionReason === 'prazo' ? '⏰ Perguntou prazo'
                              : c.attentionReason === 'remover' ? '✂️ Remover item'
                              : c.attentionReason === 'novo_pedido' ? '➕ Novo pedido'
                              : c.attentionReason === 'cancelamento' ? '🚫 Cancelamento'
                              : c.attentionReason === 'estoque' ? '📦 Estoque esgotado'
                              : '💬 Quer atendimento'}
                          </p>
                        ) : (
                          <p className="text-[12px] truncate flex-1" style={{ color: c.unread > 0 ? "#E9EDEF" : "#8696A0" }}>
                            {c.lastDirection === "out" && <span style={{ color: "#8696A0" }}>✓ </span>}
                            {formatMsgPreview(c.lastMessage)}
                          </p>
                        )}
                        {c.unread > 0 && (
                          <span className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ml-1" style={{ background: "#00A884", color: "#fff" }}>
                            {c.unread > 9 ? "9+" : c.unread}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </button>
              ))}
              {loadingMoreConvs && (
                <div className="flex justify-center py-3">
                  <div className="w-4 h-4 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#8696A0", borderTopColor: "transparent" }} />
                </div>
              )}
              {!loadingMoreConvs && hasMoreConvs && !chatSearch && (
                <button onClick={loadMoreConvs}
                  className="w-full py-2 text-[11px] font-medium transition-colors"
                  style={{ color: "#8696A0", borderTop: "1px solid rgba(255,255,255,0.04)" }}>
                  Ver mais conversas
                </button>
              )}
            </div>
          </>
        )}

        {/* ── GRUPOS ── */}
        {chatTab === "grupos" && (
          <div className="flex-1 overflow-y-auto">
            {loadingGroups ? (
              <div className="flex items-center justify-center py-16">
                <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#8696A0", borderTopColor: "transparent" }} />
              </div>
            ) : groups.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: "#8696A0" }}>
                <Users size={28} strokeWidth={1.2} />
                <p className="text-[11px]">Nenhum grupo ainda</p>
              </div>
            ) : groups.map(g => (
              <button key={g.jid} onClick={() => setSelectedGroup(g)}
                className="w-full text-left px-3 py-3 transition-colors"
                style={{
                  background: selectedGroup?.jid === g.jid ? "#2A3942" : "transparent",
                  borderBottom: "1px solid rgba(255,255,255,0.04)",
                }}>
                <div className="flex items-center gap-3">
                  <div className="flex-shrink-0 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: "rgba(0,168,132,0.15)" }}>
                    <Users size={18} style={{ color: "#00A884" }} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <p className="text-[14px] font-medium truncate" style={{ color: "#E9EDEF" }}>{g.name || g.jid}</p>
                      <div className="flex items-center gap-1 flex-shrink-0 ml-2">
                        {g.unread > 0 && (
                          <span className="text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center" style={{ background: "#00A884", color: "#fff" }}>
                            {g.unread > 9 ? "9+" : g.unread}
                          </span>
                        )}
                        <p className="text-[11px]" style={{ color: "#8696A0" }}>{fmtTime(g.lastAt)}</p>
                      </div>
                    </div>
                    <p className="text-[12px] truncate mt-0.5" style={{ color: "#8696A0" }}>
                      {g.lastSender && !g.fromMe && <span style={{ color: "#E9EDEF", opacity: 0.7 }}>{g.lastSender.split(" ")[0]}: </span>}
                      {g.fromMe && <span style={{ color: "#8696A0" }}>Você: </span>}
                      {g.lastMessage ?? "—"}
                    </p>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* ── RIGHT ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

      {chatContact ? (
        /* ── INLINE CHAT (WA style) ── */
        <div className="flex-1 flex overflow-hidden">

          {/* Chat pane */}
          <div className="flex-1 flex flex-col min-w-0" style={{ background: "#0B141A" }}>

            {/* Chat header */}
            <div className="flex items-center gap-3 px-4 py-2.5 flex-shrink-0" style={{ background: "#202C33" }}>
              <button onClick={() => { setChatContact(null); setReplyTo(null); setShowDtfPanel(false) }}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
                style={{ color: "#AEBAC1" }}>
                <ChevronLeft size={20} />
              </button>
              <div className="w-10 h-10 rounded-full overflow-hidden flex-shrink-0">
                {chatContact.profilePic ? (
                  <img src={chatContact.profilePic} alt={chatContact.name || chatContact.phone}
                    className="w-full h-full object-cover"
                    onError={e => { (e.target as HTMLImageElement).style.display = "none" }} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-white text-sm font-bold"
                    style={{ background: avatarColor(chatContact.id) }}>
                    {initials(chatContact.name, chatContact.phone)}
                  </div>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-[15px] font-medium" style={{ color: "#E9EDEF" }}>{chatContact.name || fmtPhone(chatContact.phone)}</p>
                <div className="flex items-center gap-2">
                  <p className="text-[11px]" style={{ color: "#8696A0" }}>{fmtPhone(chatContact.phone)}</p>
                  {chatContact.lifecycleState && (
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded-full ${LIFECYCLE_COLOR[chatContact.lifecycleState] ?? "bg-gray-100 text-gray-500"}`}>
                      {LIFECYCLE_LABEL[chatContact.lifecycleState] ?? chatContact.lifecycleState}
                    </span>
                  )}
                  {(() => {
                    const isTempPaused = chatContact.chatbotPausedUntil && new Date(chatContact.chatbotPausedUntil) > new Date()
                    const isBotPausedHeader = chatContact.chatbotSilenced || isTempPaused
                    return (
                      <span className="text-[9px] px-1 py-0.5 rounded font-medium" style={{
                        background: isBotPausedHeader ? 'rgba(107,114,128,0.2)' : 'rgba(0,168,132,0.15)',
                        color: isBotPausedHeader ? '#9CA3AF' : '#00A884',
                      }}>
                        {chatContact.chatbotSilenced ? '🔇 Silenciado' : isTempPaused ? '👤 Manual' : '🤖 Bot'}
                      </span>
                    )
                  })()}
                  {chatContact.needsAttention && (
                    <span className="text-[9px] font-bold flex items-center gap-0.5" style={{
                      color: chatContact.attentionReason === 'remover' ? '#EF4444'
                        : chatContact.attentionReason === 'novo_pedido' ? '#60A5FA'
                        : '#F97316'
                    }}>
                      <AlertCircle size={9} />
                      {chatContact.attentionReason === 'prazo' ? 'Perguntou prazo'
                        : chatContact.attentionReason === 'remover' ? 'Remover item'
                        : chatContact.attentionReason === 'novo_pedido' ? 'Novo pedido'
                        : chatContact.attentionReason === 'cancelamento' ? 'Cancelamento'
                        : chatContact.attentionReason === 'estoque' ? 'Estoque esgotado'
                        : 'Quer atendimento'}
                    </span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-0.5 flex-shrink-0">
                {chatContact.needsAttention && (
                  <button onClick={() => attAction("dismiss")} disabled={attLoading}
                    className="flex items-center gap-1 text-[10px] font-bold px-2.5 py-1.5 rounded-full transition-colors disabled:opacity-40"
                    style={{ background: "#F97316", color: "#fff" }}>
                    <UserCheck size={12} /> Encerrar
                  </button>
                )}
                <button onClick={() => attAction("toggle_silence")} disabled={attLoading}
                  title={chatContact.chatbotSilenced ? "Reativar bot nessa conversa" : "Silenciar bot nessa conversa"}
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 disabled:opacity-40"
                  style={{ color: chatContact.chatbotSilenced ? "#F97316" : "#AEBAC1" }}>
                  {chatContact.chatbotSilenced ? <BotOff size={16} /> : <Bot size={16} />}
                </button>
                <button onClick={() => setShowDtfPanel(v => !v)} title="Gerenciador de Pedidos"
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors"
                  style={{ background: showDtfPanel ? "#7C3AED" : "transparent", color: showDtfPanel ? "#fff" : "#AEBAC1" }}>
                  <PanelRight size={16} />
                </button>
                <button onClick={deleteConversation} disabled={deletingConv} title="Apagar conversa"
                  className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 disabled:opacity-40"
                  style={{ color: "#AEBAC1" }}>
                  <Trash2 size={16} />
                </button>
              </div>
            </div>

            {/* Messages area — WA warm background */}
            <div className={`flex-1 overflow-y-auto px-4 py-2 relative`}
              style={{ background: "#EFEAE2" }}
              onDragOver={onDragOver} onDragLeave={onDragLeave} onDrop={onDrop}>
              {isDragging && (
                <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none" style={{ background: "rgba(0,168,132,0.06)" }}>
                  <div className="rounded-2xl px-8 py-6 text-center border-2 border-dashed" style={{ background: "#fff", borderColor: "rgba(0,168,132,0.4)" }}>
                    <Paperclip size={24} className="mx-auto mb-1" style={{ color: "#00A884" }} />
                    <p className="text-xs font-bold" style={{ color: "#00A884" }}>Solte o arquivo aqui</p>
                  </div>
                </div>
              )}
              {hasMoreMsgs && (
                <div className="flex justify-center pb-2">
                  <button onClick={() => loadOlderMsgs(chatContact!.id, msgOffset)} disabled={loadingOlderMsgs}
                    className="flex items-center gap-1.5 text-[11px] font-medium px-4 py-1.5 rounded-full transition-colors disabled:opacity-50"
                    style={{ background: "rgba(11,20,26,0.3)", color: "#E9EDEF" }}>
                    {loadingOlderMsgs
                      ? <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#E9EDEF", borderTopColor: "transparent" }} />
                      : <><ChevronUp size={11} /> Mensagens mais antigas</>}
                  </button>
                </div>
              )}
              {messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-16 gap-2" style={{ color: "#8696A0" }}>
                  <MessageCircle size={32} strokeWidth={1} />
                  <p className="text-[12px]">Nenhuma mensagem ainda.</p>
                </div>
              ) : (
                <div className="space-y-0.5">
                  {messages.map((m, i) => {
                    const isOut = m.direction === "out"
                    const showDate = i === 0 || dateBRKey(messages[i - 1].createdAt) !== dateBRKey(m.createdAt)
                    const nextSame = i < messages.length - 1
                      && messages[i + 1].direction === m.direction
                      && dateBRKey(messages[i + 1].createdAt) === dateBRKey(m.createdAt)
                    const prevSame = i > 0
                      && messages[i - 1].direction === m.direction
                      && dateBRKey(messages[i - 1].createdAt) === dateBRKey(m.createdAt)
                    const showTail = !nextSame

                    return (
                      <div key={m.id}>
                        {showDate && (
                          <div className="flex justify-center my-3">
                            <span className="text-[11px] font-medium px-3 py-1 rounded-full" style={{ background: "rgba(11,20,26,0.3)", color: "#E9EDEF" }}>
                              {fmtDateSep(m.createdAt)}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${isOut ? "justify-end" : "justify-start"} ${prevSame ? "mt-0.5" : "mt-1.5"}`}
                          onMouseEnter={() => setHoveredMsg(m.id)}
                          onMouseLeave={() => setHoveredMsg(null)}>
                          <div className="relative max-w-[65%] group">
                            {/* WA bubble tail */}
                            {showTail && (
                              <div className="absolute bottom-0 w-0 h-0" style={isOut ? {
                                right: "-7px",
                                borderLeft: "7px solid #D9FDD3",
                                borderBottom: "7px solid transparent",
                              } : {
                                left: "-7px",
                                borderRight: "7px solid #FFFFFF",
                                borderBottom: "7px solid transparent",
                              }} />
                            )}
                            <div className={`text-[13px] leading-relaxed shadow-sm overflow-hidden ${
                              showTail
                                ? isOut ? "rounded-xl rounded-br-sm" : "rounded-xl rounded-bl-sm"
                                : "rounded-xl"
                            }`} style={{ background: isOut ? "#D9FDD3" : "#FFFFFF" }}>

                              {m.mediaCategory && CATEGORY_BADGE[m.mediaCategory] && (
                                <div className={`text-[8px] font-black uppercase tracking-widest px-3 pt-1.5 ${CATEGORY_BADGE[m.mediaCategory].cls}`}>
                                  {CATEGORY_BADGE[m.mediaCategory].label}
                                </div>
                              )}

                              {m.quotedText && (
                                <div className="mx-2 mt-2 px-3 py-1.5 rounded-lg border-l-[3px] text-[11px]"
                                  style={{ background: "rgba(0,0,0,0.05)", borderColor: "#00A884", color: "#667781" }}>
                                  <p className="truncate">{m.quotedText}</p>
                                </div>
                              )}

                              {(() => {
                                const msgMediaData = typeof mediaLoaded[m.id] === "string" && mediaLoaded[m.id] !== "expired"
                                  ? mediaLoaded[m.id] as string : null
                                const msgMediaExpired = mediaLoaded[m.id] === "expired" || m.mediaFailed === true
                                const timeEl = (extra?: string) => (
                                  <span className={`flex items-center justify-end gap-1 text-[10px] select-none ${extra ?? ""}`} style={{ color: "#667781" }}>
                                    {fmtTime(m.createdAt)}
                                    {isOut && (
                                      m.status === "read" || m.status === "played"
                                        ? <span className="font-bold" style={{ color: "#53BDEB" }}>✓✓</span>
                                        : m.status === "delivered"
                                          ? <span className="font-bold" style={{ color: "#667781" }}>✓✓</span>
                                          : <span className="font-bold" style={{ color: "#667781" }}>✓</span>
                                    )}
                                  </span>
                                )

                                if (m.mediaType === "image" || m.mediaType === "video" || m.mediaType === "sticker") {
                                  const displaySrc = msgMediaData || m.mediaThumb
                                  const isReady    = !!msgMediaData
                                  const isFetching = fetchingMedia.has(m.id)
                                  const handleClick = () => {
                                    if (isReady) { if (m.mediaType !== "video") setLightboxMsg(m); return }
                                    loadMediaOnDemand(m.id)
                                    if (m.mediaType !== "video") setLightboxMsg(m)
                                  }
                                  return (
                                  <div>
                                    <div className="relative">
                                      {!displaySrc ? (
                                        // Sem thumb nem mídia carregada ainda (ex: toda foto/vídeo enviada
                                        // pelo operador nunca teve thumb gerado) — placeholder clicável
                                        msgMediaExpired ? (
                                          <div className="w-full max-w-[240px] h-32 rounded flex items-center justify-center" style={{ background: "#0000000d" }}>
                                            <span className="text-[11px]" style={{ color: "#667781" }}>Mídia expirada</span>
                                          </div>
                                        ) : (
                                          <div className="w-full max-w-[240px] h-32 rounded flex flex-col items-center justify-center gap-1.5 cursor-pointer"
                                            style={{ background: "#0000000d" }} onClick={handleClick}>
                                            {isFetching ? (
                                              <div className="w-6 h-6 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#8696A0", borderTopColor: "transparent" }} />
                                            ) : (
                                              <>
                                                {m.mediaType === "video" ? <VideoIcon size={22} style={{ color: "#667781" }} /> : <ImageIcon size={22} style={{ color: "#667781" }} />}
                                                <span className="text-[11px]" style={{ color: "#667781" }}>Toque para ver</span>
                                              </>
                                            )}
                                          </div>
                                        )
                                      ) : m.mediaType === "video" && isReady ? (
                                        // eslint-disable-next-line jsx-a11y/media-has-caption
                                        <video controls src={msgMediaData!} className="w-full max-w-[240px] object-cover rounded" />
                                      ) : (
                                        <>
                                          {/* eslint-disable-next-line @next/next/no-img-element */}
                                          <img src={displaySrc} alt={m.mediaType === "video" ? "Vídeo" : "Foto"}
                                            className="w-full max-w-[240px] object-cover cursor-zoom-in"
                                            onClick={handleClick} />
                                          {m.mediaType === "video" && !isReady && (
                                            <div className="absolute inset-0 flex items-center justify-center cursor-pointer" onClick={handleClick}>
                                              <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm" style={{ background: "rgba(0,0,0,0.5)" }}>▶</div>
                                            </div>
                                          )}
                                        </>
                                      )}
                                      {displaySrc && !isReady && isFetching && !msgMediaExpired && (
                                        <div className="absolute bottom-1 right-1 text-white text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.4)" }}>carregando...</div>
                                      )}
                                      {displaySrc && !isReady && msgMediaExpired && (
                                        <div className="absolute bottom-1 right-1 text-white text-[8px] px-1.5 py-0.5 rounded-full" style={{ background: "rgba(0,0,0,0.55)" }}>Mídia expirada</div>
                                      )}
                                    </div>
                                    {m.caption && <p className="px-3 pt-1 pb-0 whitespace-pre-wrap break-words" style={{ color: "#111B21" }}>{m.caption}</p>}
                                    {!isOut && m.mediaCategory === "dtf" && !msgMediaExpired && (
                                      <div className="px-3 pt-1.5">
                                        <button onClick={() => linkDtfFile(m)} disabled={linkingDtfMsg === m.id}
                                          className="w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[10px] font-bold transition-colors disabled:opacity-50"
                                          style={{ background: "rgba(124,58,237,0.08)", borderColor: "rgba(124,58,237,0.3)", color: "#7C3AED" }}>
                                          {linkingDtfMsg === m.id
                                            ? <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
                                            : <><Printer size={10} /> Adicionar ao pedido DTF</>}
                                        </button>
                                      </div>
                                    )}
                                    {timeEl("px-3 pb-1.5")}
                                  </div>
                                )}

                                if (m.mediaType === "document" || m.mediaCategory === "dtf" || m.mediaCategory === "pix") return (
                                  <div className="px-3 py-2">
                                    <div className="flex items-start gap-2">
                                      <span className="text-lg flex-shrink-0">{m.mediaCategory === "pix" ? "🧾" : m.mediaCategory === "dtf" ? "🎨" : "📄"}</span>
                                      <div className="min-w-0 flex-1">
                                        <p className="text-[12px] font-semibold" style={{ color: "#111B21" }}>
                                          {m.fileName || (m.mediaCategory === "pix" ? "Comprovante PIX" : m.mediaCategory === "dtf" ? "Arte DTF" : "Documento")}
                                        </p>
                                        {m.caption && <p className="text-[11px] mt-0.5" style={{ color: "#667781" }}>{m.caption}</p>}
                                        {msgMediaExpired
                                          ? <span className="text-[10px]" style={{ color: "#8696A0" }}>Mídia expirada</span>
                                          : <button onClick={() => downloadChatFile(m.id, m.fileName)}
                                              disabled={downloadingMsgId === m.id}
                                              className="text-[10px] underline disabled:opacity-50" style={{ color: "#00A884" }}>
                                              {downloadingMsgId === m.id ? "Baixando..." : "Baixar arquivo"}
                                            </button>
                                        }
                                      </div>
                                    </div>
                                    {!isOut && (m.mediaCategory === "dtf" || m.mediaCategory === "documento") && !msgMediaExpired && (
                                      <button onClick={() => linkDtfFile(m)} disabled={linkingDtfMsg === m.id}
                                        className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 rounded-lg border text-[10px] font-bold transition-colors disabled:opacity-50"
                                        style={{ background: "rgba(124,58,237,0.08)", borderColor: "rgba(124,58,237,0.3)", color: "#7C3AED" }}>
                                        {linkingDtfMsg === m.id
                                          ? <div className="w-3 h-3 border border-violet-400 border-t-transparent rounded-full animate-spin" />
                                          : <><Printer size={10} /> Adicionar ao pedido DTF</>}
                                      </button>
                                    )}
                                    {timeEl("mt-1")}
                                  </div>
                                )

                                if (m.mediaType === "audio") return (
                                  <div>
                                    {msgMediaData
                                      ? <AudioPlayer src={msgMediaData} isOut={isOut} />
                                      : msgMediaExpired
                                        ? <div className="px-3 py-2 text-[12px]" style={{ color: "#8696A0" }}>🎤 Áudio expirado</div>
                                        : fetchingMedia.has(m.id)
                                          ? <div className="px-3 py-2 flex items-center gap-2">
                                              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#E9EDEF" }}>
                                                <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#8696A0", borderTopColor: "transparent" }} />
                                              </div>
                                              <span className="text-[12px]" style={{ color: "#667781" }}>Carregando áudio…</span>
                                            </div>
                                          : <button onClick={() => loadMediaOnDemand(m.id)}
                                              className="px-3 py-2 flex items-center gap-2">
                                              <div className="w-7 h-7 rounded-full flex items-center justify-center" style={{ background: "#00A884" }}>
                                                <span className="text-white text-xs">▶</span>
                                              </div>
                                              <span className="text-[12px]" style={{ color: "#667781" }}>Tocar áudio</span>
                                            </button>
                                    }
                                    {timeEl("px-3 pb-1.5")}
                                  </div>
                                )

                                return (
                                  <div className="px-3 py-1.5 whitespace-pre-wrap break-words" style={{ color: "#111B21" }}>
                                    {m.mediaType && !msgMediaData && !m.mediaThumb
                                      ? <span style={{ color: "#667781" }}>{MEDIA_EMOJI[m.mediaType] ?? formatMsgPreview(m.content)}</span>
                                      : formatMsgPreview(m.content)
                                    }
                                    {timeEl("mt-0.5")}
                                  </div>
                                )
                              })()}
                            </div>

                            {hoveredMsg === m.id && (
                              <div className={`absolute top-0.5 ${isOut ? "left-0 -translate-x-full pr-1" : "right-0 translate-x-full pl-1"} flex items-center gap-0.5`}>
                                <button onClick={() => setReplyTo(m)}
                                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors shadow-sm hover:bg-white/20"
                                  style={{ background: "#202C33", color: "#AEBAC1" }}>
                                  <Reply size={12} />
                                </button>
                                <button onClick={() => deleteMessage(m)} disabled={deletingMsg === m.id}
                                  title={isOut ? "Apagar para todos" : "Apagar aqui"}
                                  className="w-7 h-7 rounded-full flex items-center justify-center transition-colors shadow-sm disabled:opacity-40 hover:bg-white/20"
                                  style={{ background: "#202C33", color: "#AEBAC1" }}>
                                  <Trash2 size={12} />
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
              )}
            </div>

            {/* Reply preview */}
            {replyTo && (
              <div className="flex-shrink-0 mx-3 mb-1.5 rounded-lg overflow-hidden border-l-4 flex items-center justify-between gap-2 px-3 py-2"
                style={{ background: "#2A3942", borderColor: "#00A884" }}>
                <div className="min-w-0">
                  <p className="text-[10px] font-bold" style={{ color: "#00A884" }}>{replyTo.direction === "out" ? "Você disse" : "Respondendo"}</p>
                  <p className="text-[11px] truncate" style={{ color: "#AEBAC1" }}>
                    {replyTo.mediaType ? (MEDIA_EMOJI[replyTo.mediaType] ?? replyTo.content?.slice(0, 80)) : replyTo.content?.slice(0, 80) || "—"}
                  </p>
                </div>
                <button onClick={() => setReplyTo(null)} style={{ color: "#8696A0" }}><X size={14} /></button>
              </div>
            )}

            {/* File staged preview */}
            {stagedFile && (
              <div className="flex-shrink-0 mx-3 mb-1.5 flex items-center gap-2 px-3 py-2 rounded-lg border"
                style={{ background: "#2A3942", borderColor: "rgba(124,58,237,0.4)" }}>
                <Paperclip size={13} style={{ color: "#7C3AED", flexShrink: 0 }} />
                <span className="text-[11px] font-semibold truncate flex-1" style={{ color: "#E9EDEF" }}>{stagedFile.name}</span>
                <button onClick={() => setStagedFile(null)} style={{ color: "#8696A0" }}><X size={13} /></button>
              </div>
            )}

            {/* Input bar — WA dark */}
            <div className="flex-shrink-0 flex items-end gap-2 px-3 py-3" style={{ background: "#202C33" }}>
              <button onClick={() => fileInputRef.current?.click()} title="Enviar arquivo"
                className="w-10 h-10 rounded-full flex items-center justify-center transition-colors hover:bg-white/10 flex-shrink-0"
                style={{ color: "#8696A0" }}>
                <Paperclip size={20} />
              </button>
              <input ref={fileInputRef} type="file" className="hidden"
                onChange={e => { if (e.target.files?.[0]) { setStagedFile(e.target.files[0]); e.target.value = "" } }} />
              <textarea ref={chatInputRef} value={chatInput} onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); stagedFile ? sendFile() : sendMessage() } }}
                placeholder={stagedFile ? "Legenda (opcional)..." : "Mensagem..."}
                rows={1}
                className="flex-1 resize-none px-4 py-2.5 rounded-lg text-[13px] focus:outline-none max-h-32 overflow-y-auto"
                style={{ background: "#2A3942", color: "#E9EDEF", border: "none", minHeight: "44px" }} />
              <button
                onClick={stagedFile ? sendFile : sendMessage}
                disabled={stagedFile ? sendingFile : (!chatInput.trim() || sendingChat)}
                className="w-10 h-10 rounded-full flex items-center justify-center transition-colors disabled:opacity-40 flex-shrink-0"
                style={{ background: "#00A884" }}>
                {sendingFile
                  ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  : <Send size={18} style={{ color: "#fff" }} />}
              </button>
            </div>
          </div>

          {/* Gerenciador de Pedidos — produto + DTF, unificado */}
          {showDtfPanel && (
            <div className="w-72 flex-shrink-0 border-l flex flex-col" style={{ background: "#F4F6FB", borderColor: "rgba(0,0,0,0.1)" }}>
              <div className="px-4 py-3 border-b flex items-center justify-between flex-shrink-0 bg-white" style={{ borderColor: "rgba(15,30,60,0.08)" }}>
                <div className="flex items-center gap-2">
                  <Printer size={13} style={{ color: "#7C3AED" }} />
                  <p className="text-xs font-bold text-[#0F1E3C]">Gerenciador de Pedidos</p>
                </div>
                <span className="text-[10px] font-semibold text-[#0F1E3C]/30">
                  {contactProductOrders.length + contactDtfOrders.length} pedido{(contactProductOrders.length + contactDtfOrders.length) !== 1 ? "s" : ""}
                </span>
              </div>
              <div className="px-3 pt-3 flex-shrink-0 bg-white">
                <button onClick={() => setShowNewOrderForm(true)}
                  className="w-full flex items-center justify-center gap-1.5 py-2 rounded-xl bg-[#4361EE] hover:bg-[#3451D4] text-white text-xs font-bold transition-colors">
                  <Plus size={13} /> Novo Pedido
                </button>
              </div>
              {dtfLinkToast && (
                <div className="mx-3 mt-2 px-3 py-2 rounded-xl flex items-center justify-between gap-2 flex-shrink-0 border"
                  style={{ background: "rgba(124,58,237,0.06)", borderColor: "rgba(124,58,237,0.25)" }}>
                  <p className="text-[10px] font-semibold flex-1" style={{ color: "#7C3AED" }}>{dtfLinkToast}</p>
                  <button onClick={() => setDtfLinkToast(null)} className="text-gray-400"><X size={11} /></button>
                </div>
              )}
              {(() => {
                const activeProductOrders    = contactProductOrders.filter(o => !["concluido", "cancelado"].includes(o.status))
                const concludedProductOrders = contactProductOrders.filter(o => ["concluido", "cancelado"].includes(o.status))
                const activeOrders    = contactDtfOrders.filter(o => !["concluido", "cancelado"].includes(o.status))
                const concludedOrders = contactDtfOrders.filter(o => ["concluido", "cancelado"].includes(o.status))
                const isEmpty = contactProductOrders.length === 0 && contactDtfOrders.length === 0
                return (
                  <>
                    <div className="flex-1 overflow-y-auto p-3 space-y-2">
                      {isEmpty ? (
                        <div className="flex flex-col items-center justify-center py-10 gap-2 text-[#0F1E3C]/20">
                          <Printer size={22} strokeWidth={1.2} />
                          <p className="text-[10px] text-center">Nenhum pedido ainda.</p>
                        </div>
                      ) : (
                        <>
                          {activeProductOrders.length > 0 && (
                            <div className="space-y-2">
                              {(activeOrders.length > 0 || concludedProductOrders.length > 0) && (
                                <p className="text-[9px] font-bold text-[#0F1E3C]/25 uppercase tracking-widest px-1">Produtos</p>
                              )}
                              {activeProductOrders.map(o => (
                                <OrderCard key={o.id} order={o} onClick={() => { selectedIdRef.current = o.id; setSelected(o) }} />
                              ))}
                            </div>
                          )}
                          {concludedProductOrders.length > 0 && (
                            <div className="mt-1">
                              <button onClick={() => setShowHistProdutos(v => !v)}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-[#0F1E3C]/6 hover:border-[#4361EE]/25 transition-colors">
                                <span className="text-[10px] font-bold text-[#0F1E3C]/50">
                                  {concludedProductOrders.length} pedido{concludedProductOrders.length !== 1 ? "s" : ""} no histórico
                                </span>
                                {showHistProdutos ? <ChevronUp size={12} className="text-[#0F1E3C]/30"/> : <ChevronDown size={12} className="text-[#0F1E3C]/30"/>}
                              </button>
                              {showHistProdutos && (
                                <div className="space-y-1 mt-1.5">
                                  {concludedProductOrders.map(o => (
                                    <button key={o.id}
                                      onClick={() => { selectedIdRef.current = o.id; setSelected(o) }}
                                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-[#0F1E3C]/6 hover:bg-[#0F1E3C]/4 transition-colors text-left">
                                      <span className="text-[10px] font-bold text-[#0F1E3C]/50">{o.number}</span>
                                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${o.status === "concluido" ? "bg-[#0F1E3C]/5 text-[#0F1E3C]/30" : "bg-red-50 text-red-400"}`}>
                                        {o.status === "concluido" ? "Concluído" : "Cancelado"}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                          {activeOrders.length > 0 && (
                            <p className="text-[9px] font-bold text-[#0F1E3C]/25 uppercase tracking-widest px-1 pt-1">DTF</p>
                          )}
                          {activeOrders.map(o => (
                            <DtfOrderCard key={o.id} order={o} onClick={() => { selectedDtfIdRef.current = o.id; setSelectedDtf(o) }} />
                          ))}
                          {concludedOrders.length > 0 && (
                            <div className="mt-1">
                              <button onClick={() => setShowHistDtf(v => !v)}
                                className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-[#0F1E3C]/6 hover:border-[#7C3AED]/25 transition-colors">
                                <span className="text-[10px] font-bold text-[#0F1E3C]/50">
                                  {concludedOrders.length} pedido{concludedOrders.length !== 1 ? "s" : ""} DTF no histórico
                                </span>
                                {showHistDtf ? <ChevronUp size={12} className="text-[#0F1E3C]/30"/> : <ChevronDown size={12} className="text-[#0F1E3C]/30"/>}
                              </button>
                              {showHistDtf && (
                                <div className="space-y-1 mt-1.5">
                                  {concludedOrders.map(o => (
                                    <button key={o.id}
                                      onClick={() => { selectedDtfIdRef.current = o.id; setSelectedDtf(o) }}
                                      className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-white border border-[#0F1E3C]/6 hover:bg-[#0F1E3C]/4 transition-colors text-left">
                                      <div>
                                        <span className="text-[10px] font-bold text-[#0F1E3C]/50">{o.number}</span>
                                        {o.metrosFinais && <span className="text-[9px] text-[#0F1E3C]/30 ml-1.5">{Number(o.metrosFinais).toFixed(2)}m</span>}
                                      </div>
                                      <span className={`text-[9px] font-semibold px-1.5 py-0.5 rounded-full ${o.status === "concluido" ? "bg-[#0F1E3C]/5 text-[#0F1E3C]/30" : "bg-red-50 text-red-400"}`}>
                                        {o.status === "concluido" ? "Concluído" : "Cancelado"}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    {activeOrders.some(o => o.attachments.length > 0) && (
                      <div className="p-3 border-t bg-white space-y-1.5" style={{ borderColor: "rgba(15,30,60,0.08)" }}>
                        {activeOrders
                          .filter(o => o.attachments.length > 0)
                          .slice(0, 1)
                          .map(o => {
                            const isDownloading = downloadingDtfId === o.id
                            const wasDownloaded = downloadedDtfIds.has(o.id)
                            return (
                              <button key={o.id}
                                onClick={() => downloadDtfOrder(o)}
                                disabled={isDownloading}
                                className="flex flex-col items-center justify-center gap-1 w-full py-2 text-white text-xs font-bold rounded-xl transition-colors hover:opacity-90 disabled:opacity-60"
                                style={{ background: wasDownloaded ? "#059669" : "#7C3AED" }}>
                                {isDownloading
                                  ? <><Loader2 size={12} className="animate-spin" /> Baixando...</>
                                  : wasDownloaded
                                    ? <><Check size={12} /> Baixado — baixar novamente</>
                                    : <><Download size={13} /> {o.attachments.length > 1 ? `Baixar ${o.attachments.length} artes (ZIP)` : "Baixar arte"}</>}
                              </button>
                            )
                          })}
                      </div>
                    )}
                  </>
                )
              })()}
            </div>
          )}

          {showNewOrderForm && (
            <NewManualOrderForm
              contactId={chatContact.id}
              onClose={() => setShowNewOrderForm(false)}
              onCreated={() => { loadOrders(); loadContactDtfOrders(chatContact.id) }}
            />
          )}
        </div>

      ) : (
        /* ── KANBAN / OPERATIONS VIEW ── */
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
              <Tip text="Liga ou desliga as respostas automáticas do bot para todos os contatos. Desligado, o bot fica mudo — mas pedidos continuam sendo capturados e entrando na triagem normalmente, sem confirmação." />
              <Toggle on={chatbotAtivo} onChange={toggleChatbot} disabled={togglingBot} />
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
                        <div className="flex items-center gap-1">
                          {col.key === "triagem" && reservations.length > 0 && (
                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-700">{reservations.length} res.</span>
                          )}
                          {colOrders.length > 0 && (
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${col.badge}`}>{colOrders.length}</span>
                          )}
                        </div>
                      </div>
                      <div className="space-y-2">
                        {colOrders.length === 0 ? (
                          <div className="h-16 flex items-center justify-center rounded-xl border border-dashed border-[#0F1E3C]/10">
                            <p className="text-[10px] text-[#0F1E3C]/20">vazio</p>
                          </div>
                        ) : colOrders.map(order => (
                          <OrderCard key={order.id} order={order}
                            onClick={() => { selectedIdRef.current = order.id; setSelected(order) }}
                            onTogglePay={async (id) => {
                              await fetch(`/api/orders/${id}/status`, {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ status: "pago" }),
                              })
                              setOrders(prev => prev.map(o => o.id === id ? { ...o, status: "pago", paidAt: new Date().toISOString() } : o))
                            }}

                          />
                        ))}
                        {/* Reservas — seção colapsável na Triagem */}
                        {col.key === "triagem" && reservations.length > 0 && (
                          <div className="mt-2">
                            <button
                              onClick={() => setShowReservations(v => !v)}
                              className="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-orange-50 border border-orange-200 text-[10px] font-bold text-orange-700"
                            >
                              <span>Reservas aguardando ({reservations.length})</span>
                              <ChevronDown size={11} className={showReservations ? "rotate-180" : ""} />
                            </button>
                            {showReservations && (
                              <div className="mt-1 space-y-1">
                                {reservations.map(r => (
                                  <div key={r.id} className="bg-orange-50 border border-orange-100 rounded-xl p-3 text-xs">
                                    <p className="font-bold text-orange-800">{r.productName} {r.color} {r.size} · {r.qty} un</p>
                                    <p className="text-orange-600 mt-0.5">{r.contactName} · {r.contactPhone}</p>
                                    <p className="text-orange-500 text-[9px] mt-1">
                                      {r.status === "notified" ? "⏳ Aguardando resposta" : "🕐 Na fila"}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
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

            {/* ── Film Alert ── */}
            {filmBobinas.filter(b => b.metrosUsados >= filmAlertaM).map(b => {
              const restantes   = Number(b.metrosRestantes)
              const isCritical  = b.pctUsado >= 90
              // pedidos triagem ainda sem impressora ou em_producao nessa impressora
              const pending = dtfOrders.filter(o =>
                (o.status === "triagem" && o.impressoraId == null) ||
                (o.status === "em_producao" && o.impressoraId === b.impressoraId)
              )
              const totalPending = pending.reduce((s, o) => s + Number(o.metros ?? 0), 0)
              const cabe         = totalPending <= restantes
              return (
                <div key={b.impressoraId} className={`flex items-start gap-3 rounded-xl px-4 py-3 mb-3 border ${
                  isCritical ? "bg-red-50 border-red-200" : "bg-amber-50 border-amber-200"
                }`}>
                  <AlertCircle size={14} className={`flex-shrink-0 mt-0.5 ${isCritical ? "text-red-500" : "text-amber-500"}`} />
                  <div className="flex-1 min-w-0">
                    <p className={`text-xs font-bold ${isCritical ? "text-red-700" : "text-amber-700"}`}>
                      Impressora {b.impressoraId} — {restantes.toFixed(1)} m restantes de film
                    </p>
                    {pending.length > 0 ? (
                      <p className={`text-[11px] mt-0.5 ${isCritical ? "text-red-600" : "text-amber-600"}`}>
                        Fila pendente: {pending.map(o => `#${o.number} (${Number(o.metros ?? 0).toFixed(1)}m)`).join(" + ")} = {totalPending.toFixed(1)} m
                        {" "}
                        <span className={`font-bold ${cabe ? "text-emerald-600" : "text-red-600"}`}>
                          {cabe ? "✓ cabe" : "✗ não cabe — trocar bobina antes"}
                        </span>
                      </p>
                    ) : (
                      <p className="text-[11px] text-amber-500 mt-0.5">Nenhum pedido pendente na fila.</p>
                    )}
                  </div>
                </div>
              )
            })}

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
      )}
      </div>

      {/* Order/DTF Modals */}
      {selected && (
        <OrderModal order={selected} onClose={() => { setSelected(null); selectedIdRef.current = null }} onRefresh={() => loadOrders()} />
      )}
      {selectedDtf && (
        <DtfOrderModal order={selectedDtf} onClose={() => { setSelectedDtf(null); selectedDtfIdRef.current = null }} onRefresh={() => loadDtf()} numImpressoras={numImpressoras} />
      )}
      {/* ── LIGHTBOX ── */}
      {lightboxMsg && (
        <div className="fixed inset-0 z-[60] bg-black/90 flex flex-col items-center justify-center p-4"
          onClick={() => setLightboxMsg(null)}>
          {mediaLoaded[lightboxMsg.id] === "expired" ? (
            <p className="text-white/70 text-sm">Mídia expirada</p>
          ) : typeof mediaLoaded[lightboxMsg.id] === "string" ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={mediaLoaded[lightboxMsg.id] as string} alt="Imagem ampliada"
                className="max-w-full max-h-[80vh] object-contain rounded-xl shadow-2xl"
                onClick={e => e.stopPropagation()} />

              {/* Rodapé: info + ações */}
              <div className="flex items-center gap-3 mt-4" onClick={e => e.stopPropagation()}>
                <span className="text-white/50 text-xs">
                  {lightboxMsg.direction === "out" ? "Você" : (chatContact?.name || chatContact?.phone)} · {fmtTime(lightboxMsg.createdAt)}
                </span>
                <a href={mediaLoaded[lightboxMsg.id] as string} download
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors">
                  <Download size={13} /> Salvar
                </a>
                {chatContact && (
                  <button
                    onClick={() => { setReplyTo(lightboxMsg); setLightboxMsg(null) }}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/10 hover:bg-white/20 text-white text-xs font-semibold transition-colors">
                    <Reply size={13} /> Responder
                  </button>
                )}
              </div>
            </>
          ) : (
            <div className="w-10 h-10 border-2 border-white/30 border-t-white rounded-full animate-spin" />
          )}

          <button onClick={() => setLightboxMsg(null)}
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white transition-colors">
            <X size={18} />
          </button>
        </div>
      )}

      {/* ── MODAL: Grupo (WA style) ── */}
      {chatTab === "grupos" && selectedGroup && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.5)" }}
          onClick={e => { if (e.target === e.currentTarget) { setSelectedGroup(null); setGroupMessages([]) } }}>
          <div className="rounded-2xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden" style={{ height: "82vh", background: "#111B21" }}>

            {/* Header WA style */}
            <div className="flex items-center gap-3 px-4 py-3 flex-shrink-0" style={{ background: "#202C33" }}>
              <div className="w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0" style={{ background: "rgba(0,168,132,0.15)" }}>
                <Users size={18} style={{ color: "#00A884" }} />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate" style={{ color: "#E9EDEF" }}>{selectedGroup.name || selectedGroup.jid}</p>
                <p className="text-[11px]" style={{ color: "#8696A0" }}>Grupo · {groupMessages.length} msgs · somente leitura</p>
              </div>
              <button onClick={() => { setSelectedGroup(null); setGroupMessages([]) }}
                className="w-8 h-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/10"
                style={{ color: "#AEBAC1" }}>
                <X size={16} />
              </button>
            </div>

            {/* Messages — WA warm background */}
            <div className="flex-1 overflow-y-auto px-4 py-2" style={{ background: "#EFEAE2" }}>
              {groupHasMore && (
                <div className="flex justify-center mb-3">
                  <button onClick={loadOlderGroupMsgs} disabled={loadingGrpMsg}
                    className="flex items-center gap-1.5 text-[11px] font-medium px-4 py-1.5 rounded-full disabled:opacity-50"
                    style={{ background: "rgba(11,20,26,0.3)", color: "#E9EDEF" }}>
                    {loadingGrpMsg
                      ? <div className="w-3 h-3 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#E9EDEF" }} />
                      : <><ChevronUp size={11} /> Carregar mais antigas</>}
                  </button>
                </div>
              )}
              {loadingGrpMsg && groupMessages.length === 0 ? (
                <div className="flex items-center justify-center py-12">
                  <div className="w-5 h-5 border-2 border-t-transparent rounded-full animate-spin" style={{ borderColor: "#00A884" }} />
                </div>
              ) : groupMessages.length === 0 ? (
                <p className="text-center text-[11px] py-12" style={{ color: "#8696A0" }}>Nenhuma mensagem ainda.</p>
              ) : (
                <div className="space-y-0.5">
                  {groupMessages.map((m, i) => {
                    const prev = groupMessages[i - 1]
                    const showDate = i === 0 || dateBRKey(prev.createdAt) !== dateBRKey(m.createdAt)
                    const showSender = !m.fromMe && (!prev || prev.senderJid !== m.senderJid || showDate)
                    const nextSame = i < groupMessages.length - 1 && groupMessages[i + 1].fromMe === m.fromMe
                      && dateBRKey(groupMessages[i + 1].createdAt) === dateBRKey(m.createdAt)
                    const showTail = !nextSame
                    return (
                      <div key={m.id}>
                        {showDate && (
                          <div className="flex justify-center my-3">
                            <span className="text-[11px] font-medium px-3 py-1 rounded-full" style={{ background: "rgba(11,20,26,0.3)", color: "#E9EDEF" }}>
                              {fmtDateSep(m.createdAt)}
                            </span>
                          </div>
                        )}
                        <div className={`flex ${m.fromMe ? "justify-end" : "justify-start"} mt-0.5`}>
                          <div className="max-w-[68%]">
                            {showSender && (
                              <p className="text-[10px] font-bold mb-0.5 px-1" style={{ color: "#00A884" }}>
                                {m.senderName?.split(" ")[0] || "?"}
                              </p>
                            )}
                            <div className={`relative text-[13px] leading-relaxed shadow-sm overflow-hidden ${
                              showTail ? (m.fromMe ? "rounded-xl rounded-br-sm" : "rounded-xl rounded-bl-sm") : "rounded-xl"
                            }`} style={{ background: m.fromMe ? "#D9FDD3" : "#FFFFFF", color: "#111B21" }}>
                              {showTail && (
                                <div className="absolute bottom-0 w-0 h-0" style={m.fromMe ? {
                                  right: "-7px", borderLeft: "7px solid #D9FDD3", borderBottom: "7px solid transparent",
                                } : {
                                  left: "-7px", borderRight: "7px solid #FFFFFF", borderBottom: "7px solid transparent",
                                }} />
                              )}
                              {(m.mediaType === "image" || m.mediaType === "video") && m.thumbnail ? (
                                <div>
                                  <div className="relative">
                                    {/* eslint-disable-next-line @next/next/no-img-element */}
                                    <img src={`data:image/jpeg;base64,${m.thumbnail}`}
                                      alt={m.mediaType === "video" ? "Vídeo" : "Foto"}
                                      className="w-full max-w-[220px] object-cover" />
                                    {m.mediaType === "video" && (
                                      <div className="absolute inset-0 flex items-center justify-center">
                                        <div className="w-9 h-9 rounded-full flex items-center justify-center text-white text-sm" style={{ background: "rgba(0,0,0,0.5)" }}>▶</div>
                                      </div>
                                    )}
                                  </div>
                                  {m.caption && <p className="px-3 pt-1.5 pb-0 whitespace-pre-wrap break-words">{m.caption}</p>}
                                  <span className="block text-right text-[10px] px-3 pb-1.5" style={{ color: "#667781" }}>{fmtTime(m.createdAt)}</span>
                                </div>
                              ) : (
                                <div className="px-3 py-1.5 whitespace-pre-wrap break-words">
                                  {m.mediaType && !m.thumbnail
                                    ? <span style={{ color: "#667781" }}>{MEDIA_EMOJI[m.mediaType] ?? m.content}</span>
                                    : m.content}
                                  <span className="block text-right text-[10px] mt-0.5" style={{ color: "#667781" }}>{fmtTime(m.createdAt)}</span>
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

            <div className="flex-shrink-0 px-4 py-2.5" style={{ background: "#202C33" }}>
              <p className="text-[11px] text-center" style={{ color: "#8696A0" }}>Chatbot não responde em grupos · somente leitura</p>
            </div>
          </div>
        </div>
      )}

      <style jsx global>{`
        @property --led-angle {
          syntax: "<angle>";
          initial-value: 0deg;
          inherits: false;
        }
        @keyframes led-spin { to { --led-angle: 360deg; } }
        @keyframes led-pulse { 0%, 100% { opacity: .5; } 50% { opacity: 1; } }

        .led-wrap { position: relative; }

        .led-glow {
          position: absolute; inset: -10px; border-radius: 22px;
          background: conic-gradient(from var(--led-angle),
            transparent 0deg, #22D3EE 45deg, #7C9BFF 100deg, #4361EE 150deg, transparent 200deg, transparent 360deg);
          filter: blur(14px);
          animation: led-spin 2.2s linear infinite, led-pulse 2.2s ease-in-out infinite;
        }

        .led-ring {
          position: relative;
          border-radius: 18px;
          padding: 2.5px;
          background: conic-gradient(from var(--led-angle),
            transparent 0deg, #22D3EE 45deg, #7C9BFF 100deg, #4361EE 150deg, transparent 200deg, transparent 360deg);
          animation: led-spin 2.2s linear infinite;
        }
      `}</style>
    </div>
  )
}

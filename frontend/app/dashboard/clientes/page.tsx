"use client"

import { useEffect, useState, useCallback } from "react"
import {
  Search, X, RefreshCw, ChevronRight,
  Calendar, ShoppingBag, CheckCircle, Save, User, Bot,
  Printer, Download, Tag, Plus, Trash2, UserPlus, Phone, Pencil,
  FileText,
} from "lucide-react"
import Toggle from "@/components/Toggle"

type Contact = {
  id: number
  name: string | null
  phone: string | null
  phoneJid: string | null
  jid: string
  lifecycleState: string
  chatbotState: string | null
  lastOrderAt: string | null
  paymentTermEnabled: boolean
  paymentTermType: string | null
  paymentTermDays: number | null
  precoExclusivo: boolean
  chatbotObs: string | null
  chatbotProdutoEnabled: boolean
  chatbotDtfEnabled: boolean
  nomeWhatsapp: string | null
  nomeCadastro: string | null
  cpfCnpj: string | null
  tipoPessoa: string | null
  inscricaoEstadual: string | null
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  uf: string | null
  codigoMunicipioIbge: string | null
  createdAt: string
  orderCount: string
  totalSpent: string
}

type OrderItem = {
  id: number; productName: string; color: string; size: string
  qty: number; unitPrice: number | null
}

type ProductOrder = {
  id: number; number: string; status: string; totalValue: number | null
  dueDate: string | null; paidAt: string | null; createdAt: string
  tipo: "produto"; items: OrderItem[] | null
}

type DtfOrder = {
  id: number; number: string; status: string; totalValue: number | null
  dueDate: string | null; paidAt: string | null; createdAt: string
  tipo: "dtf"; metros: number | null; metrosFinais: number | null
  larguraCm: number | null; observacao: string | null
  attachments: Array<{ id: number; filename: string | null }>
}

type AnyOrder = ProductOrder | DtfOrder

const LIFECYCLE_CONFIG: Record<string, { label: string; cls: string }> = {
  new:     { label: "Novo",     cls: "bg-gray-100 text-gray-600"   },
  active:  { label: "Ativo",    cls: "bg-green-100 text-green-700" },
  ausente: { label: "Ausente",  cls: "bg-amber-100 text-amber-700" },
  frio:    { label: "Frio",     cls: "bg-blue-100 text-blue-600"   },
}

const CHATBOT_STATE_LABEL: Record<string, string> = {
  idle:                             "Aguardando",
  coletando:                        "Coletando pedido",
  aguardando_nome:                  "Aguardando nome",
  aguardando_cliente_1:             "Aguardando confirmação",
  dtf_coletando:                    "Coletando DTF",
  triagem:                          "Pedido em triagem",
  confirmando:                      "Confirmando qtd.",
  em_separacao:                     "Em separação",
  pronto:                           "Pronto p/ retirada",
  atendimento:                      "Atendimento manual",
  aguardando_separacao_resposta:    "Aguard. separação parcial",
  aguardando_cancelamento_resposta: "Aguard. cancelamento",
  aguardando_reserva_resposta:      "Aguard. reserva",
}

const DTF_STATUS_LABEL: Record<string, string> = {
  triagem:     "Triagem",
  em_producao: "Em Produção",
  pronto:      "Pronto",
  concluido:   "Concluído",
  cancelado:   "Cancelado",
}

const PERIODS = [
  { value: 7,  label: "7d"   },
  { value: 15, label: "15d"  },
  { value: 30, label: "30d"  },
  { value: 0,  label: "Tudo" },
]

function fmtDate(iso: string | null) {
  if (!iso) return "—"
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" })
}
function fmtCurrency(val: number | string | null) {
  if (val === null || val === undefined) return "—"
  return `R$ ${Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`
}
function fmtPhone(phone: string | null | undefined) {
  if (!phone) return "—"
  const p = phone.replace(/\D/g, "")
  if (p.length === 13) return `+${p.slice(0, 2)} (${p.slice(2, 4)}) ${p.slice(4, 9)}-${p.slice(9)}`
  if (p.length === 12) return `+${p.slice(0, 2)} (${p.slice(2, 4)}) ${p.slice(4, 8)}-${p.slice(8)}`
  if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
  return phone
}

function isLidUnresolved(c: { jid: string; phoneJid: string | null }) {
  return c.jid?.endsWith("@lid") && !c.phoneJid
}

export default function ClientesPage() {
  const [contacts, setContacts]         = useState<Contact[]>([])
  const [loading, setLoading]           = useState(true)
  const [search, setSearch]             = useState("")
  const [filterLifecycle, setFilterLifecycle] = useState("all")
  const [selectedId, setSelectedId]     = useState<number | null>(null)

  // Novo cliente manual
  const [showNew,    setShowNew]    = useState(false)
  const [newPhone,   setNewPhone]   = useState("")
  const [newName,    setNewName]    = useState("")
  const [savingNew,  setSavingNew]  = useState(false)
  const [newError,   setNewError]   = useState("")

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/clientes")
      setContacts(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  async function createClient() {
    if (!newPhone.trim()) return
    setSavingNew(true)
    setNewError("")
    try {
      const r = await fetch("/api/clientes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone: newPhone.trim(), name: newName.trim() || null }),
      })
      if (!r.ok) {
        const d = await r.json()
        setNewError(d.error ?? "Erro ao criar cliente")
        return
      }
      setShowNew(false)
      setNewPhone("")
      setNewName("")
      load()
    } finally { setSavingNew(false) }
  }

  const filtered = contacts.filter(c => {
    const matchSearch = !search ||
      c.name?.toLowerCase().includes(search.toLowerCase()) ||
      c.phone?.includes(search)
    const matchLifecycle = filterLifecycle === "all" || c.lifecycleState === filterLifecycle
    return matchSearch && matchLifecycle
  })

  const stats = {
    total:   contacts.length,
    active:  contacts.filter(c => c.lifecycleState === "active").length,
    ausente: contacts.filter(c => c.lifecycleState === "ausente").length,
  }

  const selected = contacts.find(c => c.id === selectedId) ?? null

  return (
    <div className="flex h-full">
      <div className="flex-1 min-w-0 overflow-auto p-6 space-y-5">

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-[#0F1E3C]">Clientes</h1>
            <p className="text-sm text-[#0F1E3C]/40 mt-0.5">Contatos ativos no WhatsApp</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => { setShowNew(true); setNewError("") }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#4361EE] text-white text-xs font-bold hover:bg-[#3451d1] transition-colors">
              <UserPlus size={13} /> Novo cliente
            </button>
            <button onClick={load} className="p-2 rounded-xl hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40 transition-colors">
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: "Total",    value: stats.total,   color: "text-[#0F1E3C]" },
            { label: "Ativos",   value: stats.active,  color: "text-green-600" },
            { label: "Ausentes", value: stats.ausente, color: "text-amber-600" },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-2xl border border-[#0F1E3C]/8 p-4">
              <p className="text-xs text-[#0F1E3C]/40 font-medium uppercase tracking-wider">{label}</p>
              <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Filters */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1 max-w-xs">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome ou telefone..."
              className="w-full pl-9 pr-3 py-2 rounded-xl border border-[#0F1E3C]/10 text-sm text-[#0F1E3C] placeholder-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30 bg-white" />
          </div>
          <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium bg-white">
            {[
              { key: "all",     label: "Todos"    },
              { key: "active",  label: "Ativos"   },
              { key: "ausente", label: "Ausentes" },
              { key: "new",     label: "Novos"    },
              { key: "frio",    label: "Frios"    },
            ].map(({ key, label }) => (
              <button key={key} onClick={() => setFilterLifecycle(key)}
                className={`px-3 py-2 transition-colors ${filterLifecycle === key ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#0F1E3C]/6">
                <th className="text-left px-5 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Cliente</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Lifecycle</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Chatbot</th>
                <th className="text-left px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Último Pedido</th>
                <th className="text-right px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Total Gasto</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Pedidos</th>
                <th className="text-center px-4 py-3 text-[10px] font-semibold uppercase tracking-wider text-[#0F1E3C]/40">Prazo</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-[#0F1E3C]/4">
              {loading ? (
                <tr><td colSpan={8} className="py-16 text-center text-[#0F1E3C]/30 text-sm">Carregando...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="py-16 text-center text-[#0F1E3C]/30 text-sm">Nenhum cliente encontrado</td></tr>
              ) : filtered.map(c => {
                const lc = LIFECYCLE_CONFIG[c.lifecycleState] ?? LIFECYCLE_CONFIG.new
                const isSelected = selectedId === c.id
                return (
                  <tr key={c.id} onClick={() => setSelectedId(isSelected ? null : c.id)}
                    className={`cursor-pointer transition-colors ${isSelected ? "bg-[#4361EE]/6" : "hover:bg-[#0F1E3C]/3"}`}>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-[#0F1E3C]">{c.name || "Sem nome"}</p>
                        {isLidUnresolved(c) && (
                          <span className="text-[9px] font-bold bg-amber-100 text-amber-600 px-1.5 py-0.5 rounded-full whitespace-nowrap">
                            Aguard. sync
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[#0F1E3C]/40 mt-0.5">
                        {isLidUnresolved(c) ? "Nº pendente de identificação" : fmtPhone(c.phone)}
                      </p>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${lc.cls}`}>{lc.label}</span>
                    </td>
                    <td className="px-4 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {c.chatbotProdutoEnabled && (
                          <span className="text-[9px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">Produto</span>
                        )}
                        {c.chatbotDtfEnabled && (
                          <span className="text-[9px] font-bold bg-purple-100 text-purple-700 px-1.5 py-0.5 rounded-full">DTF</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3.5 text-[#0F1E3C]/60 text-sm">{fmtDate(c.lastOrderAt)}</td>
                    <td className="px-4 py-3.5 text-right font-semibold text-[#0F1E3C]">{fmtCurrency(c.totalSpent)}</td>
                    <td className="px-4 py-3.5 text-center text-[#0F1E3C]/60">{c.orderCount}</td>
                    <td className="px-4 py-3.5 text-center">
                      {c.paymentTermEnabled ? (
                        <span className="text-xs text-green-700 font-medium">
                          {c.paymentTermType === "days" ? `${c.paymentTermDays}d` : "Data fixa"}
                        </span>
                      ) : (
                        <span className="text-xs text-[#0F1E3C]/25">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3.5">
                      <ChevronRight size={14} className={`transition-transform ${isSelected ? "rotate-90 text-[#4361EE]" : "text-[#0F1E3C]/20"}`} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal novo cliente */}
      {showNew && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowNew(false) }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <UserPlus size={16} className="text-[#4361EE]" />
                <p className="font-bold text-[#0F1E3C]">Novo cliente</p>
              </div>
              <button onClick={() => setShowNew(false)} className="p-1 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
                <X size={14} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-xs font-semibold text-[#0F1E3C]/50 mb-1 block">Telefone *</label>
                <div className="relative">
                  <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-[#0F1E3C]/30" />
                  <input
                    value={newPhone}
                    onChange={e => setNewPhone(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && createClient()}
                    placeholder="(11) 99999-8888"
                    className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/25"
                    autoFocus
                  />
                </div>
                <p className="text-[10px] text-[#0F1E3C]/30 mt-1">Com ou sem código do país. Ex: 11999998888</p>
              </div>
              <div>
                <label className="text-xs font-semibold text-[#0F1E3C]/50 mb-1 block">Nome (opcional)</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && createClient()}
                  placeholder="Nome do cliente"
                  className="w-full px-3 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C] focus:outline-none focus:ring-2 focus:ring-[#4361EE]/25"
                />
              </div>
              {newError && (
                <p className="text-xs text-red-500 font-medium">{newError}</p>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button onClick={() => setShowNew(false)}
                className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/12 text-sm text-[#0F1E3C]/50 hover:bg-[#F4F6FB] transition-colors">
                Cancelar
              </button>
              <button onClick={createClient} disabled={!newPhone.trim() || savingNew}
                className="flex-1 py-2.5 rounded-xl bg-[#4361EE] text-white text-sm font-bold hover:bg-[#3451d1] transition-colors disabled:opacity-50">
                {savingNew ? "Salvando..." : "Criar cliente"}
              </button>
            </div>
          </div>
        </div>
      )}

      {selected && (
        <ContactDrawer contact={selected} onClose={() => setSelectedId(null)} onSaved={load} />
      )}
    </div>
  )
}

// ─── Drawer ───────────────────────────────────────────────────────────────────

type ContactTag = { id: number; tag: string; value: string; source: string; createdAt: string }
type ContactOffer = { id: number; offerType: string; offeredAt: string }

const TAG_LABEL: Record<string, string> = {
  interessado_produto: "Interesse: Produto",
  interessado_dtf:     "Interesse: DTF",
  comprou_produto:     "Comprou",
  comprou_dtf:         "Comprou DTF",
}

const TAG_COLOR: Record<string, string> = {
  interessado_produto: "bg-blue-100 text-blue-700",
  interessado_dtf:     "bg-purple-100 text-purple-700",
  comprou_produto:     "bg-green-100 text-green-700",
  comprou_dtf:         "bg-violet-100 text-violet-700",
}

const OFFER_LABEL: Record<string, string> = {
  cross_sell_dtf:     "Cross-sell DTF",
  cross_sell_produto: "Cross-sell Produto",
  reativacao_ausente: "Reativação",
}

function fmtRelative(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const d = Math.floor(diff / 86_400_000)
  if (d === 0) return "hoje"
  if (d === 1) return "ontem"
  return `há ${d} dias`
}

function ContactDrawer({ contact, onClose, onSaved }: { contact: Contact; onClose: () => void; onSaved: () => void }) {
  const [period,         setPeriod]         = useState(30)
  const [orders,         setOrders]         = useState<ProductOrder[]>([])
  const [dtfOrders,      setDtfOrders]      = useState<DtfOrder[]>([])
  const [loadingOrders,  setLoadingOrders]  = useState(false)
  const [tags,           setTags]           = useState<ContactTag[]>([])
  const [offers,         setOffers]         = useState<ContactOffer[]>([])
  const [newTag,         setNewTag]         = useState("")
  const [newTagValue,    setNewTagValue]    = useState("")
  const [addingTag,      setAddingTag]      = useState(false)

  // Editable fields
  const [editName,       setEditName]       = useState(contact.name ?? "")
  const [termEnabled,    setTermEnabled]    = useState(contact.paymentTermEnabled)
  const [termType,       setTermType]       = useState<string>(contact.paymentTermType ?? "days")
  const [termDays,       setTermDays]       = useState<string>(String(contact.paymentTermDays ?? 7))
  const [precoExclusivo, setPrecoExclusivo] = useState(contact.precoExclusivo)
  const [chatbotObs,     setChatbotObs]     = useState(contact.chatbotObs ?? "")
  const [chatbotProduto, setChatbotProduto] = useState(contact.chatbotProdutoEnabled)
  const [chatbotDtf,     setChatbotDtf]     = useState(contact.chatbotDtfEnabled)
  const [cpfCnpj,        setCpfCnpj]        = useState(contact.cpfCnpj ?? "")
  const [tipoPessoa,     setTipoPessoa]     = useState(contact.tipoPessoa ?? "fisica")
  const [inscricaoEst,   setInscricaoEst]   = useState(contact.inscricaoEstadual ?? "")
  const [cep,            setCep]            = useState(contact.cep ?? "")
  const [logradouro,     setLogradouro]     = useState(contact.logradouro ?? "")
  const [numero,         setNumero]         = useState(contact.numero ?? "")
  const [complemento,    setComplemento]    = useState(contact.complemento ?? "")
  const [bairro,         setBairro]         = useState(contact.bairro ?? "")
  const [cidade,         setCidade]         = useState(contact.cidade ?? "")
  const [uf,             setUf]             = useState(contact.uf ?? "")
  const [codigoIbge,     setCodigoIbge]     = useState(contact.codigoMunicipioIbge ?? "")
  const [saving,         setSaving]         = useState(false)
  const [saved,          setSaved]          = useState(false)
  const [confirmDelete,  setConfirmDelete]  = useState(false)
  const [deleting,       setDeleting]       = useState(false)

  const loadOrders = useCallback(async () => {
    setLoadingOrders(true)
    try {
      const res = await fetch(`/api/clientes/${contact.id}?days=${period}`)
      const data = await res.json()
      setOrders(data.orders ?? [])
      setDtfOrders(data.dtf ?? [])
    } finally { setLoadingOrders(false) }
  }, [contact.id, period])

  const loadTags = useCallback(async () => {
    try {
      const r = await fetch(`/api/clientes/${contact.id}/tags`)
      if (r.ok) {
        const data = await r.json()
        setTags(data.tags ?? [])
        setOffers(data.offers ?? [])
      }
    } catch { /* tabela pode não existir ainda */ }
  }, [contact.id])

  async function addTag() {
    if (!newTag.trim()) return
    setAddingTag(true)
    await fetch(`/api/clientes/${contact.id}/tags`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tag: newTag.trim(), value: newTagValue.trim(), source: "manual" }),
    })
    setNewTag("")
    setNewTagValue("")
    await loadTags()
    setAddingTag(false)
  }

  async function removeTag(tagId: number) {
    await fetch(`/api/clientes/${contact.id}/tags`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tagId }),
    })
    await loadTags()
  }

  useEffect(() => { loadOrders() }, [loadOrders])
  useEffect(() => { loadTags() }, [loadTags])

  async function deleteContact() {
    setDeleting(true)
    try {
      await fetch(`/api/clientes/${contact.id}`, { method: "DELETE" })
      onSaved()
      onClose()
    } finally { setDeleting(false) }
  }

  async function save() {
    setSaving(true)
    try {
      await fetch(`/api/clientes/${contact.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: editName.trim() || null,
          enabled: termEnabled,
          type: termEnabled ? termType : null,
          days: termEnabled && termType === "days" ? parseInt(termDays) || null : null,
          precoExclusivo,
          chatbotObs: chatbotObs.trim() || null,
          chatbotProdutoEnabled: chatbotProduto,
          chatbotDtfEnabled: chatbotDtf,
          cpfCnpj: cpfCnpj.trim() || null,
          tipoPessoa,
          inscricaoEstadual: inscricaoEst.trim() || null,
          cep: cep.trim() || null,
          logradouro: logradouro.trim() || null,
          numero: numero.trim() || null,
          complemento: complemento.trim() || null,
          bairro: bairro.trim() || null,
          cidade: cidade.trim() || null,
          uf: uf.trim() || null,
          codigoMunicipioIbge: codigoIbge.trim() || null,
        }),
      })
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved()
    } finally { setSaving(false) }
  }

  const lc = LIFECYCLE_CONFIG[contact.lifecycleState] ?? LIFECYCLE_CONFIG.new
  // "Total Gasto" só conta pedido concluído — a lista abaixo continua mostrando
  // todo pedido ativo (inclusive em andamento), pra operação ver o que tá pendente.
  const totalGasto = orders.filter(o => o.status === "concluido").reduce((s, o) => s + (o.totalValue ?? 0), 0)
    + dtfOrders.filter(o => o.status === "concluido").reduce((s, o) => s + (o.totalValue ?? 0), 0)

  const allOrders: AnyOrder[] = [
    ...orders,
    ...dtfOrders,
  ].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())

  const chatbotStateLabel = CHATBOT_STATE_LABEL[contact.chatbotState ?? "idle"] ?? contact.chatbotState ?? "Aguardando"

  return (
    <div className="w-[420px] border-l border-[#0F1E3C]/8 bg-white flex flex-col overflow-hidden flex-shrink-0">

      {/* Header */}
      <div className="flex items-start justify-between px-5 py-4 border-b border-[#0F1E3C]/8">
        <div className="flex-1 min-w-0 mr-2">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-full bg-[#4361EE]/10 flex items-center justify-center flex-shrink-0">
              <User size={14} className="text-[#4361EE]" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <input
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  placeholder="Nome do cliente"
                  className="flex-1 font-bold text-[#0F1E3C] text-sm bg-[#F4F6FB] border border-[#0F1E3C]/12 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/25 focus:border-[#4361EE] transition-colors"
                />
                <Pencil size={12} className="text-[#0F1E3C]/25 flex-shrink-0" />
              </div>
              <p className="text-xs text-[#0F1E3C]/40 mt-1">
                {isLidUnresolved(contact) ? "Nº pendente de identificação" : fmtPhone(contact.phone)}
              </p>
              {contact.nomeCadastro && contact.nomeWhatsapp && contact.nomeCadastro !== contact.nomeWhatsapp && (
                <p className="text-[10px] text-[#0F1E3C]/30 mt-0.5">Importado do WhatsApp: {contact.nomeWhatsapp}</p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 mt-2 ml-10">
            <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${lc.cls}`}>{lc.label}</span>
            <span className="text-xs text-[#0F1E3C]/30">desde {fmtDate(contact.createdAt)}</span>
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {confirmDelete ? (
            <>
              <button onClick={deleteContact} disabled={deleting}
                className="px-3 py-1.5 rounded-lg bg-red-600 text-white text-xs font-bold hover:bg-red-700 disabled:opacity-50 transition-colors">
                {deleting ? "Deletando..." : "Confirmar"}
              </button>
              <button onClick={() => setConfirmDelete(false)}
                className="px-3 py-1.5 rounded-lg bg-[#0F1E3C]/8 text-[#0F1E3C]/60 text-xs font-bold hover:bg-[#0F1E3C]/12 transition-colors">
                Cancelar
              </button>
            </>
          ) : (
            <button onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg hover:bg-red-50 text-[#0F1E3C]/25 hover:text-red-500 transition-colors"
              title="Deletar cliente">
              <Trash2 size={14} />
            </button>
          )}
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40">
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto divide-y divide-[#0F1E3C]/6">

        {/* ── Chatbot ── */}
        <div className="px-5 py-4 space-y-4">
          <div className="flex items-center gap-2">
            <Bot size={13} className="text-[#4361EE]" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">Chatbot</p>
          </div>

          {/* Estado atual */}
          <div className="flex items-center justify-between bg-[#F4F6FB] rounded-xl px-3 py-2.5">
            <p className="text-xs text-[#0F1E3C]/50">Estado atual</p>
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
              contact.chatbotState && contact.chatbotState !== "idle"
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 text-gray-500"
            }`}>
              {chatbotStateLabel}
            </span>
          </div>

          {/* Observações */}
          <div>
            <p className="text-xs text-[#0F1E3C]/50 font-medium mb-1.5">Observações para o chatbot</p>
            <textarea
              value={chatbotObs}
              onChange={e => setChatbotObs(e.target.value)}
              rows={3}
              placeholder={`Ex: Prefere moletom preto, nunca oferecer bermuda, atacadista de SP...`}
              className="w-full px-3 py-2 rounded-xl border border-[#0F1E3C]/10 text-xs text-[#0F1E3C] resize-none focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 placeholder-[#0F1E3C]/25"
            />
            <p className="text-[10px] text-[#0F1E3C]/30 mt-1">O chatbot usa essas informações para personalizar o atendimento.</p>
          </div>

          {/* Canais */}
          <div className="space-y-2.5 pt-2 border-t border-[#0F1E3C]/6">
            <p className="text-xs text-[#0F1E3C]/50 font-medium">Canais ativos</p>
            <div className="flex items-center gap-3">
              <Toggle on={chatbotProduto} onChange={() => setChatbotProduto(v => !v)} />
              <div>
                <p className="text-sm font-semibold text-[#0F1E3C]">Chatbot Produto</p>
                <p className="text-[10px] text-[#0F1E3C]/40">Pedidos de roupa via WhatsApp</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <Toggle on={chatbotDtf} onChange={() => setChatbotDtf(v => !v)} onColor="bg-purple-600" />
              <div>
                <p className="text-sm font-semibold text-[#0F1E3C]">Chatbot DTF</p>
                <p className="text-[10px] text-[#0F1E3C]/40">Pedidos de impressão via WhatsApp</p>
              </div>
            </div>
          </div>
        </div>

        {/* ── Pagamento ── */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">Pagamento</p>

          <div className="flex items-center gap-3">
            <Toggle on={termEnabled} onChange={() => setTermEnabled(v => !v)} />
            <p className="text-sm font-semibold text-[#0F1E3C]">{termEnabled ? "Prazo ativo" : "Sem prazo"}</p>
          </div>

          {termEnabled && (
            <div className="space-y-2.5 pl-1">
              <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium">
                {[{ val: "days", label: "Dias corridos" }, { val: "fixed_date", label: "Data fixa" }].map(({ val, label }) => (
                  <button key={val} onClick={() => setTermType(val)}
                    className={`flex-1 py-2 transition-colors ${termType === val ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {termType === "days" ? (
                <div className="flex items-center gap-2">
                  <input type="number" min={1} max={365} value={termDays} onChange={e => setTermDays(e.target.value)}
                    className="w-20 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm text-center font-semibold focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
                  <span className="text-sm text-[#0F1E3C]/50">dias após o pedido</span>
                </div>
              ) : (
                <p className="text-xs text-[#0F1E3C]/40">Data marcada manualmente no pedido.</p>
              )}
            </div>
          )}

          <div className="flex items-center gap-3 pt-1 border-t border-[#0F1E3C]/6">
            <Toggle on={precoExclusivo} onChange={() => setPrecoExclusivo(v => !v)} onColor="bg-amber-500" />
            <div>
              <p className="text-sm font-semibold text-[#0F1E3C]">Preço Exclusivo</p>
              <p className="text-[10px] text-[#0F1E3C]/40">PDV exige confirmação de preço</p>
            </div>
          </div>
        </div>

        {/* ── Dados Fiscais ── */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText size={13} className="text-[#4361EE]" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">Dados Fiscais</p>
          </div>
          <p className="text-[10px] text-[#0F1E3C]/40 -mt-1.5">Opcional — só é exigido na hora de emitir nota fiscal</p>

          <div className="flex rounded-xl border border-[#0F1E3C]/10 overflow-hidden text-xs font-medium">
            {[{ val: "fisica", label: "Pessoa Física" }, { val: "juridica", label: "Pessoa Jurídica" }].map(({ val, label }) => (
              <button key={val} onClick={() => setTipoPessoa(val)}
                className={`flex-1 py-2 transition-colors ${tipoPessoa === val ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/6"}`}>
                {label}
              </button>
            ))}
          </div>

          <input value={cpfCnpj} onChange={e => setCpfCnpj(e.target.value)}
            placeholder={tipoPessoa === "juridica" ? "CNPJ" : "CPF"}
            className="w-full border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />

          {tipoPessoa === "juridica" && (
            <input value={inscricaoEst} onChange={e => setInscricaoEst(e.target.value)}
              placeholder="Inscrição Estadual"
              className="w-full border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
          )}

          <div className="flex gap-2">
            <input value={cep} onChange={e => setCep(e.target.value)} placeholder="CEP"
              className="w-28 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
            <input value={uf} onChange={e => setUf(e.target.value.toUpperCase().slice(0, 2))} placeholder="UF"
              className="w-16 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
            <input value={cidade} onChange={e => setCidade(e.target.value)} placeholder="Cidade"
              className="flex-1 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
          </div>
          <input value={codigoIbge} onChange={e => setCodigoIbge(e.target.value)} placeholder="Código IBGE do município (ex: 3516200)"
            className="w-full border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />

          <div className="flex gap-2">
            <input value={logradouro} onChange={e => setLogradouro(e.target.value)} placeholder="Logradouro (rua/avenida)"
              className="flex-1 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
            <input value={numero} onChange={e => setNumero(e.target.value)} placeholder="Nº"
              className="w-16 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
          </div>
          <div className="flex gap-2">
            <input value={bairro} onChange={e => setBairro(e.target.value)} placeholder="Bairro"
              className="flex-1 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
            <input value={complemento} onChange={e => setComplemento(e.target.value)} placeholder="Complemento"
              className="flex-1 border border-[#0F1E3C]/10 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-[#4361EE]/30" />
          </div>
        </div>

        {/* Save button */}
        <div className="px-5 py-3">
          <button onClick={save} disabled={saving}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#4361EE] text-white text-xs font-semibold hover:bg-[#3451d1] transition-colors disabled:opacity-60">
            {saved ? <CheckCircle size={12} /> : <Save size={12} />}
            {saved ? "Salvo!" : "Salvar alterações"}
          </button>
        </div>

        {/* ── Perfil de Compra ── */}
        <div className="px-5 py-4 space-y-3">
          <div className="flex items-center gap-2">
            <Tag size={13} className="text-[#4361EE]" />
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">Perfil de Compra</p>
          </div>

          {/* Tags */}
          <div className="flex flex-wrap gap-1.5">
            {tags.length === 0 && (
              <p className="text-[10px] text-[#0F1E3C]/25">Nenhuma tag ainda</p>
            )}
            {tags.map(t => {
              const colorCls = TAG_COLOR[t.tag] ?? "bg-gray-100 text-gray-600"
              const label = TAG_LABEL[t.tag] ?? t.tag
              const display = t.value ? `${label}: ${t.value}` : label
              return (
                <span key={t.id} className={`inline-flex items-center gap-1 text-[9px] font-bold px-2 py-0.5 rounded-full ${colorCls}`}>
                  {display}
                  {t.source === "manual" && (
                    <button onClick={() => removeTag(t.id)} className="hover:opacity-70 transition-opacity">
                      <Trash2 size={8} />
                    </button>
                  )}
                </span>
              )
            })}
          </div>

          {/* Add tag manual */}
          <div className="flex gap-1.5">
            <input
              value={newTag}
              onChange={e => setNewTag(e.target.value)}
              placeholder="tag"
              className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-[#0F1E3C]/10 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30"
            />
            <input
              value={newTagValue}
              onChange={e => setNewTagValue(e.target.value)}
              placeholder="valor (opcional)"
              className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-[#0F1E3C]/10 text-[10px] focus:outline-none focus:ring-1 focus:ring-[#4361EE]/30"
            />
            <button onClick={addTag} disabled={addingTag || !newTag.trim()}
              className="px-2 py-1 rounded-lg bg-[#4361EE] text-white disabled:opacity-40 hover:bg-[#3451d1] transition-colors">
              <Plus size={11} />
            </button>
          </div>

          {/* Últimas ofertas */}
          {offers.length > 0 && (
            <div className="space-y-1">
              <p className="text-[9px] font-bold uppercase tracking-wider text-[#0F1E3C]/30">Últimas ofertas enviadas</p>
              {offers.slice(0, 4).map(o => (
                <div key={o.id} className="flex items-center justify-between">
                  <span className="text-[10px] text-[#0F1E3C]/50">{OFFER_LABEL[o.offerType] ?? o.offerType}</span>
                  <span className="text-[9px] text-[#0F1E3C]/30">{fmtRelative(o.offeredAt)}</span>
                </div>
              ))}
            </div>
          )}

          {/* Mais pedido */}
          {allOrders.length > 0 && (() => {
            const prodOrders = orders.flatMap(o => o.items ?? [])
            if (prodOrders.length === 0) return null
            const freq: Record<string, number> = {}
            prodOrders.forEach(i => { const k = i.productName.toLowerCase(); freq[k] = (freq[k] ?? 0) + i.qty })
            const top = Object.entries(freq).sort((a, b) => b[1] - a[1])[0]
            if (!top) return null
            return (
              <div className="flex items-center gap-2 bg-[#F4F6FB] rounded-xl px-3 py-2">
                <ShoppingBag size={11} className="text-[#4361EE]" />
                <p className="text-[10px] text-[#0F1E3C]/50">Mais pedido: <span className="font-bold text-[#0F1E3C]">{top[0]}</span> ({top[1]} un)</p>
              </div>
            )
          })()}
        </div>

        {/* ── Histórico ── */}
        <div className="px-5 py-4">
          <div className="flex items-center justify-between mb-3">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[#0F1E3C]/40">Histórico</p>
            <div className="flex rounded-lg border border-[#0F1E3C]/10 overflow-hidden text-[10px] font-semibold">
              {PERIODS.map(({ value, label }) => (
                <button key={value} onClick={() => setPeriod(value)}
                  className={`px-2.5 py-1 transition-colors ${period === value ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/40 hover:bg-[#0F1E3C]/6"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          {allOrders.length > 0 && (
            <div className="flex gap-3 mb-3">
              <div className="flex-1 bg-[#F4F6FB] rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wider text-[#0F1E3C]/40 font-semibold">Pedidos</p>
                <p className="text-base font-bold text-[#0F1E3C]">{allOrders.length}</p>
              </div>
              <div className="flex-1 bg-[#F4F6FB] rounded-xl px-3 py-2">
                <p className="text-[9px] uppercase tracking-wider text-[#0F1E3C]/40 font-semibold">Total</p>
                <p className="text-base font-bold text-[#0F1E3C]">{fmtCurrency(totalGasto)}</p>
              </div>
            </div>
          )}

          {loadingOrders ? (
            <p className="text-xs text-[#0F1E3C]/30 text-center py-8">Carregando...</p>
          ) : allOrders.length === 0 ? (
            <div className="flex flex-col items-center py-10 gap-2 text-[#0F1E3C]/25">
              <ShoppingBag size={28} strokeWidth={1.2} />
              <p className="text-xs">Nenhum pedido no período</p>
            </div>
          ) : (
            <div className="space-y-2">
              {allOrders.map(o =>
                o.tipo === "dtf"
                  ? <DtfOrderRow key={`dtf-${o.id}`} order={o as DtfOrder} />
                  : <ProductOrderRow key={`prod-${o.id}`} order={o as ProductOrder} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ProductOrderRow({ order }: { order: ProductOrder }) {
  const [open, setOpen] = useState(false)
  const itemCount = order.items?.reduce((s, i) => s + i.qty, 0) ?? 0
  const statusColors: Record<string, string> = {
    pronto: "bg-green-100 text-green-700", em_separacao: "bg-blue-100 text-blue-700",
    confirmando: "bg-purple-100 text-purple-700", triagem: "bg-amber-100 text-amber-700",
    cancelado: "bg-red-100 text-red-600", concluido: "bg-gray-100 text-gray-500",
  }
  return (
    <div className="bg-[#F4F6FB] rounded-xl overflow-hidden">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-[#0F1E3C]/4 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <ShoppingBag size={10} className="text-[#4361EE] flex-shrink-0" />
            <span className="font-bold text-[#0F1E3C] text-sm">{order.number}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusColors[order.status] ?? "bg-gray-100 text-gray-600"}`}>
              {order.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-[#0F1E3C]/40 flex items-center gap-1">
              <Calendar size={10} /> {fmtDate(order.createdAt)}
            </span>
            <span className="text-[11px] text-[#0F1E3C]/40">{itemCount} un</span>
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-[#0F1E3C] text-sm">{fmtCurrency(order.totalValue)}</p>
          {order.dueDate && !order.paidAt && (
            <p className="text-[10px] text-amber-600 font-medium">Vence {fmtDate(order.dueDate)}</p>
          )}
          {order.paidAt && (
            <p className="text-[10px] text-green-600 font-medium flex items-center gap-0.5 justify-end">
              <CheckCircle size={9} /> Pago
            </p>
          )}
        </div>
        <ChevronRight size={12} className={`text-[#0F1E3C]/30 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`} />
      </button>
      {open && order.items && order.items.length > 0 && (
        <div className="border-t border-[#0F1E3C]/6 px-3 py-2 space-y-1">
          {order.items.map((item, i) => (
            <div key={i} className="flex items-center justify-between text-xs text-[#0F1E3C]/60">
              <span>{item.productName} {item.color} {item.size}</span>
              <span className="font-semibold text-[#0F1E3C]">{item.qty}x{item.unitPrice ? ` · ${fmtCurrency(item.unitPrice * item.qty)}` : ""}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function DtfOrderRow({ order }: { order: DtfOrder }) {
  const [open, setOpen] = useState(false)
  const statusColors: Record<string, string> = {
    triagem: "bg-amber-100 text-amber-700", em_producao: "bg-blue-100 text-blue-700",
    pronto: "bg-green-100 text-green-700", concluido: "bg-gray-100 text-gray-500",
  }
  return (
    <div className="bg-purple-50 rounded-xl overflow-hidden border border-purple-100">
      <button onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-3 px-3 py-2.5 text-left hover:bg-purple-100/40 transition-colors">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <Printer size={10} className="text-[#7C3AED] flex-shrink-0" />
            <span className="font-bold text-[#0F1E3C] text-sm">{order.number}</span>
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${statusColors[order.status] ?? "bg-gray-100 text-gray-600"}`}>
              {DTF_STATUS_LABEL[order.status] ?? order.status}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5">
            <span className="text-[11px] text-[#0F1E3C]/40 flex items-center gap-1">
              <Calendar size={10} /> {fmtDate(order.createdAt)}
            </span>
            {order.metros && <span className="text-[11px] text-[#7C3AED]/70">{Number(order.metros).toFixed(2)} m</span>}
          </div>
        </div>
        <div className="text-right">
          <p className="font-semibold text-[#0F1E3C] text-sm">{fmtCurrency(order.totalValue)}</p>
          {order.dueDate && (
            <p className="text-[10px] text-amber-600 font-medium">Vence {fmtDate(order.dueDate)}</p>
          )}
        </div>
        <ChevronRight size={12} className={`text-[#7C3AED]/40 transition-transform flex-shrink-0 ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-purple-100 px-3 py-2 space-y-1.5">
          {order.metrosFinais && (
            <p className="text-xs text-[#0F1E3C]/60">Metros finais: <span className="font-bold text-[#7C3AED]">{Number(order.metrosFinais).toFixed(2)} m</span></p>
          )}
          {order.observacao && <p className="text-xs text-[#0F1E3C]/50">{order.observacao}</p>}
          {order.attachments?.length > 0 && (
            <div className="space-y-1 pt-1">
              {order.attachments.map(a => (
                <p key={a.id} className="text-xs text-[#0F1E3C]/50">{a.filename ?? `arquivo-${a.id}`}</p>
              ))}
              <a href={`/api/dtf/pedidos/${order.id}/download`} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1.5 text-xs text-[#7C3AED] hover:underline font-semibold">
                <Download size={10} /> Baixar {order.attachments.length > 1 ? "arquivos (.zip)" : "arquivo"}
              </a>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

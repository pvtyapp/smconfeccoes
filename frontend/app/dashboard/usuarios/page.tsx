"use client"

import { useEffect, useState, useCallback } from "react"
import { Plus, X, Loader2, Check, ShieldCheck, UserX, Pencil } from "lucide-react"
import Toggle from "@/components/Toggle"
import {
  navTop, navGestao, navFinanceiro, navDTF, navProducao, navCadastros, navLP, navSistema,
  type NavItem,
} from "@/lib/navPages"

type User = {
  id: number
  name: string
  login: string
  phone: string | null
  funcao: string | null
  isAdmin: boolean
  allowedPages: string[]
  chatbotAdminEnabled: boolean
  active: boolean
  createdAt: string
}

const PERMISSION_GROUPS: { label: string; items: NavItem[] }[] = [
  { label: "Painel",       items: navTop },
  { label: "Gestão",       items: navGestao },
  { label: "Financeiro",   items: navFinanceiro },
  { label: "DTF",          items: navDTF },
  { label: "Produção",     items: navProducao },
  { label: "Cadastros",    items: navCadastros },
  { label: "Landing Page", items: navLP },
  { label: "Sistema",      items: navSistema },
]

function fmtPhone(phone: string | null): string {
  if (!phone) return "—"
  const p = phone.replace(/\D/g, "")
  if (p.length === 11) return `(${p.slice(0, 2)}) ${p.slice(2, 7)}-${p.slice(7)}`
  return phone
}

function maskPhoneInput(raw: string): string {
  const d = raw.replace(/\D/g, "").slice(0, 11)
  if (d.length <= 2) return d
  if (d.length <= 7) return `(${d.slice(0, 2)}) ${d.slice(2)}`
  return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`
}

export default function UsuariosPage() {
  const [users,   setUsers]   = useState<User[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<User | null | "new">(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch("/api/users")
      if (res.ok) setUsers(await res.json())
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-black text-[#0F1E3C]" style={{ fontFamily: "var(--font-playfair)" }}>Usuários</h1>
          <p className="text-sm text-[#0F1E3C]/45 mt-0.5">Operadores do sistema e permissão de acesso por aba</p>
        </div>
        <button
          onClick={() => setEditing("new")}
          className="flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white text-sm font-semibold px-4 py-2.5 rounded-xl transition-colors"
        >
          <Plus size={14} /> Novo Usuário
        </button>
      </div>

      <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#0F1E3C]/5">
              {["Nome", "Função", "Login", "Telefone", "Perfil", "Status", ""].map((h) => (
                <th key={h} className="text-left px-5 py-3 text-xs font-semibold text-[#0F1E3C]/40 uppercase tracking-wider">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[#0F1E3C]/4">
            {loading ? (
              <tr><td colSpan={7} className="py-16 text-center text-[#0F1E3C]/30 text-sm">Carregando...</td></tr>
            ) : users.length === 0 ? (
              <tr><td colSpan={7} className="py-16 text-center text-[#0F1E3C]/30 text-sm">Nenhum usuário cadastrado</td></tr>
            ) : users.map((u) => (
              <tr key={u.id} className="hover:bg-[#F4F6FB] transition-colors">
                <td className="px-5 py-3 font-semibold text-[#0F1E3C]">{u.name}</td>
                <td className="px-5 py-3 text-[#0F1E3C]/60">{u.funcao || "—"}</td>
                <td className="px-5 py-3 text-[#0F1E3C]/60">{u.login}</td>
                <td className="px-5 py-3 text-[#0F1E3C]/60">{fmtPhone(u.phone)}</td>
                <td className="px-5 py-3">
                  {u.isAdmin ? (
                    <span className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded-full font-semibold bg-[#4361EE]/10 text-[#4361EE]">
                      <ShieldCheck size={11} /> Admin
                    </span>
                  ) : (
                    <span className="text-xs px-2.5 py-1 rounded-full font-semibold bg-[#0F1E3C]/6 text-[#0F1E3C]/50">
                      {u.allowedPages.length} {u.allowedPages.length === 1 ? "página" : "páginas"}
                    </span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${u.active ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-600"}`}>
                    {u.active ? "Ativo" : "Inativo"}
                  </span>
                </td>
                <td className="px-5 py-3 text-right">
                  <button
                    onClick={() => setEditing(u)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#0F1E3C]/12 text-[#0F1E3C]/50 hover:text-[#0F1E3C] hover:bg-[#0F1E3C]/4 text-xs font-bold transition-colors"
                  >
                    <Pencil size={11} /> Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <UserModal
          user={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load() }}
        />
      )}
    </div>
  )
}

function UserModal({ user, onClose, onSaved }: {
  user: User | null; onClose: () => void; onSaved: () => void
}) {
  const isNew = user === null
  const [name,         setName]         = useState(user?.name ?? "")
  const [funcao,       setFuncao]       = useState(user?.funcao ?? "")
  const [login,        setLoginField]   = useState(user?.login ?? "")
  const [password,     setPassword]     = useState("")
  const [phone,        setPhone]        = useState(user?.phone ? maskPhoneInput(user.phone) : "")
  const [isAdmin,      setIsAdmin]      = useState(user?.isAdmin ?? false)
  const [allowedPages, setAllowedPages] = useState<string[]>(user?.allowedPages ?? [])
  const [chatbotAdminEnabled, setChatbotAdminEnabled] = useState(user?.chatbotAdminEnabled ?? true)
  const [active,       setActive]       = useState(user?.active ?? true)
  const [saving,        setSaving]      = useState(false)
  const [error,         setError]       = useState("")

  function togglePage(href: string) {
    setAllowedPages(prev => prev.includes(href) ? prev.filter(p => p !== href) : [...prev, href])
  }

  function toggleGroup(items: NavItem[]) {
    const hrefs = items.map(i => i.href)
    const allChecked = hrefs.every(h => allowedPages.includes(h))
    setAllowedPages(prev => allChecked
      ? prev.filter(p => !hrefs.includes(p))
      : [...new Set([...prev, ...hrefs])])
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError("")
    if (!name.trim() || !login.trim()) { setError("Nome e login são obrigatórios."); return }
    if (isNew && !password) { setError("Senha é obrigatória pra criar um usuário."); return }

    setSaving(true)
    try {
      const body: Record<string, unknown> = {
        name: name.trim(),
        funcao: funcao.trim() || null,
        login: login.trim(),
        phone: phone.replace(/\D/g, "") || null,
        isAdmin,
        allowedPages,
        chatbotAdminEnabled,
      }
      if (password) body.password = password
      if (!isNew) body.active = active

      const res = await fetch(isNew ? "/api/users" : `/api/users/${user.id}`, {
        method: isNew ? "POST" : "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setError(d.error ?? "Erro ao salvar.")
        return
      }
      onSaved()
    } catch {
      setError("Erro de conexão.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <div className="fixed inset-0 bg-black/40 z-40" onClick={onClose} />
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">

          <div className="flex items-center justify-between px-6 py-4 border-b border-[#0F1E3C]/8 flex-shrink-0">
            <h2 className="text-base font-bold text-[#0F1E3C]">{isNew ? "Novo Usuário" : `Editar ${user.name}`}</h2>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-[#0F1E3C]/6 text-[#0F1E3C]/40"><X size={16} /></button>
          </div>

          <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Nome *</label>
                <input value={name} onChange={e => setName(e.target.value)} required
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Função</label>
                <input value={funcao} onChange={e => setFuncao(e.target.value)} placeholder="Ex: Vendedora, Estoquista..."
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 placeholder:text-[#0F1E3C]/25" />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Login *</label>
                <input value={login} onChange={e => setLoginField(e.target.value)} required autoCapitalize="none"
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20" />
              </div>
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">Telefone</label>
                <input value={phone} onChange={e => setPhone(maskPhoneInput(e.target.value))} placeholder="(16) 99999-9999"
                  className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 placeholder:text-[#0F1E3C]/25" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-1.5">
                {isNew ? "Senha *" : "Nova senha"}
              </label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder={isNew ? "" : "deixe em branco pra manter"}
                className="w-full border border-[#0F1E3C]/12 rounded-xl px-3 py-2.5 text-sm text-[#0F1E3C] bg-white focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 placeholder:text-[#0F1E3C]/25" />
            </div>

            <div
              className="flex items-center gap-3 py-3 px-4 rounded-xl bg-[#F4F6FB] border border-[#0F1E3C]/6 cursor-pointer select-none"
              onClick={() => setIsAdmin(v => !v)}
            >
              <Toggle on={isAdmin} onChange={() => {}} />
              <div>
                <p className="text-sm font-semibold text-[#0F1E3C]">Administrador</p>
                <p className="text-[10px] text-[#0F1E3C]/40">Vê e acessa todas as abas, sem precisar marcar cada uma</p>
              </div>
            </div>

            <div
              className="flex items-center gap-3 py-3 px-4 rounded-xl bg-[#F4F6FB] border border-[#0F1E3C]/6 cursor-pointer select-none"
              onClick={() => setChatbotAdminEnabled(v => !v)}
            >
              <Toggle on={chatbotAdminEnabled} onChange={() => {}} />
              <div>
                <p className="text-sm font-semibold text-[#0F1E3C]">Chatbot Administrativo</p>
                <p className="text-[10px] text-[#0F1E3C]/40">Permite usar o bot do WhatsApp pra comandos das abas liberadas acima</p>
              </div>
            </div>

            {!isAdmin && (
              <div>
                <label className="block text-xs font-bold text-[#0F1E3C]/40 uppercase tracking-wider mb-2">Abas liberadas</label>
                <div className="space-y-3 max-h-72 overflow-y-auto pr-1">
                  {PERMISSION_GROUPS.map(group => {
                    const hrefs = group.items.map(i => i.href)
                    const allChecked = hrefs.every(h => allowedPages.includes(h))
                    return (
                      <div key={group.label} className="border border-[#0F1E3C]/8 rounded-xl overflow-hidden">
                        <button type="button" onClick={() => toggleGroup(group.items)}
                          className="w-full flex items-center justify-between px-3 py-2 bg-[#F4F6FB] text-left">
                          <span className="text-xs font-bold text-[#0F1E3C]/60 uppercase tracking-wider">{group.label}</span>
                          <span className={`text-[10px] font-semibold ${allChecked ? "text-[#4361EE]" : "text-[#0F1E3C]/30"}`}>
                            {allChecked ? "desmarcar tudo" : "marcar tudo"}
                          </span>
                        </button>
                        <div className="p-2 grid grid-cols-2 gap-1">
                          {group.items.map(item => {
                            const checked = allowedPages.includes(item.href)
                            return (
                              <label key={item.href} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[#F4F6FB] cursor-pointer text-xs text-[#0F1E3C]/70">
                                <span className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 border ${checked ? "bg-[#4361EE] border-[#4361EE]" : "border-[#0F1E3C]/20"}`}>
                                  {checked && <Check size={11} className="text-white" />}
                                </span>
                                <input type="checkbox" checked={checked} onChange={() => togglePage(item.href)} className="hidden" />
                                {item.label}
                              </label>
                            )
                          })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

            {!isNew && (
              <div
                className="flex items-center gap-3 py-3 px-4 rounded-xl bg-[#F4F6FB] border border-[#0F1E3C]/6 cursor-pointer select-none"
                onClick={() => setActive(v => !v)}
              >
                <Toggle on={active} onChange={() => {}} onColor="bg-emerald-500" />
                <div className="flex items-center gap-2">
                  {!active && <UserX size={13} className="text-red-400" />}
                  <div>
                    <p className="text-sm font-semibold text-[#0F1E3C]">{active ? "Ativo" : "Inativo"}</p>
                    <p className="text-[10px] text-[#0F1E3C]/40">{active ? "Consegue fazer login normalmente" : "Login bloqueado, mesmo com a senha certa"}</p>
                  </div>
                </div>
              </div>
            )}

            {error && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{error}</p>}
          </form>

          <div className="px-6 py-4 border-t border-[#0F1E3C]/8 flex gap-3 flex-shrink-0">
            <button onClick={onClose} className="flex-1 py-2.5 rounded-xl border border-[#0F1E3C]/10 text-sm font-semibold text-[#0F1E3C]/50 hover:bg-[#0F1E3C]/4 transition-colors">
              Cancelar
            </button>
            <button onClick={handleSubmit} disabled={saving}
              className="flex-1 flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white rounded-xl py-2.5 text-sm font-bold disabled:opacity-60 transition-colors">
              {saving && <Loader2 size={14} className="animate-spin" />}
              {isNew ? "Criar Usuário" : "Salvar"}
            </button>
          </div>
        </div>
      </div>
    </>
  )
}

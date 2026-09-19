"use client"

import { useEffect, useState, type FormEvent } from "react"
import { Save, KeyRound } from "lucide-react"
import DocumentInput from "./components/DocumentInput"
import PasswordInput from "./components/PasswordInput"

type Profile = {
  name: string; phone: string
  tipoPessoa: "fisica" | "juridica" | null
  cpfCnpj: string | null; razaoSocial: string | null; inscricaoEstadual: string | null
  cep: string | null; logradouro: string | null; numero: string | null; complemento: string | null
  bairro: string | null; cidade: string | null; uf: string | null; codigoMunicipioIbge: string | null
}

const inputCls = "w-full border border-[#0F1E3C]/15 rounded-xl px-4 py-3 text-sm text-[#0F1E3C] placeholder:text-[#0F1E3C]/30 focus:outline-none focus:ring-2 focus:ring-[#4361EE]/20 focus:border-[#4361EE] transition-colors"

function maskCep(v: string) {
  const d = v.replace(/\D/g, "").slice(0, 8)
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-[#0F1E3C]/60 mb-1.5">{label}</label>
      {children}
    </div>
  )
}

export default function DadosTab() {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<"idle" | "saved" | "error">("idle")
  const [error, setError] = useState("")
  const [cepLoading, setCepLoading] = useState(false)

  const [name, setName] = useState("")
  const [phone, setPhone] = useState("")
  const [tipoPessoa, setTipoPessoa] = useState<"fisica" | "juridica">("fisica")
  const [cpfCnpj, setCpfCnpj] = useState("")
  const [razaoSocial, setRazaoSocial] = useState("")
  const [inscricaoEstadual, setInscricaoEstadual] = useState("")
  const [cep, setCep] = useState("")
  const [logradouro, setLogradouro] = useState("")
  const [numero, setNumero] = useState("")
  const [complemento, setComplemento] = useState("")
  const [bairro, setBairro] = useState("")
  const [cidade, setCidade] = useState("")
  const [uf, setUf] = useState("")
  const [codigoMunicipioIbge, setCodigoMunicipioIbge] = useState("")

  useEffect(() => {
    fetch("/api/portal/profile")
      .then((r) => r.json())
      .then((p: Profile) => {
        setName(p.name ?? "")
        setPhone(p.phone ?? "")
        setTipoPessoa(p.tipoPessoa === "juridica" ? "juridica" : "fisica")
        setCpfCnpj(p.cpfCnpj ?? "")
        setRazaoSocial(p.razaoSocial ?? "")
        setInscricaoEstadual(p.inscricaoEstadual ?? "")
        setCep(p.cep ?? "")
        setLogradouro(p.logradouro ?? "")
        setNumero(p.numero ?? "")
        setComplemento(p.complemento ?? "")
        setBairro(p.bairro ?? "")
        setCidade(p.cidade ?? "")
        setUf(p.uf ?? "")
        setCodigoMunicipioIbge(p.codigoMunicipioIbge ?? "")
      })
      .finally(() => setLoading(false))
  }, [])

  async function handleCepBlur() {
    const digits = cep.replace(/\D/g, "")
    if (digits.length !== 8) return
    setCepLoading(true)
    try {
      const res = await fetch(`/api/portal/cep/${digits}`)
      if (!res.ok) return
      const data = await res.json()
      setLogradouro(data.logradouro || "")
      setBairro(data.bairro || "")
      setCidade(data.cidade || "")
      setUf(data.uf || "")
      setCodigoMunicipioIbge(data.codigoMunicipioIbge || "")
    } finally {
      setCepLoading(false)
    }
  }

  async function handleSave(e: FormEvent) {
    e.preventDefault()
    setError("")
    setStatus("idle")
    setSaving(true)
    try {
      const res = await fetch("/api/portal/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name, tipoPessoa, cpfCnpj, razaoSocial, inscricaoEstadual,
          cep, logradouro, numero, complemento, bairro, cidade, uf, codigoMunicipioIbge,
        }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível salvar"); setStatus("error"); return }
      setStatus("saved")
      setTimeout(() => setStatus("idle"), 2500)
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
      setStatus("error")
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <p className="text-sm text-[#0F1E3C]/40">Carregando...</p>

  return (
    <div className="space-y-5 max-w-xl">
      <form onSubmit={handleSave} className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-6 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Nome">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} required />
          </Field>
          <Field label="WhatsApp">
            <input className={inputCls + " opacity-60 cursor-not-allowed"} value={phone} disabled title="Identidade da conta — não editável aqui" />
          </Field>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-[#0F1E3C]/40 uppercase tracking-wide mb-1.5">Tipo de pessoa</p>
          <div className="flex rounded-xl border border-[#0F1E3C]/12 overflow-hidden text-xs font-semibold">
            <button type="button" onClick={() => setTipoPessoa("fisica")}
              title="Física = CPF, pessoa comum"
              className={`flex-1 py-2.5 transition-colors ${tipoPessoa === "fisica" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
              Pessoa Física
            </button>
            <button type="button" onClick={() => setTipoPessoa("juridica")}
              title="Jurídica = CNPJ, empresa"
              className={`flex-1 py-2.5 transition-colors ${tipoPessoa === "juridica" ? "bg-[#0F1E3C] text-white" : "text-[#0F1E3C]/55 hover:bg-[#0F1E3C]/5"}`}>
              Pessoa Jurídica
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <DocumentInput id="dados-doc" value={cpfCnpj} onChange={setCpfCnpj} tipo={tipoPessoa} />
          {tipoPessoa === "juridica" && (
            <Field label="Razão social">
              <input className={inputCls} value={razaoSocial} onChange={(e) => setRazaoSocial(e.target.value)}
                title="Nome oficial da empresa, como está no CNPJ" placeholder="Nome oficial da empresa" />
            </Field>
          )}
        </div>

        {tipoPessoa === "juridica" && (
          <Field label="Inscrição Estadual (opcional)">
            <input className={inputCls} value={inscricaoEstadual} onChange={(e) => setInscricaoEstadual(e.target.value)}
              title="Deixe em branco se sua empresa é isenta" placeholder="Deixe em branco se isenta" />
          </Field>
        )}

        <div className="border-t border-[#0F1E3C]/6 pt-4">
          <p className="text-sm font-bold text-[#0F1E3C] mb-3">Endereço</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <Field label="CEP">
              <input className={inputCls} value={cep} onChange={(e) => setCep(maskCep(e.target.value))} onBlur={handleCepBlur}
                title="Digite só o CEP, o resto preenche sozinho" placeholder="00000-000" />
              {cepLoading && <p className="text-[11px] text-[#0F1E3C]/40 mt-1">Buscando endereço...</p>}
            </Field>
            <Field label="Número">
              <input className={inputCls} value={numero} onChange={(e) => setNumero(e.target.value)}
                title="Sem número na casa? Digite S/N" placeholder="Ex: 123 ou S/N" />
            </Field>
          </div>
          <div className="space-y-4">
            <Field label="Logradouro">
              <input className={inputCls} value={logradouro} onChange={(e) => setLogradouro(e.target.value)} />
            </Field>
            <Field label="Complemento (opcional)">
              <input className={inputCls} value={complemento} onChange={(e) => setComplemento(e.target.value)}
                title="Apto, bloco ou ponto de referência" placeholder="Apto, bloco, referência..." />
            </Field>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Field label="Bairro"><input className={inputCls} value={bairro} onChange={(e) => setBairro(e.target.value)} /></Field>
              <Field label="Cidade"><input className={inputCls} value={cidade} onChange={(e) => setCidade(e.target.value)} /></Field>
              <Field label="UF"><input className={inputCls} value={uf} onChange={(e) => setUf(e.target.value.toUpperCase().slice(0, 2))} /></Field>
            </div>
          </div>
          {/* Código do município (IBGE): nunca uma caixa de texto — decisão 8 do plano */}
        </div>

        {error && <p className="text-sm text-red-600" role="alert">{error}</p>}

        <div className="flex items-center gap-3">
          <button type="submit" disabled={saving}
            className="inline-flex items-center gap-2 bg-[#4361EE] hover:bg-[#3451D4] text-white font-bold text-sm px-5 py-3 rounded-xl transition-colors disabled:opacity-50">
            <Save size={15} />
            {saving ? "Salvando..." : "Salvar"}
          </button>
          {status === "saved" && <span className="text-xs font-semibold text-[#1B8F63]" role="status" aria-live="polite">Dados atualizados!</span>}
        </div>
      </form>

      <ChangePasswordCard />
    </div>
  )
}

function ChangePasswordCard() {
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState("")
  const [ok, setOk] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    setOk(false)
    if (newPassword !== confirmPassword) { setError("As senhas não coincidem"); return }
    setSaving(true)
    try {
      const res = await fetch("/api/portal/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível trocar a senha"); return }
      setOk(true)
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("")
      setTimeout(() => setOk(false), 2500)
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="bg-white border border-[#0F1E3C]/8 rounded-2xl p-6 space-y-4">
      <p className="text-sm font-bold text-[#0F1E3C]">Trocar senha</p>
      <PasswordInput id="dados-current-pw" label="Senha atual" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <PasswordInput id="dados-new-pw" label="Nova senha" value={newPassword} onChange={setNewPassword} autoComplete="new-password" />
        <PasswordInput id="dados-confirm-pw" label="Confirmar nova senha" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />
      </div>
      {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving}
          className="inline-flex items-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm px-5 py-3 rounded-xl transition-colors disabled:opacity-50">
          <KeyRound size={15} />
          {saving ? "Salvando..." : "Trocar senha"}
        </button>
        {ok && <span className="text-xs font-semibold text-[#1B8F63]" role="status" aria-live="polite">Senha trocada!</span>}
      </div>
    </form>
  )
}

"use client"

import { useState, type FormEvent } from "react"
import { useRouter } from "next/navigation"
import { KeyRound, ShieldCheck } from "lucide-react"
import PasswordInput from "./components/PasswordInput"

// Primeiro acesso depois de aprovado como Fornecedor Fixo — a senha temporária
// de 6 dígitos que veio no WhatsApp precisa ser trocada antes de liberar o
// resto do portal (client_accounts.must_change_password).
export default function ForcePasswordChangeScreen({ name }: { name: string }) {
  const router = useRouter()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState("")
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    setError("")
    if (newPassword !== confirmPassword) { setError("As senhas não coincidem"); return }
    setLoading(true)
    try {
      const res = await fetch("/api/portal/auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? "Não foi possível trocar a senha"); return }
      router.refresh()
    } catch {
      setError("Erro de rede. Tenta de novo em instantes.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#F4F6FB] flex items-center justify-center px-5 py-12" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <div className="w-full max-w-sm">
        <div className="bg-white rounded-2xl border border-[#0F1E3C]/8 shadow-sm p-8">
          <div className="w-11 h-11 rounded-xl bg-[#4361EE]/10 flex items-center justify-center mb-5">
            <ShieldCheck size={19} className="text-[#4361EE]" />
          </div>
          <h1 className="text-xl font-black text-[#0F1E3C] mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
            Troca sua senha, {name.split(" ")[0]}
          </h1>
          <p className="text-sm text-[#0F1E3C]/50 mb-6">Por segurança, troque a senha temporária antes de continuar.</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordInput id="fpc-current" label="Senha temporária (recebida no WhatsApp)" value={currentPassword} onChange={setCurrentPassword} autoComplete="current-password" />
            <PasswordInput id="fpc-new" label="Nova senha" value={newPassword} onChange={setNewPassword}
              tooltip="Pode ser a senha que quiser, sem regra de tamanho ou caractere especial" autoComplete="new-password" />
            <PasswordInput id="fpc-confirm" label="Confirmar nova senha" value={confirmPassword} onChange={setConfirmPassword} autoComplete="new-password" />

            {error && <p className="text-xs text-red-600" role="alert">{error}</p>}

            <button
              type="submit" disabled={loading}
              className="w-full inline-flex items-center justify-center gap-2 bg-[#0F1E3C] hover:bg-[#1B2A4A] text-white font-bold text-sm py-3.5 rounded-xl transition-colors disabled:opacity-50"
            >
              <KeyRound size={16} />
              {loading ? "Salvando..." : "Trocar senha e continuar"}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}

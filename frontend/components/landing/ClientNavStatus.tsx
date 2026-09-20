"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOut, User } from "lucide-react"

// Estado de login do cliente no header/rodapé da LP e do catálogo — antes o
// link ia sempre pra /portal/login, então um cliente já logado clicava e
// caía de novo na tela de senha. Agora sinaliza quem tá logado e dá saída
// direta, sem passar pelo formulário de novo.
export default function ClientNavStatus({
  name, variant = "dark",
}: {
  name: string | null
  variant?: "dark" | "light"
}) {
  const router = useRouter()
  const textCls = variant === "dark"
    ? "text-white md:drop-shadow-[0_1px_4px_rgba(0,0,0,0.6)] hover:text-white/80"
    : "text-white/75 hover:text-white"

  async function handleLogout() {
    await fetch("/api/portal/auth/logout", { method: "POST" })
    router.refresh()
  }

  if (!name) {
    return (
      <Link href="/portal/login" className={`text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${textCls}`}>
        Entrar
      </Link>
    )
  }

  const firstName = name.split(" ")[0]

  return (
    <div className="flex items-center gap-2.5 sm:gap-3">
      <Link href="/portal" className={`inline-flex items-center gap-1.5 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${textCls}`}>
        <User size={13} /> Olá, {firstName}
      </Link>
      <button
        type="button" onClick={handleLogout} aria-label="Sair da conta"
        className={`inline-flex items-center gap-1 text-xs sm:text-sm font-semibold transition-colors whitespace-nowrap ${textCls}`}
      >
        <LogOut size={13} /> Sair
      </button>
    </div>
  )
}

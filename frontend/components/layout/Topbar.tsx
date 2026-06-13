"use client"

import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { logout, getSession } from "@/lib/auth"

export default function Topbar() {
  const router = useRouter()
  const session = getSession()

  async function handleLogout() {
    await logout()
    router.push("/login")
  }

  return (
    <header className="h-14 bg-white border-b border-[#0F1E3C]/8 flex items-center justify-between px-6 flex-shrink-0">
      <p className="text-sm text-[#0F1E3C]/50">
        Olá,{" "}
        <span className="font-semibold text-[#0F1E3C]">{session?.name ?? "Administrador"}</span>
      </p>
      <button
        onClick={handleLogout}
        className="flex items-center gap-2 text-xs font-semibold text-[#0F1E3C]/40 hover:text-red-600 transition-colors px-3 py-1.5 rounded-lg hover:bg-red-50"
      >
        <LogOut size={14} />
        Sair
      </button>
    </header>
  )
}

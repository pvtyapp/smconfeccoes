"use client"

import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"
import { logout, getSession } from "@/lib/auth"

export default function Topbar() {
  const router = useRouter()
  const session = getSession()

  function handleLogout() {
    logout()
    router.push("/login")
  }

  return (
    <header className="h-14 bg-white border-b border-gray-200 flex items-center justify-between px-6">
      <p className="text-sm text-gray-500">
        Olá, <span className="font-semibold text-gray-800">{session?.name ?? "Usuário"}</span>
      </p>
      <button
        onClick={handleLogout}
        className="flex items-center gap-2 text-sm text-gray-500 hover:text-red-600 transition-colors"
      >
        <LogOut size={16} />
        Sair
      </button>
    </header>
  )
}

"use client"

import { useRouter } from "next/navigation"
import { LogOut } from "lucide-react"

export default function LogoutButton() {
  const router = useRouter()
  async function handleLogout() {
    await fetch("/api/portal/auth/logout", { method: "POST" })
    router.push("/portal/login")
    router.refresh()
  }
  return (
    <button onClick={handleLogout} className="inline-flex items-center gap-2 text-sm text-[#0F1E3C]/50 hover:text-[#0F1E3C]">
      <LogOut size={15} /> Sair
    </button>
  )
}

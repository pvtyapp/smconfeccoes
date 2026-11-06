"use client"

import "@/components/layout/painel.css"
import { useEffect, useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import Sidebar from "@/components/layout/Sidebar"
import GuardaTela from "@/components/layout/GuardaTela"
import ContaNumeros from "@/components/layout/ContaNumeros"
import { isAuthenticated } from "@/lib/auth"

// Esqueleto do painel (PIV 05/11): menu novo, transição suave entre telas e a camada visual (painel.css) que moderniza as telas antigas.
export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [collapsed, setCollapsed] = useState(false)

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace("/login")
    }
    try {
      if (localStorage.getItem("sidebar_collapsed") === "1") setCollapsed(true)
    } catch { /* ignora */ }
  }, [router])

  function handleToggle() {
    setCollapsed(v => {
      const next = !v
      try { localStorage.setItem("sidebar_collapsed", next ? "1" : "0") } catch { /* ignora */ }
      return next
    })
  }

  return (
    <div className="painel flex h-screen overflow-hidden" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <main className="pn-main relative flex-1 overflow-y-auto p-6 min-w-0">
        <div key={pathname} className="pn-tela">{children}</div>
      </main>
      <GuardaTela />
      <ContaNumeros chave={pathname} />
    </div>
  )
}

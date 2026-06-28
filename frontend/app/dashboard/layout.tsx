"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Sidebar from "@/components/layout/Sidebar"
import { isAuthenticated } from "@/lib/auth"

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
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
    <div className="flex h-screen bg-[#F4F6FB] overflow-hidden" style={{ fontFamily: "var(--font-dm-sans), sans-serif" }}>
      <Sidebar collapsed={collapsed} onToggle={handleToggle} />
      <main className="flex-1 overflow-y-auto p-6 min-w-0">{children}</main>
    </div>
  )
}

"use client"

import { useEffect } from "react"
import { usePathname, useRouter } from "next/navigation"
import { getSession } from "@/lib/auth"
import { useAcesso } from "@/lib/acessoClient"
import { firstAllowedPage, FINANCE_PAGES } from "@/lib/navPages"

// PIV 06/11: usuário sem a aba liberada não entra nela por nenhum caminho (link, atalho,
// voltar do navegador). O middleware já barra pelo cookie do login; aqui vale a permissão
// do banco (/api/auth/me, via useAcesso), então tirar a aba na tela de Usuários vale na hora.
export default function GuardaTela() {
  const pathname = usePathname()
  const router = useRouter()
  const acesso = useAcesso()

  useEffect(() => {
    const s = getSession()
    if (!s || s.isAdmin) return
    const verFin = s.verFinanceiro ?? true
    // "/dashboard" é a tela inicial, não a pasta: liberar ela não libera as telas de dentro
    const dentro = (p: string) => pathname === p || (p !== "/dashboard" && pathname.startsWith(p + "/"))
    const pode = (s.allowedPages ?? []).some(dentro) && (verFin || !FINANCE_PAGES.some(dentro))
    if (!pode) router.replace(firstAllowedPage(false, s.allowedPages ?? [], verFin) ?? "/sem-acesso")
  }, [pathname, acesso, router])

  return null
}

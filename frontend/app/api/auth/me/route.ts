import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { verifySession, COOKIE_NAME } from "@/lib/session"
import { getAcesso } from "@/lib/acesso"

export async function GET() {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  const session = token ? await verifySession(token) : null

  // Permissões vêm do banco (não do cookie): mudou na tela de Usuários, vale no próximo carregamento.
  // Fora da produção (dev local, sem login) o getAcesso libera tudo, igual ao middleware.
  const acesso = await getAcesso()
  if (!acesso || (!session && acesso.userId !== null)) {
    return NextResponse.json({ error: "Não autenticado" }, { status: 401 })
  }
  const dev = acesso.userId === null

  return NextResponse.json({
    name: session?.name ?? "dev",
    login: session?.login ?? "dev",
    isAdmin: dev ? (session?.isAdmin ?? true) : acesso.isAdmin,
    allowedPages: dev ? (session?.allowedPages ?? []) : acesso.allowedPages,
    verPreco: acesso.verPreco,
    verFinanceiro: acesso.verFinanceiro,
  })
}

import { NextRequest, NextResponse } from "next/server"
import { verifySession, COOKIE_NAME } from "@/lib/session"
import { firstAllowedPage } from "@/lib/navPages"

// Paths that do NOT require authentication
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/whatsapp/webhook",
  "/api/whatsapp/cron",
  "/api/orders/expire",
  "/api/lifecycle/migrate",
  "/api/chat/migrate",
  "/api/marketing/migrate",
  "/api/chat/sync",
  "/api/dtf/pedidos/migrate2",
  "/api/dtf/pedidos/migrate3",
  "/api/dtf/pedidos/migrate4",
  "/api/dtf/film-bobinas/migrate-v2",
  "/api/dtf/film-bobinas/backfill-saidas",
  "/api/dtf/film-bobinas/fix-saida",
  "/api/dtf/printer-refis/migrate",
  "/api/debug/audit-col-types", // temporário — audita tipos de coluna pra fechar levantamento de timezone
]

function hasPagePermission(pathname: string, isAdmin: boolean, allowedPages: string[]): boolean {
  if (isAdmin) return true
  return allowedPages.some(p => pathname === p || pathname.startsWith(p + "/"))
}

export async function middleware(request: NextRequest) {
  const AUTH_SECRET = process.env.AUTH_SECRET

  // AUTH_SECRET not configured OR running locally → skip middleware
  if (!AUTH_SECRET || process.env.VERCEL_ENV !== "production") return NextResponse.next()

  const { pathname } = request.nextUrl

  // Allow public API paths
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const token   = request.cookies.get(COOKIE_NAME)?.value
  const session = token ? await verifySession(token) : null

  if (!session) {
    // Redirect dashboard pages to login
    if (pathname.startsWith("/dashboard")) {
      const loginUrl = new URL("/login", request.url)
      loginUrl.searchParams.set("from", pathname)
      return NextResponse.redirect(loginUrl)
    }
    // Block API calls
    if (pathname.startsWith("/api/")) {
      return new NextResponse(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      })
    }
    return NextResponse.next()
  }

  // Bloqueio real por permissão — não deixa renderizar mesmo digitando a URL direto.
  // Manda pra primeira página que o usuário realmente tem liberada (nunca mais um
  // /dashboard fixo que pode não ser acessível pra ele) — ou pra /sem-acesso se não
  // sobrar nenhuma.
  if (pathname.startsWith("/dashboard") && !hasPagePermission(pathname, session.isAdmin, session.allowedPages)) {
    const dest = firstAllowedPage(session.isAdmin, session.allowedPages)
    return NextResponse.redirect(new URL(dest ?? "/sem-acesso", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
}

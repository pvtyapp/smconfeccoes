import { NextRequest, NextResponse } from "next/server"
import { verifySession, COOKIE_NAME } from "@/lib/session"

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
]

// /dashboard raiz é sempre acessível pra qualquer usuário logado — evita loop de
// redirect se alguém não tiver nenhuma página liberada ainda, e serve de landing page.
function hasPagePermission(pathname: string, isAdmin: boolean, allowedPages: string[]): boolean {
  if (isAdmin) return true
  if (pathname === "/dashboard") return true
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

  // Bloqueio real por permissão — não deixa renderizar mesmo digitando a URL direto
  if (pathname.startsWith("/dashboard") && !hasPagePermission(pathname, session.isAdmin, session.allowedPages)) {
    return NextResponse.redirect(new URL("/dashboard", request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
}

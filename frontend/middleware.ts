import { NextRequest, NextResponse } from "next/server"

// Paths that do NOT require authentication
const PUBLIC_API_PREFIXES = [
  "/api/auth/",
  "/api/whatsapp/webhook",
  "/api/whatsapp/cron",
  "/api/marketing/execute",
  "/api/orders/expire",
  "/api/lifecycle/migrate",
  "/api/chat/migrate",
  "/api/marketing/migrate",
  "/api/chat/sync",
  "/api/chat/cleanup-dupes",
  "/api/dtf/pedidos/migrate2",
  "/api/dtf/pedidos/migrate3",
  "/api/dtf/pedidos/migrate4",
  "/api/dtf/film-bobinas/migrate-v2",
  "/api/dtf/film-bobinas/backfill-saidas",
  "/api/dtf/film-bobinas/diagnostico",
  "/api/debug/",
]

export function middleware(request: NextRequest) {
  const AUTH_SECRET = process.env.AUTH_SECRET

  // AUTH_SECRET not configured → skip middleware (backward compat)
  if (!AUTH_SECRET) return NextResponse.next()

  const { pathname } = request.nextUrl

  // Allow public API paths
  if (PUBLIC_API_PREFIXES.some(p => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const session = request.cookies.get("smc_session")?.value
  const valid   = session === AUTH_SECRET

  if (valid) return NextResponse.next()

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

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
}

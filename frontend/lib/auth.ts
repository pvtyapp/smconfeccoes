import type { AuthSession } from "./types"

const SESSION_KEY = "smc_auth_session"

export function setLocalSession(session: AuthSession): void {
  if (typeof window === "undefined") return
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export async function logout(): Promise<void> {
  if (typeof window !== "undefined") {
    localStorage.removeItem(SESSION_KEY)
  }
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {})
}

export function getSession(): AuthSession | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(SESSION_KEY)
  if (!raw) return null
  try {
    return JSON.parse(raw) as AuthSession
  } catch {
    return null
  }
}

export function isAuthenticated(): boolean {
  return getSession() !== null
}

// Busca a sessão real (nome, isAdmin, allowedPages) do usuário logado — chamado
// logo após o login, já que o cookie httpOnly não pode ser lido direto pelo front.
export async function fetchAndStoreSession(): Promise<AuthSession | null> {
  try {
    const res = await fetch("/api/auth/me")
    if (!res.ok) return null
    const session = await res.json() as AuthSession
    setLocalSession(session)
    return session
  } catch {
    return null
  }
}

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

import { SignJWT, jwtVerify } from "jose"
import { cookies } from "next/headers"

// Sessão do cliente no portal — espelha lib/session.ts (equipe), mas separada:
// payload e cookie diferentes, mesmo AUTH_SECRET. Nunca misturar com smc_session.
export type ClientSessionPayload = {
  clientAccountId: number
  contactId: number
  name: string
  // Opcional pra não quebrar sessão já emitida antes desse campo existir —
  // ausente/inválido sempre lido como false (ver verifyClientSession).
  mustChangePassword?: boolean
}

const COOKIE_NAME = "smc_client_session"
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30 // 30 dias

function getSecretKey(): Uint8Array {
  const secret = process.env.AUTH_SECRET
  if (!secret) throw new Error("AUTH_SECRET não configurado no servidor")
  return new TextEncoder().encode(secret)
}

export async function signClientSession(payload: ClientSessionPayload): Promise<string> {
  return new SignJWT({ ...payload })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(getSecretKey())
}

export async function verifyClientSession(token: string): Promise<ClientSessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecretKey())
    if (
      typeof payload.clientAccountId !== "number" ||
      typeof payload.contactId !== "number" ||
      typeof payload.name !== "string"
    ) {
      return null
    }
    return {
      clientAccountId: payload.clientAccountId,
      contactId: payload.contactId,
      name: payload.name,
      mustChangePassword: typeof payload.mustChangePassword === "boolean" ? payload.mustChangePassword : false,
    }
  } catch {
    return null
  }
}

export async function getClientSessionFromRequest(): Promise<ClientSessionPayload | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null
  return verifyClientSession(token)
}

export { COOKIE_NAME, MAX_AGE_SECONDS }

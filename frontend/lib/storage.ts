const PREFIX = "smc_"

export function storageGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null
  const raw = localStorage.getItem(PREFIX + key)
  if (!raw) return null
  try {
    return JSON.parse(raw) as T
  } catch {
    return null
  }
}

export function storageSet<T>(key: string, value: T): void {
  localStorage.setItem(PREFIX + key, JSON.stringify(value))
}

export function storageRemove(key: string): void {
  localStorage.removeItem(PREFIX + key)
}

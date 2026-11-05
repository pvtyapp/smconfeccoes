import { redirect } from "next/navigation"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import PortalSite from "@/components/site/portal/PortalSite"
import { getPublicCatalog } from "@/lib/catalog/getPublicCatalog"
import { precoMetroDtf } from "@/lib/dtfPreco"
import ForcePasswordChangeScreen from "./ForcePasswordChangeScreen"

export default async function PortalHomePage() {
  const session = await getClientSessionFromRequest()
  if (!session) redirect("/portal/login")
  if (session.mustChangePassword) return <ForcePasswordChangeScreen name={session.name} />

  const [products, dtf] = await Promise.all([getPublicCatalog(), precoMetroDtf().catch(() => null)])
  return <PortalSite name={session.name} products={products} dtfPreco={dtf?.precoMetro ?? null} />
}

export const dynamic = "force-dynamic"

import SiteHome from "@/components/site/SiteHome"
import { getPublicCatalog } from "@/lib/catalog/getPublicCatalog"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { precoMetroDtf } from "@/lib/dtfPreco"

// Home nova (PIV 05/11): site de pedidos. O layout antigo (carrossel de banners,
// formulário de acesso e mapa) saiu; os componentes de components/landing
// continuam no repositório até a gente confirmar que nada mais usa.
export default async function LandingPage() {
  const [products, dtf, clientSession] = await Promise.all([
    getPublicCatalog(),
    precoMetroDtf().catch(() => null),
    getClientSessionFromRequest(),
  ])

  return <SiteHome products={products} dtfPreco={dtf?.precoMetro ?? null} clientName={clientSession?.name ?? null} />
}

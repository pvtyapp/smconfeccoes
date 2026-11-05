export const dynamic = "force-dynamic"

import SiteHome from "@/components/site/SiteHome"
import { getPublicCatalog } from "@/lib/catalog/getPublicCatalog"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import { precoMetroDtf } from "@/lib/dtfPreco"

// Catálogo (deslogado e logado) com a mesma grade cor × tamanho e o mesmo pedido
// da home nova (PIV 05/11: "o catálogo tá bugado, tá ruim"). Os componentes
// antigos desta pasta (ProductCard/CartPanel) ficam até confirmar que nada usa.
export default async function CatalogoPage() {
  const [products, dtf, clientSession] = await Promise.all([
    getPublicCatalog(),
    precoMetroDtf().catch(() => null),
    getClientSessionFromRequest(),
  ])
  return <SiteHome variante="catalogo" products={products} dtfPreco={dtf?.precoMetro ?? null} clientName={clientSession?.name ?? null} />
}

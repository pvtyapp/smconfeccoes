import { redirect } from "next/navigation"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import PortalSite from "@/components/site/portal/PortalSite"
import ForcePasswordChangeScreen from "./ForcePasswordChangeScreen"

export default async function PortalHomePage() {
  const session = await getClientSessionFromRequest()
  if (!session) redirect("/portal/login")
  if (session.mustChangePassword) return <ForcePasswordChangeScreen name={session.name} />

  return <PortalSite name={session.name} />
}

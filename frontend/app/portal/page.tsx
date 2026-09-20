import { redirect } from "next/navigation"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import PortalHub from "./PortalHub"
import ForcePasswordChangeScreen from "./ForcePasswordChangeScreen"

export default async function PortalHomePage() {
  const session = await getClientSessionFromRequest()
  if (!session) redirect("/portal/login")
  if (session.mustChangePassword) return <ForcePasswordChangeScreen name={session.name} />

  return <PortalHub name={session.name} />
}

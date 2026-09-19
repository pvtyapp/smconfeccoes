import { redirect } from "next/navigation"
import { getClientSessionFromRequest } from "@/lib/clientSession"
import PortalHub from "./PortalHub"

export default async function PortalHomePage() {
  const session = await getClientSessionFromRequest()
  if (!session) redirect("/portal/login")

  return <PortalHub name={session.name} />
}

const CDP_URL     = "http://localhost:9222"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const JOB_ID      = 7808621

async function main() {
  const list = await fetch(`${CDP_URL}/json`).then(r => r.json())
  const tab  = list.find(t => t.type === "page")
  const ws   = new WebSocket(tab.webSocketDebuggerUrl)
  let id = 1
  const pending = new Map()
  await new Promise(res => ws.addEventListener("open", res))
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const mid = id++
    pending.set(mid, { resolve, reject })
    ws.send(JSON.stringify({ id: mid, method, params }))
  })
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data)
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id)
      pending.delete(msg.id)
      if (msg.error) reject(new Error(msg.error.message))
      else resolve(msg.result)
    }
  })
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const ev = async (expr, awaitProm = false) => {
    const result = await send("Runtime.evaluate", { expression: expr, awaitPromise: awaitProm, returnByValue: true })
    return result?.result?.value
  }

  // Navigate to cron-job.org
  await send("Page.navigate", { url: "https://console.cron-job.org/dashboard" })
  await sleep(4000)

  // Get JWT + PATCH + verify all in one browser expression
  const result = await ev(`
    (async () => {
      const jwt = JSON.parse(localStorage.getItem("state"))?.auth?.session?.token
      if (!jwt) return "no JWT"

      const patchRes = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + jwt },
        body: JSON.stringify({
          job: {
            requestMethod: 1,
            extendedData: {
              headers: [
                { name: "Authorization", value: "Bearer ${CRON_SECRET}" }
              ]
            }
          }
        })
      })
      const patchText = await patchRes.text()

      // Verify
      const getRes = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        headers: { "Authorization": "Bearer " + jwt }
      })
      const getData = await getRes.json()
      const j = getData.jobDetails

      return JSON.stringify({
        patchStatus: patchRes.status,
        patchBody: patchText.slice(0, 100),
        method: j?.requestMethod,
        headers: j?.extendedData?.headers,
        enabled: j?.enabled,
      }, null, 2)
    })()
  `, true)

  console.log("Result:", result)
  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

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
    const result = await send("Runtime.evaluate", {
      expression: expr,
      awaitPromise: awaitProm,
      returnByValue: true,
    })
    return result?.result?.value
  }

  // Navigate to cron-job.org to ensure we have session cookies
  console.log("Navigating to cron-job.org...")
  await send("Page.navigate", { url: "https://console.cron-job.org" })
  await sleep(4000)

  const currentUrl = await ev("location.href")
  console.log("At:", currentUrl)

  // Get JWT from localStorage
  const jwt = await ev(`
    try {
      const raw = localStorage.getItem("state")
      if (!raw) return "no state key. keys=" + Object.keys(localStorage).join(",")
      const parsed = JSON.parse(raw)
      parsed?.auth?.session?.token || "token not found. keys=" + Object.keys(parsed?.auth?.session || {}).join(",")
    } catch(e) { "error: " + e.message }
  `)
  console.log("JWT:", jwt?.slice(0, 80) + "...")

  if (!jwt || !jwt.startsWith("eyJ")) {
    console.error("No JWT found. Cannot proceed.")
    ws.close()
    return
  }

  // PATCH the job: requestMethod=1 (POST), headers as array
  const patch = await ev(`
    (async () => {
      const body = {
        job: {
          requestMethod: 1,
          extendedData: {
            headers: [
              { name: "Authorization", value: "Bearer ${CRON_SECRET}" }
            ]
          }
        }
      }
      const r = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "Authorization": "Bearer ${jwt}",
        },
        body: JSON.stringify(body)
      })
      const text = await r.text()
      return r.status + ": " + text.slice(0, 300)
    })()
  `, true)
  console.log("PATCH result:", patch)

  // Verify by GETting the job
  await sleep(1000)
  const verify = await ev(`
    (async () => {
      const r = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        headers: { "Authorization": "Bearer ${jwt}" }
      })
      const data = await r.json()
      const j = data.jobDetails
      return JSON.stringify({
        method: j?.requestMethod,
        headers: j?.extendedData?.headers,
        url: j?.url,
        enabled: j?.enabled,
      }, null, 2)
    })()
  `, true)
  console.log("Verify:", verify)

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

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
    const res = await send("Runtime.evaluate", { expression: expr, awaitPromise: awaitProm, returnByValue: true })
    return res?.result?.value
  }

  await send("Page.navigate", { url: "https://console.cron-job.org/dashboard" })
  await sleep(4000)
  console.log("At:", await ev("location.href"))

  // PATCH using session cookies (fetch from within cron-job.org domain)
  const patchResult = await ev(`
    (async () => {
      const r = await fetch("/jobs/${JOB_ID}", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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
      const txt = await r.text()
      return r.status + "|" + txt.slice(0, 300)
    })()
  `, true)
  console.log("PATCH /jobs (relative):", patchResult)

  await sleep(1000)

  // Also try absolute URL with credentials
  const patchResult2 = await ev(`
    (async () => {
      const r = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
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
      const txt = await r.text()
      return r.status + "|" + txt.slice(0, 300)
    })()
  `, true)
  console.log("PATCH api.cron-job.org (absolute+credentials):", patchResult2)

  // Watch network requests to intercept the actual API calls made by the UI
  // Navigate to job edit page and intercept XHR
  console.log("\nInspecting network calls made by the UI...")
  await send("Page.navigate", { url: `https://console.cron-job.org/jobs/${JOB_ID}` })
  await sleep(4000)

  // Intercept what the page does when it loads job details
  const networkLog = await ev(`
    (async () => {
      // Monkey-patch fetch to log all calls
      const original = window.fetch
      const calls = []
      window.fetch = (...args) => {
        calls.push(typeof args[0] === "string" ? args[0] : args[0].url)
        return original.apply(window, args)
      }
      // Trigger a reload of job data
      await new Promise(r => setTimeout(r, 2000))
      window.fetch = original
      return JSON.stringify(calls)
    })()
  `, true)
  console.log("Network calls:", networkLog)

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

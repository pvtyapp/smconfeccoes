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

  // Step 1: get JWT
  const jwt = await ev(`JSON.parse(localStorage.getItem("state"))?.auth?.session?.token`)
  console.log("JWT found:", jwt ? "YES (" + jwt.slice(0,40) + "...)" : "NO")
  if (!jwt) { ws.close(); return }

  // Step 2: PATCH
  const patchResult = await ev(`
    (async () => {
      const r = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "Authorization": "Bearer " + ${JSON.stringify(jwt)} },
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
      return r.status + "|" + txt.slice(0,200)
    })()
  `, true)
  console.log("PATCH:", patchResult)

  await sleep(1000)

  // Step 3: verify GET
  const getResult = await ev(`
    (async () => {
      const r = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        headers: { "Authorization": "Bearer " + ${JSON.stringify(jwt)} }
      })
      const txt = await r.text()
      return r.status + "|" + txt.slice(0,500)
    })()
  `, true)
  console.log("GET verify:", getResult)

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

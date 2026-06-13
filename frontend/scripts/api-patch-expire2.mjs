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

  await send("Page.navigate", { url: "https://console.cron-job.org/jobs/7808621" })
  await sleep(4000)

  // Get localStorage
  const ls = await ev(`JSON.stringify(Object.fromEntries(Array.from({length:localStorage.length},(_,i)=>[localStorage.key(i),localStorage.getItem(localStorage.key(i))?.slice(0,80)])))`)
  console.log("LS:", ls?.slice(0, 500))

  // PATCH via browser fetch (uses session cookies automatically)
  const patch = await ev(`
    (async () => {
      const r = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          job: {
            requestMethod: 1,
            extendedData: {
              headers: { "Authorization": "Bearer ${CRON_SECRET}" }
            }
          }
        })
      })
      const text = await r.text()
      return r.status + ": " + text
    })()
  `, true)
  console.log("PATCH:", patch)

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

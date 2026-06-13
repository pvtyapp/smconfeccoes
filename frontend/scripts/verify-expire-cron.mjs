const CDP_URL = "http://localhost:9222"
const JOB_ID  = 7808621

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

  const result = await send("Runtime.evaluate", {
    expression: `(async () => {
      const r = await fetch("https://api.cron-job.org/jobs/${JOB_ID}", { credentials: "include" })
      const data = await r.json()
      const job = data.jobDetails
      return JSON.stringify({
        title: job?.title,
        url: job?.url,
        requestMethod: job?.requestMethod,
        schedule: job?.schedule?.exprCustom,
        headers: job?.extendedData?.headers,
        enabled: job?.enabled,
      }, null, 2)
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  console.log("Job details:", result?.result?.value)

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

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

  const result = await ev(`
    (async () => {
      const jwt = JSON.parse(localStorage.getItem("state"))?.auth?.session?.token
      if (!jwt) return "no JWT"

      const HEADERS = {
        "Content-Type": "application/json",
        "Authorization": "Bearer " + jwt,
        "X-UI-Language": "en",
        "Accept": "application/json, text/plain, */*",
      }

      // Step 1: get current job details
      const getRes = await fetch("https://api.cron-job.org/", {
        method: "POST",
        headers: { ...HEADERS, "X-API-Method": "GetJobDetails" },
        body: JSON.stringify({ jobId: ${JOB_ID} })
      })
      const getData = await getRes.json()
      const currentJob = getData.jobDetails
      if (!currentJob) return "GetJobDetails failed: " + JSON.stringify(getData).slice(0, 200)

      // Step 2: update with POST method + Authorization header
      const updatedJob = {
        ...currentJob,
        requestMethod: 1,
        extendedData: {
          ...currentJob.extendedData,
          headers: { "Authorization": "Bearer ${CRON_SECRET}" }
        }
      }

      const updateRes = await fetch("https://api.cron-job.org/", {
        method: "POST",
        headers: { ...HEADERS, "X-API-Method": "UpdateJob" },
        body: JSON.stringify({ jobId: ${JOB_ID}, job: updatedJob })
      })
      const updateText = await updateRes.text()

      // Step 3: verify
      const verifyRes = await fetch("https://api.cron-job.org/", {
        method: "POST",
        headers: { ...HEADERS, "X-API-Method": "GetJobDetails" },
        body: JSON.stringify({ jobId: ${JOB_ID} })
      })
      const verifyData = await verifyRes.json()
      const vj = verifyData.jobDetails

      return JSON.stringify({
        updateStatus: updateRes.status,
        updateBody: updateText.slice(0, 100),
        verifyMethod: vj?.requestMethod,
        verifyHeaders: vj?.extendedData?.headers,
        verifyEnabled: vj?.enabled,
      }, null, 2)
    })()
  `, true)

  console.log("Result:", result)
  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

const CDP_URL     = "http://localhost:9222"
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

  // Enable network events
  await send("Network.enable", {})

  // Collect network requests
  const requests = []
  ws.addEventListener("message", ({ data }) => {
    const msg = JSON.parse(data)
    if (msg.method === "Network.requestWillBeSent") {
      const req = msg.params.request
      if (req.url.includes("cron-job.org") && req.method !== "GET") {
        requests.push({
          url: req.url,
          method: req.method,
          headers: req.headers,
          body: req.postData?.slice(0, 500),
        })
      }
    }
  })

  // Navigate to job edit page
  await send("Page.navigate", { url: `https://console.cron-job.org/jobs/${JOB_ID}` })
  await sleep(4000)
  console.log("At:", await ev("location.href"))

  // Read current job state from page
  const pageText = await ev("document.body.innerText")
  const methodLine = pageText?.split("\n").find(l => l.includes("Request method") || l.includes("GET") || l.includes("POST"))
  console.log("Current method line:", methodLine)

  // Click Save button (without any changes) to capture the exact API payload
  await ev(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Save")?.click()`)
  await sleep(3000)

  console.log("\n=== Intercepted network calls ===")
  requests.forEach((r, i) => {
    console.log(`\n[${i}] ${r.method} ${r.url}`)
    console.log("Headers:", JSON.stringify(r.headers, null, 2))
    console.log("Body:", r.body)
  })

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

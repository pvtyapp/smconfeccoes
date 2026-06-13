const CDP_URL     = "http://localhost:9222"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"

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
  const ev = async expr => (await send("Runtime.evaluate", { expression: expr }))?.result?.value

  // Wait for element helper
  async function waitForEl(selector, timeout = 8000) {
    const start = Date.now()
    while (Date.now() - start < timeout) {
      const found = await ev(`!!document.querySelector(${JSON.stringify(selector)})`)
      if (found) return true
      await sleep(300)
    }
    return false
  }

  // Navigate to jobs list
  await send("Page.navigate", { url: "https://console.cron-job.org/jobs" })
  await sleep(5000) // SPA needs extra time

  const bodyText = await ev("document.body.innerText")
  console.log("Page text:", bodyText?.slice(0, 500))

  // Find all hrefs
  const hrefs = await ev(`[...document.querySelectorAll("[href],[data-href]")].map(el => (el.href||el.dataset.href||"") + "|" + el.textContent?.trim().slice(0,20)).filter(s=>s.includes("cron-job")).join("\\n")`)
  console.log("Links found:", hrefs?.slice(0, 1000))

  // Try to find any anchor or button that leads to the expire job edit
  const allAnchors = await ev(`[...document.querySelectorAll("a")].map(a => a.href + "|" + a.textContent.trim().slice(0,20)).join("\\n")`)
  console.log("All anchors:", allAnchors?.slice(0, 1000))

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

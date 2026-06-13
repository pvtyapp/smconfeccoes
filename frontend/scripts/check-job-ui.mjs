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
  const sleep = ms => new Promise(r => setTimeout(r, ms))
  const ev = async expr => (await send("Runtime.evaluate", { expression: expr, returnByValue: true }))?.result?.value

  // Navigate to edit page fresh
  await send("Page.navigate", { url: `https://console.cron-job.org/jobs/${JOB_ID}` })
  await sleep(5000)

  // Click Advanced tab
  await ev(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Advanced")?.click()`)
  await sleep(1000)

  // Read the full page text to see current state
  const pageText = await ev("document.body.innerText")
  console.log("Page:", pageText?.slice(0, 2000))

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

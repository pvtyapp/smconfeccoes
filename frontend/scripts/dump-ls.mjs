const CDP_URL = "http://localhost:9222"

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

  await send("Page.navigate", { url: "https://console.cron-job.org/dashboard" })
  await sleep(4000)

  const allLS = await ev(`
    JSON.stringify(
      Array.from({ length: localStorage.length }, (_, i) => {
        const k = localStorage.key(i)
        const v = localStorage.getItem(k)
        return { key: k, preview: v?.slice(0, 120) }
      })
    )
  `)
  console.log("LocalStorage keys:")
  const items = JSON.parse(allLS || "[]")
  items.forEach(({ key, preview }) => console.log(`  [${key}] = ${preview}`))

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

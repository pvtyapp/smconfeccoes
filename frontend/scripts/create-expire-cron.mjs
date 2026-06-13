const CDP_URL     = "http://localhost:9222"
const JOB_URL     = "https://smconfeccoes.vercel.app/api/orders/expire"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const JOB_TITLE   = "SM - Orders Expire (hourly)"

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

  await send("Page.navigate", { url: "https://console.cron-job.org/jobs/create" })
  await sleep(3500)

  // Title (first text input)
  await ev(`document.querySelectorAll('input[type=text]')[0]?.focus()`)
  await sleep(200)
  await send("Input.insertText", { text: JOB_TITLE })
  await sleep(200)

  // URL field
  const urlFocus = await ev(`
    const inp = document.querySelector('input[type=url]') ||
      document.querySelector('input[placeholder*="http"]') ||
      document.querySelectorAll('input[type=text]')[1]
    if(inp) { inp.focus(); inp.value = ""; inp.dispatchEvent(new Event("input",{bubbles:true})) }
    inp ? "ok:" + (inp.placeholder || inp.name) : "not found"
  `)
  console.log("URL input:", urlFocus)
  await sleep(200)
  await send("Input.insertText", { text: JOB_URL })
  await sleep(300)

  // Schedule: click Custom
  const customSched = await ev(`
    const els = [...document.querySelectorAll("label,button,[role=radio],input[type=radio]")]
    const el = els.find(e => /custom/i.test(e.textContent || e.value))
    if(el) { el.click(); "clicked:" + (el.textContent||el.value) }
    else "not found, options: " + els.slice(0,10).map(e=>e.textContent?.trim()||e.value).filter(Boolean).join("|")
  `)
  console.log("Custom schedule:", customSched)
  await sleep(600)

  // Fill cron expression input
  const cronFill = await ev(`
    const allInputs = [...document.querySelectorAll("input")]
    const cronInp = allInputs.find(i =>
      i.value?.includes("*") || i.placeholder?.includes("*") ||
      (i.name||"").toLowerCase().includes("expression") ||
      (i.name||"").toLowerCase().includes("cron")
    )
    if(cronInp) { cronInp.focus(); cronInp.value = ""; cronInp.dispatchEvent(new Event("input",{bubbles:true})) }
    cronInp ? "ok:" + cronInp.name : "not found, inputs: " + allInputs.map(i=>i.name||i.placeholder||i.type).join(",")
  `)
  console.log("Cron expression input:", cronFill)
  await sleep(200)
  await send("Input.insertText", { text: "0 * * * *" })
  await sleep(200)

  // Click ADVANCED tab
  const advTab = await ev(`
    const tabs = [...document.querySelectorAll("button,a,[role=tab],[class*=tab]")]
    const t = tabs.find(el => /advanced/i.test(el.textContent))
    if(t) { t.click(); "clicked" } else "not found"
  `)
  console.log("Advanced tab:", advTab)
  await sleep(800)

  // Set request type to POST
  const postMethod = await ev(`
    const sel = document.querySelector("select")
    if(sel) { sel.value="POST"; sel.dispatchEvent(new Event("change",{bubbles:true})); "select:"+sel.value }
    else {
      const btns = [...document.querySelectorAll("button,label")]
      const p = btns.find(b => b.textContent.trim()==="POST")
      if(p) { p.click(); "clicked POST" }
      else "not found"
    }
  `)
  console.log("POST method:", postMethod)
  await sleep(300)

  // Add header — click "Add header" button
  const addHdr = await ev(`
    const btns = [...document.querySelectorAll("button,span")]
    const b = btns.find(el => /add.*(header|request)/i.test(el.textContent) || /header/i.test(el.textContent))
    if(b) { b.click(); "clicked:" + b.textContent.trim() }
    else "not found, btns: " + btns.map(b=>b.textContent.trim().slice(0,15)).filter(Boolean).join("|")
  `)
  console.log("Add header:", addHdr)
  await sleep(500)

  // Fill header name "Authorization"
  const hdrName = await ev(`
    const inp = [...document.querySelectorAll("input")].find(i =>
      /header.*(name|key)|name.*header/i.test(i.placeholder) || i.placeholder?.toLowerCase()==="name"
    ) || [...document.querySelectorAll("input[type=text]")].slice(-2)[0]
    if(inp) { inp.focus(); inp.value = "" }
    inp ? "ok:" + inp.placeholder : "not found"
  `)
  console.log("Header name input:", hdrName)
  await sleep(200)
  await send("Input.insertText", { text: "Authorization" })

  // Tab to header value
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
  await sleep(100)
  await send("Input.dispatchKeyEvent", { type: "keyUp",  key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
  await sleep(200)
  await send("Input.insertText", { text: `Bearer ${CRON_SECRET}` })
  await sleep(300)

  // Save
  const saveBtn = await ev(`
    const btn = [...document.querySelectorAll("button[type=submit],button")]
      .find(b => /save|create|add cronjob/i.test(b.textContent))
    if(btn) { btn.click(); btn.textContent.trim() }
    else "not found: " + [...document.querySelectorAll("button")].map(b=>b.textContent.trim()).join("|")
  `)
  console.log("Save:", saveBtn)
  await sleep(4000)

  console.log("Final URL:", await ev("location.href"))
  const pageSnippet = await ev("document.body.innerText.slice(0,800)")
  console.log("Page:", pageSnippet)

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

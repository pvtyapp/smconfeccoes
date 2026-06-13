const CDP_URL     = "http://localhost:9222"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const EDIT_URL    = "https://console.cron-job.org/jobs/7808621"

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

  await send("Page.navigate", { url: EDIT_URL })
  await sleep(5000)

  const url = await ev("location.href")
  console.log("At:", url)

  // Click Advanced tab
  await ev(`[...document.querySelectorAll("button,a,[role=tab]")].find(el => /advanced/i.test(el.textContent))?.click()`)
  await sleep(1000)

  // Check current page structure
  const pageText = await ev("document.body.innerText.slice(0,1500)")
  console.log("Page:", pageText)

  // Find and set HTTP Method to POST
  const methodSet = await ev(`
    // Try select dropdown
    const sel = [...document.querySelectorAll("select")].find(s =>
      s.options && [...s.options].some(o => o.value==="POST" || o.text==="POST")
    )
    if(sel) {
      sel.value = "POST"
      sel.dispatchEvent(new Event("change",{bubbles:true}))
      return "select set to POST: " + sel.value
    }
    // Try buttons/tabs
    const postBtn = [...document.querySelectorAll("button,[role=radio],[role=tab],label")].find(b => b.textContent.trim()==="POST")
    if(postBtn) { postBtn.click(); return "clicked POST button" }
    return "POST not found. Selects: " + [...document.querySelectorAll("select")].map(s=>"["+[...s.options].map(o=>o.value).join(",")+"]").join(" | ")
  `)
  console.log("Method:", methodSet)
  await sleep(400)

  // Check existing header inputs for Authorization
  const headerCheck = await ev(`
    const all = [...document.querySelectorAll("input")]
    const vals = all.map(i => i.value || i.placeholder).filter(Boolean)
    vals.join(" | ")
  `)
  console.log("All input values:", headerCheck?.slice(0, 500))

  // If no Authorization header, find Add header button and add it
  if (!headerCheck?.toLowerCase().includes("authorization")) {
    const addBtn = await ev(`
      const btns = [...document.querySelectorAll("button,span,[class*=btn],[class*=add]")]
      const b = btns.find(el => /add.*header|header/i.test(el.textContent) && el.textContent.trim().length < 30)
      if(b) { b.click(); "clicked: " + b.textContent.trim() }
      else "not found, candidates: " + btns.slice(0,20).map(b=>b.textContent.trim().slice(0,25)).filter(Boolean).join(" | ")
    `)
    console.log("Add header btn:", addBtn)
    await sleep(600)

    // Fill in the new header row
    const headerInputs = await ev(`
      const inputs = [...document.querySelectorAll("input")]
      const empty = inputs.filter(i => !i.value && i.type==="text").slice(-4)
      empty.map(i=>i.placeholder||i.name||i.id||"?").join("|")
    `)
    console.log("Empty inputs after add:", headerInputs)

    // Click on what looks like the header name field
    await ev(`
      const inputs = [...document.querySelectorAll("input[type=text]")]
      const nameInp = inputs.filter(i => !i.value).slice(-2)[0]
      if(nameInp) nameInp.focus()
    `)
    await sleep(200)
    await send("Input.insertText", { text: "Authorization" })
    await sleep(100)

    // Tab to value
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
    await sleep(50)
    await send("Input.dispatchKeyEvent", { type: "keyUp",   key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
    await sleep(200)
    await send("Input.insertText", { text: `Bearer ${CRON_SECRET}` })
    await sleep(300)
  }

  // Save
  const saveRes = await ev(`
    const btn = [...document.querySelectorAll("button[type=submit],button")]
      .find(b => /save|update/i.test(b.textContent))
    if(btn) { btn.click(); btn.textContent.trim() }
    else "not found: " + [...document.querySelectorAll("button")].map(b=>b.textContent.trim()).join(" | ")
  `)
  console.log("Save:", saveRes)
  await sleep(4000)

  console.log("Final URL:", await ev("location.href"))
  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

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

  // We're on the jobs list. Find edit link for expire job.
  const editHref = await ev(`
    const rows = [...document.querySelectorAll("tr,li,[class*=row],[class*=job]")]
    const expireRow = rows.find(r => r.textContent?.includes("expire") || r.textContent?.includes("Expire"))
    const editLink = expireRow?.querySelector("a[href*=edit]") || expireRow?.querySelector("a")
    editLink?.href || "not found, rows count: " + rows.length
  `)
  console.log("Edit link:", editHref)

  if (editHref && editHref.startsWith("http")) {
    await send("Page.navigate", { url: editHref })
    await sleep(3000)
  } else {
    // Get all edit links and navigate to first one that matches
    const links = await ev(`[...document.querySelectorAll("a[href*=edit]")].map(a=>a.href).join("|")`)
    console.log("All edit links:", links)
    const firstExpireLink = links.split("|").find(l => l.includes("edit"))
    if (firstExpireLink) {
      await send("Page.navigate", { url: firstExpireLink })
      await sleep(3000)
    }
  }

  const currentUrl = await ev("location.href")
  console.log("Current URL:", currentUrl)

  // Click Advanced tab
  await ev(`[...document.querySelectorAll("button,a,[role=tab]")].find(el => /advanced/i.test(el.textContent))?.click()`)
  await sleep(800)

  // Check request type / set to POST
  const methodCheck = await ev(`
    const sel = document.querySelector("select")
    if(sel) {
      const current = sel.value
      if(current !== "POST") { sel.value = "POST"; sel.dispatchEvent(new Event("change",{bubbles:true})) }
      "select method: " + sel.value
    } else {
      const btns = [...document.querySelectorAll("button,label,[class*=btn]")]
      const postEl = btns.find(b => b.textContent.trim() === "POST")
      if(postEl) { postEl.click(); "clicked POST" }
      else "not found, btns: " + btns.slice(0,15).map(b=>b.textContent.trim().slice(0,12)).filter(Boolean).join("|")
    }
  `)
  console.log("Method:", methodCheck)
  await sleep(400)

  // Check if Authorization header already exists
  const existingHeaders = await ev(`
    const inputs = [...document.querySelectorAll("input[type=text],input:not([type=hidden]):not([type=checkbox]):not([type=radio])")]
    const authInp = inputs.find(i => i.value?.toLowerCase().includes("authorization") || i.placeholder?.toLowerCase().includes("header"))
    authInp ? "exists: " + authInp.value : "no auth header found. inputs: " + inputs.map(i=>i.value||i.placeholder||i.name).join("|")
  `)
  console.log("Existing headers:", existingHeaders)

  if (!existingHeaders.includes("authorization") && !existingHeaders.includes("Authorization")) {
    // Add header
    const addHdr = await ev(`
      const btns = [...document.querySelectorAll("button,span,div,[class*=btn]")]
      const addBtn = btns.find(b => /add.*header|request.*header/i.test(b.textContent) || b.textContent.trim().toLowerCase() === "add")
      if(addBtn) { addBtn.click(); "clicked:" + addBtn.textContent.trim() }
      else "not found, btns: " + btns.filter(b=>b.tagName==="BUTTON"||b.getAttribute("role")==="button").map(b=>b.textContent.trim().slice(0,20)).filter(Boolean).join("|")
    `)
    console.log("Add header:", addHdr)
    await sleep(500)

    // Fill header name
    await ev(`
      const inputs = [...document.querySelectorAll("input")]
      const empty = inputs.filter(i => !i.value && (i.type==="text" || !i.type)).slice(-3)[0]
      if(empty) { empty.focus(); empty.value = "" }
      empty ? "focused" : "not found"
    `)
    await sleep(200)
    await send("Input.insertText", { text: "Authorization" })
    await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
    await sleep(100)
    await send("Input.dispatchKeyEvent", { type: "keyUp",  key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
    await sleep(200)
    await send("Input.insertText", { text: `Bearer ${CRON_SECRET}` })
    await sleep(300)
    console.log("Header filled")
  }

  // Save
  const saveRes = await ev(`
    const btn = [...document.querySelectorAll("button[type=submit],button")]
      .find(b => /save|update|create/i.test(b.textContent))
    if(btn) { btn.click(); btn.textContent.trim() }
    else "not found: " + [...document.querySelectorAll("button")].map(b=>b.textContent.trim()).join("|")
  `)
  console.log("Save:", saveRes)
  await sleep(3000)

  console.log("Final URL:", await ev("location.href"))
  console.log("Done:", await ev("document.body.innerText.slice(0,300)"))

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

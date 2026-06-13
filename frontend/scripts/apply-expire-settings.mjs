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

  // Should be at edit page already
  console.log("At:", await ev("location.href"))

  // Click "Advanced" tab to show the method selector
  await ev(`[...document.querySelectorAll(".MuiButtonBase-root")].find(b => b.textContent.trim() === "Advanced")?.click()`)
  await sleep(800)

  // Step 1: Click the MUI Select that shows "GET" to open the dropdown
  const clickMethodSel = await ev(`
    const muiSels = [...document.querySelectorAll(".MuiSelect-root")]
    const getSel = muiSels.find(el => el.textContent.trim() === "GET")
    if(getSel) { getSel.click(); "clicked MUI select GET" }
    else "not found. sels: " + muiSels.map(s=>'"'+s.textContent.trim()+'"').join(",")
  `)
  console.log("Click method:", clickMethodSel)
  await sleep(800)

  // Step 2: Click "POST" in the opened MUI popover
  const clickPost = await ev(`
    const items = [...document.querySelectorAll("[role=option],[class*=MenuItem],li")]
    const postItem = items.find(el => el.textContent.trim() === "POST")
    if(postItem) { postItem.click(); "clicked POST menu item" }
    else {
      // Try all visible elements with "POST" text
      const all = [...document.querySelectorAll("*")]
      const postEl = all.find(el =>
        el.textContent.trim() === "POST" && el.childNodes.length <= 2 &&
        el.offsetParent !== null
      )
      if(postEl) { postEl.click(); "clicked POST element: " + postEl.tagName }
      else "POST not found. Items: " + items.map(i=>i.textContent.trim().slice(0,15)).join(",")
    }
  `)
  console.log("Select POST:", clickPost)
  await sleep(500)

  // Verify method changed
  const methodNow = await ev(`[...document.querySelectorAll(".MuiSelect-root")].find(el => ["GET","POST","PUT","PATCH","DELETE","HEAD"].includes(el.textContent.trim()))?.textContent.trim()`)
  console.log("Method now:", methodNow)

  // Step 3: Click "Add" button for headers (case-sensitive match)
  const clickAdd = await ev(`
    const btns = [...document.querySelectorAll(".MuiButtonBase-root")]
    const addBtn = btns.find(b => b.textContent.trim() === "Add")
    if(addBtn) { addBtn.click(); "clicked Add" }
    else "Add not found. Buttons: " + btns.map(b=>'"'+b.textContent.trim().slice(0,15)+'"').join(",")
  `)
  console.log("Add header:", clickAdd)
  await sleep(800)

  // Step 4: Count inputs before to know which are new
  const inputCount = await ev(`document.querySelectorAll("input[type=text]").length`)
  console.log("Text inputs count:", inputCount)

  // Find the last two empty text inputs (header name and value)
  const fillHeader = await ev(`
    const inputs = [...document.querySelectorAll("input[type=text]")]
    const empty = inputs.filter(i => !i.value || i.value === "")
    const nameInp = empty[empty.length - 2] || empty[empty.length - 1]
    if(nameInp) { nameInp.focus(); "focused header name, placeholder: " + nameInp.placeholder }
    else "no empty inputs found: " + inputs.map(i=>i.value||"empty").join(",")
  `)
  console.log("Header name focus:", fillHeader)
  await sleep(200)
  await send("Input.insertText", { text: "Authorization" })
  await sleep(100)

  // Tab to value field
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
  await sleep(80)
  await send("Input.dispatchKeyEvent", { type: "keyUp",   key: "Tab", code: "Tab", windowsVirtualKeyCode: 9 })
  await sleep(200)
  await send("Input.insertText", { text: `Bearer ${CRON_SECRET}` })
  await sleep(300)

  // Verify header was filled
  const headerCheck = await ev(`
    [...document.querySelectorAll("input[type=text]")]
      .map(i => i.value)
      .filter(v => v.toLowerCase().includes("auth") || v.includes("Bearer"))
      .join(" | ")
  `)
  console.log("Header values:", headerCheck)

  // Step 5: Save
  const saveRes = await ev(`
    const btn = [...document.querySelectorAll(".MuiButtonBase-root")]
      .find(b => b.textContent.trim() === "Save")
    if(btn) { btn.click(); "clicked Save" }
    else "Save not found"
  `)
  console.log("Save:", saveRes)
  await sleep(3000)

  console.log("Final URL:", await ev("location.href"))
  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

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

  // Should already be on the edit page — verify
  const url = await ev("location.href")
  console.log("Current URL:", url)
  if (!url?.includes("7808621")) {
    await send("Page.navigate", { url: "https://console.cron-job.org/jobs/7808621" })
    await sleep(5000)
  }

  // Dump all selects and their options
  const selects = await ev(`
    [...document.querySelectorAll("select")].map(s =>
      s.name + "/" + s.id + "/" + s.className.slice(0,20) + ": [" + [...s.options].map(o => o.value + "=" + o.text).join(",") + "]"
    ).join("\\n")
  `)
  console.log("Selects:", selects)

  // Dump all buttons with their text
  const buttons = await ev(`
    [...document.querySelectorAll("button")].map(b =>
      '"' + b.textContent.trim().slice(0,25) + '" class:' + b.className.slice(0,20)
    ).join("\\n")
  `)
  console.log("Buttons:", buttons)

  // Find method dropdown — might be a custom MUI/Material select
  const muiSelect = await ev(`
    const divs = [...document.querySelectorAll("div[class*=Select],div[class*=select],[role=combobox],[role=listbox],[aria-label*=method]")]
    divs.map(d => d.tagName + "/" + d.textContent.trim().slice(0,30) + "/" + d.className.slice(0,20)).join("\\n")
  `)
  console.log("MUI Selects:", muiSelect)

  // Try to click on "GET" text to open method dropdown
  const clickGET = await ev(`
    const all = [...document.querySelectorAll("*")]
    const getEl = all.find(el =>
      el.childNodes.length <= 3 &&
      el.textContent.trim() === "GET" &&
      (el.tagName === "SPAN" || el.tagName === "DIV" || el.tagName === "BUTTON")
    )
    if(getEl) { getEl.click(); "clicked GET: " + getEl.tagName + " " + getEl.className.slice(0,30) }
    else "GET element not found"
  `)
  console.log("Click GET:", clickGET)
  await sleep(800)

  // After clicking, look for POST option in dropdown
  const postOption = await ev(`
    const all = [...document.querySelectorAll("*")]
    const postEl = all.find(el =>
      el.textContent.trim() === "POST" &&
      el.childNodes.length <= 2
    )
    if(postEl) { postEl.click(); "clicked POST: " + postEl.tagName + " " + postEl.className.slice(0,30) }
    else {
      // Maybe it's a select now open
      const openSel = document.querySelector("select")
      if(openSel) { openSel.value = "POST"; openSel.dispatchEvent(new Event("change",{bubbles:true})); "select POST" }
      else "POST not found"
    }
  `)
  console.log("POST option:", postOption)
  await sleep(400)

  // Now click ADD button for headers
  const addHeader = await ev(`
    const btns = [...document.querySelectorAll("button")]
    const addBtn = btns.find(b => b.textContent.trim() === "ADD" || b.textContent.trim() === "Add")
    if(addBtn) { addBtn.click(); "clicked ADD: " + addBtn.textContent }
    else "ADD not found. Buttons: " + btns.map(b=>'"'+b.textContent.trim()+'"').join(",")
  `)
  console.log("Add header:", addHeader)
  await sleep(600)

  // Dump inputs after clicking ADD
  const inputsAfter = await ev(`
    [...document.querySelectorAll("input")].map(i =>
      i.type + "|" + i.name + "|" + (i.placeholder||"") + "|val:" + i.value
    ).join("\\n")
  `)
  console.log("Inputs after ADD:", inputsAfter?.slice(0, 1500))

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

const CDP_URL     = "http://localhost:9222"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const JOB_URL     = "https://smconfeccoes.vercel.app/api/orders/expire"
const JOB_ID      = 7808621

const CURL = `curl -s -X POST '${JOB_URL}' -H 'Authorization: Bearer ${CRON_SECRET}'`

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

  // Already on edit page — click "IMPORT FROM CURL"
  console.log("At:", await ev("location.href"))

  const importClick = await ev(`
    const btns = [...document.querySelectorAll("button")]
    const btn = btns.find(b => /import.*curl/i.test(b.textContent))
    if(btn) { btn.click(); btn.textContent.trim() } else "not found: " + btns.map(b=>b.textContent.trim()).join("|")
  `)
  console.log("Clicked:", importClick)
  await sleep(1500)

  // Dump all textareas and inputs to find the dialog
  const dialogInfo = await ev(`
    const tas = [...document.querySelectorAll("textarea")]
    const dialogs = [...document.querySelectorAll("[role=dialog],[class*=Dialog],[class*=dialog],[class*=Modal],[class*=modal]")]
    JSON.stringify({
      textareas: tas.map(ta => ({id:ta.id, name:ta.name, placeholder:ta.placeholder, cls:ta.className.slice(0,30), value:ta.value.slice(0,50)})),
      dialogs: dialogs.length,
    })
  `)
  console.log("Dialog info:", dialogInfo)

  // Focus the textarea in the dialog
  const focusResult = await ev(`
    const ta = document.querySelector("[role=dialog] textarea, [class*=Dialog] textarea, textarea")
    if(ta) {
      ta.focus()
      // Select all
      ta.setSelectionRange(0, ta.value.length)
      "found textarea, value was: " + ta.value.slice(0,50)
    } else "no textarea. DOM: " + document.body.innerHTML.slice(500,800)
  `)
  console.log("Textarea focus:", focusResult)
  await sleep(300)

  // Select all and clear
  await send("Input.dispatchKeyEvent", { type: "keyDown", key: "a", code: "KeyA", modifiers: 8, windowsVirtualKeyCode: 65 })
  await sleep(50)
  await send("Input.dispatchKeyEvent", { type: "keyUp",   key: "a", code: "KeyA", modifiers: 8, windowsVirtualKeyCode: 65 })
  await sleep(100)

  // Type the cURL command
  await send("Input.insertText", { text: CURL })
  await sleep(400)

  // Verify what's in the textarea
  const taValue = await ev(`document.querySelector("[role=dialog] textarea, textarea")?.value`)
  console.log("Textarea value:", taValue?.slice(0, 100))

  // Click Import button in the dialog
  const importBtn = await ev(`
    const dialogBtns = [...document.querySelectorAll("[role=dialog] button, [class*=Dialog] button")]
    const btn = dialogBtns.find(b => /import|ok|apply|confirm/i.test(b.textContent))
    if(btn) { btn.click(); btn.textContent.trim() }
    else {
      // Fallback: find any button with import text on the page
      const allBtns = [...document.querySelectorAll("button")]
      const b = allBtns.find(btn => /^import$/i.test(btn.textContent.trim()))
      if(b) { b.click(); "clicked Import: " + b.textContent }
      else "not found. dialog btns: " + dialogBtns.map(b=>b.textContent.trim()).join("|") + " | all: " + allBtns.map(b=>b.textContent.trim().slice(0,10)).join(",")
    }
  `)
  console.log("Import btn:", importBtn)
  await sleep(2000)

  // Check resulting URL field and method
  const afterImport = await ev(`
    const inputs = [...document.querySelectorAll("input")]
    const urlInp = inputs.find(i => i.value?.startsWith("http"))
    const methodSels = [...document.querySelectorAll(".MuiSelect-root,[class*=Select]")]
    const methodSel = methodSels.find(el => ["GET","POST","PUT","PATCH","DELETE"].includes(el.textContent.trim()))
    JSON.stringify({
      url: urlInp?.value,
      method: methodSel?.textContent.trim(),
      headers: [...document.querySelectorAll("input")].find(i => i.value?.toLowerCase().includes("auth"))?.value,
    })
  `)
  console.log("After import:", afterImport)

  // Click Advanced tab to check headers
  await ev(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Advanced")?.click()`)
  await sleep(800)

  const advancedState = await ev(`document.body.innerText.slice(0,1500)`)
  console.log("Advanced tab state:", advancedState?.slice(0, 500))

  // Save
  const saveRes = await ev(`
    const btn = [...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Save")
    if(btn) { btn.click(); "clicked Save" } else "Save not found"
  `)
  console.log("Save:", saveRes)
  await sleep(3000)

  console.log("Final URL:", await ev("location.href"))
  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

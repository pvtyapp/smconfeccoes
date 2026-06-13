const CDP_URL     = "http://localhost:9222"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const JOB_URL     = "https://smconfeccoes.vercel.app/api/orders/expire"

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

  console.log("At:", await ev("location.href"))

  // Click "Import from cURL"
  await ev(`[...document.querySelectorAll("button")].find(b=>/import.*curl/i.test(b.textContent))?.click()`)
  await sleep(1500)

  // Set value on the cURL textarea using React's native setter (bypasses synthetic event system)
  const setVal = await ev(`
    const tas = [...document.querySelectorAll("textarea")]
    // The cURL input is the one with the placeholder about POST example
    const ta = tas.find(t => t.placeholder?.includes("curl") || t.placeholder?.includes("POST")) || tas[tas.length - 2]
    if(!ta) return "no textarea. count: " + tas.length

    // React hack: use native setter to trigger React's onChange
    const nativeSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set
    nativeSetter.call(ta, ${JSON.stringify(CURL)})
    ta.dispatchEvent(new Event("input", { bubbles: true }))
    ta.dispatchEvent(new Event("change", { bubbles: true }))
    "set value, len=" + ta.value.length + ", val=" + ta.value.slice(0,60)
  `)
  console.log("Set cURL value:", setVal)
  await sleep(500)

  // Find and click the Import button inside the dialog
  const importBtn = await ev(`
    const allBtns = [...document.querySelectorAll("button")]
    // Look for Import button specifically (not "Import from cURL" which opens dialog)
    const btn = allBtns.find(b => {
      const txt = b.textContent.trim()
      return txt === "Import" || txt === "import" || (txt.toLowerCase().includes("import") && !txt.toLowerCase().includes("curl"))
    })
    if(btn) { btn.click(); "clicked: " + btn.textContent.trim() }
    else "not found. Buttons: " + allBtns.map(b=>'"'+b.textContent.trim().slice(0,20)+'"').join(",")
  `)
  console.log("Import button:", importBtn)
  await sleep(2000)

  // Check if method changed and URL is set
  const state = await ev(`
    const methodEl = [...document.querySelectorAll(".MuiSelect-root")].find(el =>
      ["GET","POST","PUT","PATCH","DELETE"].includes(el.textContent.trim())
    )
    const urlInput = [...document.querySelectorAll("input")].find(i => i.value?.startsWith("http"))
    JSON.stringify({ method: methodEl?.textContent.trim(), url: urlInput?.value })
  `)
  console.log("State after import:", state)

  // Click Advanced tab and check headers
  await ev(`[...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Advanced")?.click()`)
  await sleep(800)

  const advText = await ev("document.body.innerText")
  const hasPost = advText?.includes("POST")
  const hasAuth = advText?.includes("Authorization") || advText?.includes("Bearer")
  console.log("Has POST:", hasPost, "Has Auth:", hasAuth)

  // Save
  const saveRes = await ev(`
    const btn = [...document.querySelectorAll("button")].find(b=>b.textContent.trim()==="Save")
    if(btn) { btn.click(); "clicked Save" } else "Save not found"
  `)
  console.log("Save:", saveRes)
  await sleep(3000)

  console.log("Final URL:", await ev("location.href"))
  console.log("Final page:", await ev("document.body.innerText.slice(0,400)"))

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

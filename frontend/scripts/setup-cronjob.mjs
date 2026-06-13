/**
 * Cria cron job no cron-job.org via CDP
 * POST /api/marketing/execute a cada hora
 */

const CDP_URL     = "http://localhost:9222"
const JOB_URL     = "https://smconfeccoes.vercel.app/api/marketing/execute"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const CRON_EXPR   = "0 * * * *"   // every hour on the hour
const JOB_TITLE   = "SM - Marketing Execute (hourly)"

const CURL_CMD = `curl -X POST '${JOB_URL}' -H 'Authorization: Bearer ${CRON_SECRET}'`

async function getTab() {
  const list = await fetch(`${CDP_URL}/json`).then(r => r.json())
  return list.find(t => t.type === "page")
}

function makeCDP(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    let id = 1
    const pending = new Map()
    ws.addEventListener("open", () => {
      const send = (method, params = {}) => new Promise((res, rej) => {
        const mid = id++
        pending.set(mid, { res, rej })
        ws.send(JSON.stringify({ id: mid, method, params }))
      })
      ws.addEventListener("message", ({ data }) => {
        const msg = JSON.parse(data)
        if (msg.id && pending.has(msg.id)) {
          const { res, rej } = pending.get(msg.id)
          pending.delete(msg.id)
          msg.error ? rej(new Error(msg.error.message)) : res(msg.result)
        }
      })
      resolve({ send, ws })
    })
    ws.addEventListener("error", reject)
  })
}

const sleep = ms => new Promise(r => setTimeout(r, ms))

async function ev({ send }, expr) {
  const { result } = await send("Runtime.evaluate", { expression: expr, returnByValue: true })
  return result.value
}

async function setReactInput({ send }, selector, value) {
  await ev({ send }, `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, ${JSON.stringify(value)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })()
  `)
  await sleep(300)
}

async function setReactTextarea({ send }, selector, value) {
  await ev({ send }, `
    (function() {
      const el = document.querySelector(${JSON.stringify(selector)})
      if (!el) return
      el.focus()
      document.execCommand('selectAll')
      document.execCommand('insertText', false, ${JSON.stringify(value)})
    })()
  `)
  await sleep(300)
}

async function clickEl({ send }, selector) {
  await ev({ send }, `document.querySelector(${JSON.stringify(selector)})?.click()`)
  await sleep(500)
}

async function clickByText({ send }, tag, text) {
  await ev({ send }, `
    Array.from(document.querySelectorAll(${JSON.stringify(tag)}))
      .find(el => el.textContent?.trim() === ${JSON.stringify(text)})
      ?.click()
  `)
  await sleep(500)
}

async function screenshot({ send }, name) {
  const { data } = await send("Page.captureScreenshot", { format: "png" })
  const { writeFileSync } = await import("fs")
  const path = `D:/smconfeccoes/frontend/scripts/${name}.png`
  writeFileSync(path, Buffer.from(data, "base64"))
  console.log("  📸", path)
}

async function main() {
  const tab = await getTab()
  const { send, ws } = await makeCDP(tab.webSocketDebuggerUrl)
  await send("Page.enable")

  // ── 1. Navigate ──────────────────────────────────────────────────────────────
  console.log("1. Navegando para /jobs/create...")
  await send("Page.navigate", { url: "https://console.cron-job.org/jobs/create" })
  await sleep(3500)

  const url = await ev({ send }, "window.location.href")
  console.log("   URL:", url)

  if (!url.includes("create")) {
    console.log("   Não está na página de criação. Verifique login.")
    await screenshot({ send }, "err-not-create")
    ws.close(); return
  }

  await screenshot({ send }, "ss1-initial")

  // ── 2. Fill Title ────────────────────────────────────────────────────────────
  console.log("2. Preenchendo Title...")
  // First MuiInput text field = Title
  await ev({ send }, `
    (function() {
      const el = document.querySelectorAll('.MuiInputBase-input.MuiInput-input')[0]
      if (!el) return
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, ${JSON.stringify(JOB_TITLE)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
    })()
  `)
  await sleep(300)

  // ── 3. Import from cURL (sets URL + method + header atomically) ───────────────
  console.log("3. Usando 'Import from cURL'...")
  await clickByText({ send }, "button", "Import from cURL")
  await sleep(800)

  // Find the textarea in the dialog
  const dialogOpen = await ev({ send }, `!!document.querySelector('.MuiDialog-root, [role="dialog"]')`)
  console.log("   Dialog aberto:", dialogOpen)

  // Fill textarea via execCommand
  await ev({ send }, `
    (function() {
      const ta = document.querySelector('[role="dialog"] textarea, .MuiDialog-root textarea')
      if (!ta) return
      ta.focus()
      document.execCommand('selectAll')
      document.execCommand('insertText', false, ${JSON.stringify(CURL_CMD)})
    })()
  `)
  await sleep(400)

  await screenshot({ send }, "ss2-curl-dialog")

  // Click Import button inside dialog
  await ev({ send }, `
    Array.from(document.querySelectorAll('[role="dialog"] button, .MuiDialog-root button'))
      .find(b => b.textContent?.trim() === 'Import')
      ?.click()
  `)
  await sleep(1000)
  console.log("   Import clicado.")

  await screenshot({ send }, "ss3-after-import")

  // ── 4. Verify URL was set ────────────────────────────────────────────────────
  const urlFieldVal = await ev({ send }, `
    document.querySelectorAll('.MuiInputBase-input.MuiInput-input')[1]?.value
  `)
  console.log("4. URL no campo:", urlFieldVal)

  // ── 5. Set schedule to Custom ────────────────────────────────────────────────
  console.log("5. Selecionando 'Custom' no schedule...")
  // Find FormControlLabel containing "Custom"
  const customClicked = await ev({ send }, `
    (function() {
      const labels = Array.from(document.querySelectorAll('.MuiFormControlLabel-root'))
      const custom = labels.find(l => l.textContent?.trim() === 'Custom')
      if (!custom) return false
      custom.click()
      return true
    })()
  `)
  console.log("   Custom clicado:", customClicked)
  await sleep(600)

  await screenshot({ send }, "ss4-custom-selected")

  // ── 6. Fill crontab expression ───────────────────────────────────────────────
  console.log("6. Preenchendo crontab:", CRON_EXPR)
  const cronFilled = await ev({ send }, `
    (function() {
      const el = document.querySelector('.MuiInputBase-input.MuiOutlinedInput-input')
      if (!el) return false
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
      set.call(el, ${JSON.stringify(CRON_EXPR)})
      el.dispatchEvent(new Event('input', { bubbles: true }))
      el.dispatchEvent(new Event('change', { bubbles: true }))
      return true
    })()
  `)
  console.log("   Crontab preenchido:", cronFilled)
  await sleep(400)

  await screenshot({ send }, "ss5-crontab-filled")

  // ── 7. Create ────────────────────────────────────────────────────────────────
  console.log("7. Clicando 'Create'...")
  await clickByText({ send }, "button", "Create")
  await sleep(3000)

  const finalUrl = await ev({ send }, "window.location.href")
  console.log("   URL final:", finalUrl)

  await screenshot({ send }, "ss6-final")

  if (finalUrl.includes("/jobs/") && !finalUrl.includes("/create")) {
    console.log("\n✅ Cron job criado com sucesso!")
    console.log("   URL:", finalUrl)
  } else {
    console.log("\n⚠️  Pode ter dado problema — verifique o screenshot ss6-final.png")
  }

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

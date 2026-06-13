/**
 * Cria cron job no cron-job.org via CDP
 * POST /api/orders/expire a cada hora
 */

const CDP_URL     = "http://localhost:9222"
const JOB_URL     = "https://smconfeccoes.vercel.app/api/orders/expire"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const CRON_EXPR   = "0 * * * *"
const JOB_TITLE   = "SM - Orders Expire (hourly)"

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
          if (msg.error) rej(new Error(msg.error.message))
          else res(msg.result)
        }
      })
      ws.addEventListener("error", reject)
      resolve({ send, ws })
    })
    ws.addEventListener("error", reject)
  })
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

async function waitForNav({ send }) {
  return new Promise(res => {
    const handler = ({ data }) => {
      const msg = JSON.parse(data)
      if (msg.method === "Page.loadEventFired") res()
    }
    send.__ws?.addEventListener("message", handler)
    setTimeout(res, 8000)
  })
}

async function run() {
  const tab = await getTab()
  if (!tab) throw new Error("Nenhuma aba CDP aberta")
  console.log("Tab:", tab.title, tab.url)

  const { send, ws } = await makeCDP(tab.webSocketDebuggerUrl)
  send.__ws = ws

  await send("Page.enable")

  console.log("1. Navegando para /jobs/create...")
  await send("Page.navigate", { url: "https://console.cron-job.org/jobs/create" })
  await sleep(4000)

  // Title
  console.log("2. Preenchendo Title...")
  await send("Runtime.evaluate", {
    expression: `document.querySelector('input[placeholder*="title" i], input[name="title"], input[type="text"]')?.focus()`
  })
  await sleep(300)
  await send("Input.insertText", { text: JOB_TITLE })
  await sleep(200)

  // Import from cURL
  console.log("3. Usando 'Import from cURL'...")
  const importClick = await send("Runtime.evaluate", {
    expression: `
      const btns = [...document.querySelectorAll('button, a, span')]
      const btn = btns.find(el => el.textContent.toLowerCase().includes('curl'))
      if (btn) { btn.click(); true } else false
    `
  })
  console.log("   Dialog aberto:", importClick?.result?.value)
  await sleep(1500)

  // Fill cURL textarea
  console.log("4. Inserindo cURL no textarea...")
  const filled = await send("Runtime.evaluate", {
    expression: `
      const ta = document.querySelector('textarea, [role="textbox"]')
      if (ta) {
        ta.focus()
        document.execCommand('selectAll')
        document.execCommand('insertText', false, ${JSON.stringify(CURL_CMD)})
        true
      } else false
    `
  })
  console.log("   Filled:", filled?.result?.value)
  await sleep(500)

  // Click Import/OK button
  console.log("5. Confirmando import...")
  await send("Runtime.evaluate", {
    expression: `
      const btns = [...document.querySelectorAll('button')]
      const btn = btns.find(b => /import|ok|confirm|apply/i.test(b.textContent))
      if (btn) { btn.click(); btn.textContent } else 'not found'
    `
  })
  await sleep(1500)

  // Set schedule
  console.log("6. Definindo schedule...")
  await send("Runtime.evaluate", {
    expression: `
      const inputs = [...document.querySelectorAll('input')]
      const schedInput = inputs.find(i => i.value === '*/5 * * * *' || i.placeholder?.includes('cron') || i.name?.includes('expression') || i.name?.includes('cron'))
      if (schedInput) {
        schedInput.focus()
        schedInput.value = ''
        document.execCommand('selectAll')
        document.execCommand('insertText', false, '${CRON_EXPR}')
        schedInput.dispatchEvent(new Event('input', {bubbles:true}))
        schedInput.dispatchEvent(new Event('change', {bubbles:true}))
        schedInput.value
      } else 'not found'
    `
  })
  await sleep(500)

  // Save
  console.log("7. Salvando...")
  const saved = await send("Runtime.evaluate", {
    expression: `
      const btns = [...document.querySelectorAll('button[type="submit"], button')]
      const btn = btns.find(b => /save|create|add/i.test(b.textContent))
      if (btn) { btn.click(); btn.textContent } else 'not found'
    `
  })
  console.log("   Saved:", saved?.result?.value)
  await sleep(3000)

  console.log("✅ Done. URL:", await send("Runtime.evaluate", { expression: "location.href" }).then(r => r?.result?.value))
  ws.close()
}

run().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

const CDP_URL     = "http://localhost:9222"
const CRON_SECRET = "ba5bcb4036a7ab018fa734742269aaee16976d412b731ed1d40fcc3e2ff4f317"
const JOB_ID      = 7808621

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

  // Navigate to cron-job.org to get the auth token from localStorage/memory
  await send("Page.navigate", { url: "https://console.cron-job.org/jobs/7808621" })
  await sleep(4000)

  // Extract API token from browser storage
  const token = await ev(`
    // Try localStorage
    for(let i=0; i<localStorage.length; i++) {
      const key = localStorage.key(i)
      const val = localStorage.getItem(key)
      if(val && (val.includes("token") || val.includes("auth") || key.includes("token") || key.includes("auth"))) {
        return JSON.stringify({key, val: val.slice(0,100)})
      }
    }
    // Try all localStorage keys
    return JSON.stringify(Object.fromEntries(
      Array.from({length:localStorage.length}, (_,i) => [localStorage.key(i), localStorage.getItem(localStorage.key(i))?.slice(0,50)])
    ))
  `)
  console.log("LocalStorage:", token?.slice(0, 500))

  // Try to intercept the network — get job details via fetch executed in browser context
  const jobDetails = await ev(`
    fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
      headers: {
        "Content-Type": "application/json",
        // The auth token might be in sessionStorage or as a cookie
      },
      credentials: "include"
    }).then(r => r.text()).catch(e => "error: " + e.message)
  `)
  console.log("Job details via browser fetch:", jobDetails?.slice(0, 500))

  // Try PATCH to update the job
  const patchResult = await ev(`
    fetch("https://api.cron-job.org/jobs/${JOB_ID}", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({
        job: {
          requestMethod: 1,
          extendedData: {
            headers: { "Authorization": "Bearer ${CRON_SECRET}" }
          }
        }
      })
    }).then(r => r.text()).catch(e => "error: " + e.message)
  `)
  console.log("PATCH result:", patchResult?.slice(0, 500))

  ws.close()
}

main().catch(e => { console.error("ERRO:", e.message); process.exit(1) })

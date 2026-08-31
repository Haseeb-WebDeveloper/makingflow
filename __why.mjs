import postgres from "postgres"
import { createHash } from "node:crypto"
const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 })
try {
  const [s] = await sql`
    select value->'files'->0->>'url' as url from answers
    where type='file_upload' and value::text like '%res.cloudinary.com%' limit 1`
  const r = await fetch(s.url, { method: "HEAD" })
  console.log(`moved file serves -> ${r.status} ${r.headers.get("content-type")} ${r.headers.get("content-length")} bytes`)

  const rows = await sql`
    select a.value->'files' as files from answers a
    where a.type='file_upload' and a.value::text like '%storage.tally.so%' limit 3`
  console.log(`\nstragglers remaining: checking why 3 of them failed`)
  const cloud=process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, key=process.env.CLOUDINARY_API_KEY, secret=process.env.CLOUDINARY_API_SECRET
  for (const row of rows) {
    const f = row.files[0]
    const name = decodeURIComponent(new URL(f.url).pathname.split("/").pop())
    const src = await fetch(f.url, { method: "HEAD" })
    const ts = Math.floor(Date.now()/1000)
    const sig = createHash("sha1").update(`folder=makingflow/_probe&timestamp=${ts}${secret}`).digest("hex")
    const b = new FormData()
    b.append("file", f.url); b.append("folder","makingflow/_probe"); b.append("timestamp",String(ts))
    b.append("api_key",key); b.append("signature",sig)
    const up = await fetch(`https://api.cloudinary.com/v1_1/${cloud}/auto/upload`,{method:"POST",body:b})
    const txt = await up.text()
    console.log(`  ${name.slice(0,42).padEnd(44)} tally=${src.status} cloudinary=${up.status}`)
    if (!up.ok) console.log(`     -> ${txt.slice(0,180)}`)
    else {
      const d=JSON.parse(txt); const t2=Math.floor(Date.now()/1000)
      const s2=createHash("sha1").update(`public_id=${d.public_id}&timestamp=${t2}${secret}`).digest("hex")
      const db2=new FormData(); db2.append("public_id",d.public_id); db2.append("timestamp",String(t2)); db2.append("api_key",key); db2.append("signature",s2)
      await fetch(`https://api.cloudinary.com/v1_1/${cloud}/${d.resource_type}/destroy`,{method:"POST",body:db2})
    }
  }
} catch(e){console.log("ERROR:",e.message)} finally { await sql.end() }

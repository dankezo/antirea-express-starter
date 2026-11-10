"use strict";
// One identity paginates politely - and tries to take all 500 records.
// DEMO_PROTECTION=off: 10 requests, 500/500 records.
// Protection on: stops at 100 distinct records (20%) with a 429.
const BASE = process.env.BASE || "http://localhost:3000";
const USER = process.env.DEMO_USER || "demo-1";

async function main() {
  const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${BASE}/api/products?limit=50&page=${page}`, {
      headers: { "x-demo-user": USER },
    });
    const body = await res.json();
    if (res.status === 429) {
      console.log(`page ${page}: 429 ${body.error} - used ${body.usage.used}/${body.usage.limit}, remaining ${body.usage.remaining}`);
      break;
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    for (const r of body.records) seen.add(r.id);
    console.log(`page ${page}: +${body.records.length} records (total distinct ${seen.size}, usage ${body.usage.used}/${body.usage.limit})`);
    if (body.records.length === 0) break;
  }
  console.log(`done: identity ${USER} received ${seen.size} distinct records`);
}
main().catch((err) => { console.error(err); process.exit(1); });

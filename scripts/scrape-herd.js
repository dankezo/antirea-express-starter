"use strict";
// Five identities, each politely reading its OWN 100-record slice of
// the dataset (pages 1-2, 3-4, 5-6, 7-8, 9-10). Every identity stays
// inside its own 100-record budget, yet together they take all 500.
// The record budget cannot see this - the herd detector can. Watch
// the SERVER log for the "[herd] flag" line: advisory only, it names
// the coordination and blocks nothing.
const BASE = process.env.BASE || "http://localhost:3000";

async function drainSlice(user, firstPage) {
  const seen = new Set();
  for (let page = firstPage; page < firstPage + 2; page++) {
    const res = await fetch(`${BASE}/api/products?limit=50&page=${page}`, {
      headers: { "x-demo-user": user },
    });
    const body = await res.json();
    if (!res.ok) {
      console.log(`${user} page ${page}: HTTP ${res.status} ${body.error || ""}`.trim());
      break;
    }
    for (const r of body.records) seen.add(r.id);
    console.log(`${user} page ${page}: +${body.records.length} records (own total ${seen.size}, usage ${body.usage.used}/${body.usage.limit})`);
  }
  return seen;
}

async function main() {
  const union = new Set();
  for (let k = 1; k <= 5; k++) {
    const seen = await drainSlice(`herd-${k}`, 2 * k - 1);
    for (const id of seen) union.add(id);
  }
  console.log(`done: 5 identities together received ${union.size} distinct records, each within its own budget`);
  console.log("now check the server log for the [herd] flag line");
}
main().catch((err) => { console.error(err); process.exit(1); });

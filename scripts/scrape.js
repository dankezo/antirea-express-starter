"use strict";
// One identity paginates politely - and tries to take all 500 records.
// DEMO_PROTECTION=off: 10 requests, 500/500 records.
// Protection on: stops at 100 distinct records (20%) with a 429.
// Identity is the server-issued session cookie: the script first
// asks the server for a session, then presents that cookie. There
// is no header that names a user - the client cannot pick who it is.
const BASE = process.env.BASE || "http://localhost:3000";

async function getSessionCookie() {
  const res = await fetch(`${BASE}/api/usage`);
  const setCookie = res.headers.getSetCookie ? res.headers.getSetCookie() : [];
  const pair = setCookie.map((c) => c.split(";")[0]).find((c) => c.startsWith("antirea_session="));
  if (!pair) throw new Error("server did not issue a session cookie");
  return pair;
}

async function main() {
  const cookie = await getSessionCookie();
  const label = cookie.slice("antirea_session=".length, "antirea_session=".length + 8);
  const seen = new Set();
  for (let page = 1; page <= 20; page++) {
    const res = await fetch(`${BASE}/api/products?limit=50&page=${page}`, {
      headers: { Cookie: cookie },
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
  console.log(`done: session ${label}... received ${seen.size} distinct records`);
}
main().catch((err) => { console.error(err); process.exit(1); });

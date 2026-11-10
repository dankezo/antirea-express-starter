# RUN-LOG - antirea-express-starter prototype

Prototype built and run locally on 2026-11-10 (Node v24.22.1).
SDK under test: the published npm package @dannyphan190/anti-rea@2.8.1
(installed from npm, not a local build). Express ^4.21.2.
Nothing was published or pushed anywhere; all runs are localhost only.

Raw captures live in logs/: server-off.log, scrape-off.txt,
server-on.log, scrape-on.txt, curl-on.txt, server-herd.log,
scrape-herd.txt, server-polite.log, polite-control.txt.

## 0. API verification against the installed package (before writing code)

Read in node_modules/@dannyphan190/anti-rea/dist (types) and confirmed
at runtime with require():

- createExpressQuotaMiddleware, createRecordBudget, createHerdDetector,
  createExportGuard, createExpressExportGuardMiddleware: all exported
  functions in 2.8.1.
- Package facts: "type": "commonjs", main ./dist/index.js - require()
  works with no build step, as the design assumed.
- req.quotaPagination: confirmed as the field the Express quota
  middleware attaches (quota-guard.d.ts, QuotaExpressRequest), shape
  { page, pageSize, offset, clamped }.
- RecordBudget.consumeExported(identity, recordIds): present.
  Pricing states (record-budget.d.ts): viewed = 1, exported = 2, so an
  unseen exported record costs 2 and an already-viewed one costs 1 more.
- HerdEventType in 2.8.1: "signup" | "login" | "list" | "detail" |
  "export" | "page_view" - distinct "detail" and "export" types exist.
- HerdFlagSnapshot: members: string[] and band:
  "budget_cut_supported" | "graduated_only" - both as the skeleton
  claimed.
- createExpressExportGuardMiddleware options (export-guard.d.ts):
  maxRowsPerExport (required), requireFilterParams, estimateRows,
  extractRecordIds - exactly the set the design doc read from the
  2.8.0 dist types. The v1.1 export-guard upgrade is unblocked.
- Herd shipped defaults (herd-detector.d.ts): combinedCoverageFloor
  300, coverageRampDenominator 4000, defaultRecordCap 2000,
  flagMinMembers 3, flagThreshold 60, unionFloor 300,
  minOwnRecords 50. Weights: coverageRamp 0.25, tiling 0.2,
  contiguity 0.15, coActivity 0.1, capPressure 0.05 (cluster 0.25 is
  v1-only; v2 drops it without renormalizing).

Bugs/assumptions in the paper skeleton that the API check caught:

1. demoAccountId used req.headers.get("x-demo-user"). Express requests
   carry headers as a plain object with no .get method - that line
   throws at runtime. Fixed to read both shapes (Fetch-style .get when
   present, plain record otherwise).
2. The skeleton scaled only combinedCoverageFloor and defaultRecordCap
   for the herd. Two more defaults make a flag unreachable on 500
   records: coverageRampDenominator 4000 (coverage feature caps at
   500/4000 = 0.125) and unionFloor 300 (two members with disjoint
   100-record slices have pairwise union 200 < 300, so v2 linking
   never starts). Final scaled options used in src/antirea.js:
   combinedCoverageFloor 100, coverageRampDenominator 500,
   defaultRecordCap 100, unionFloor 100, plus a recordIndex parser so
   the contiguity feature is not stuck at 0.

## 1. Protection OFF - the dataset drains

Server: DEMO_PROTECTION=off PORT=3100 node src/server.js
Startup line: "antirea-express-starter on http://localhost:3100 (protection off)"

Command: BASE=http://localhost:3100 node scripts/scrape.js

```
page 1: +50 records (total distinct 50, usage 0/100)
page 2: +50 records (total distinct 100, usage 0/100)
page 3: +50 records (total distinct 150, usage 0/100)
page 4: +50 records (total distinct 200, usage 0/100)
page 5: +50 records (total distinct 250, usage 0/100)
page 6: +50 records (total distinct 300, usage 0/100)
page 7: +50 records (total distinct 350, usage 0/100)
page 8: +50 records (total distinct 400, usage 0/100)
page 9: +50 records (total distinct 450, usage 0/100)
page 10: +50 records (total distinct 500, usage 0/100)
page 11: +0 records (total distinct 500, usage 0/100)
done: identity demo-1 received 500 distinct records
```

500/500 records taken by one identity, nothing metered, nothing logged.
(The extra page-11 request just confirms the catalogue is exhausted;
the script stops on an empty page.)

## 2. Protection ON - the same script stops at exactly 20%

Server restarted fresh: DEMO_PROTECTION=on PORT=3100 node src/server.js
Command: BASE=http://localhost:3100 node scripts/scrape.js

```
page 1: +50 records (total distinct 50, usage 50/100)
page 2: +50 records (total distinct 100, usage 100/100)
page 3: 429 record_budget_exceeded - used 100/100, remaining 0
done: identity demo-1 received 100 distinct records
```

Exactly 100 distinct records (20% of 500), then a hard 429 with
usage { used: 100, limit: 100, remaining: 0 } - the design's
before/after table is now backed by a real run.

## 3. curl checks on the ON server (same server instance as section 2)

Normal reader (fresh identity reader-2):

- GET /api/products?limit=10&page=1 -> 10 records, usage used 10/100.
- GET /api/products/prod-0001 (already seen in the list) -> usage
  stays 10: re-reading a seen record costs 0 (distinct counting).
- GET /api/products/prod-0200 (new) -> usage 11: a new detail costs 1.

Cap nuance the paper design glossed over (VERIFIED behavior):

- demo-1, already at 100/100, re-requesting the ALREADY SEEN
  prod-0001 detail gets 429 record_budget_exceeded. The handler gates
  on budget.check(identity, 1) before it can know the id is already
  seen, and the budget API exposes no seen-check - so at the cap, even
  zero-cost re-reads are refused. Below the cap they are free (above).
  The starter README must state this honestly.

Export:

- Fresh identity exporter-2, GET /api/export (all 500 rows) ->
  HTTP 429 record_budget_exceeded, usage used 0/100.
- Fresh identity exporter-1, GET /api/export?category=gear ->
  200, 100 records served, usage afterwards used 200/100,
  remaining 0. The pre-check passes (100 rows fit the 100 budget) and
  consumeExported then prices each unseen record at 2, so the export
  lands at 200 units. That is the range-proven pattern behaving as
  documented in the SDK types; the starter README should describe the
  2x export pricing instead of implying 100 rows cost 100.

Second identity:

- demo-2 first page -> 50 records, usage 50/100. A fresh identity
  starts with a fresh budget: extraction is an identity problem,
  which is exactly what the herd demo then addresses.

No [herd] flag appeared in this server's log: demo-1, demo-2 and
reader-2 all read overlapping slices from one IP, so the tiling
feature stays low and nothing flags. Overlapping colleagues are not
a herd - good.

## 4. Herd run - 5 identities tile the dataset, the flag fires

Server restarted fresh (protection on).
Command: BASE=http://localhost:3100 node scripts/scrape-herd.js

```
herd-1 page 1: +50 records (own total 50, usage 50/100)
herd-1 page 2: +50 records (own total 100, usage 100/100)
herd-2 page 3: +50 records (own total 50, usage 50/100)
herd-2 page 4: +50 records (own total 100, usage 100/100)
herd-3 page 5: +50 records (own total 50, usage 50/100)
herd-3 page 6: +50 records (own total 100, usage 100/100)
herd-4 page 7: +50 records (own total 50, usage 50/100)
herd-4 page 8: +50 records (own total 100, usage 100/100)
herd-5 page 9: +50 records (own total 50, usage 50/100)
herd-5 page 10: +50 records (own total 100, usage 100/100)
done: 5 identities together received 500 distinct records, each within its own budget
```

Server log (logs/server-herd.log), the flag fired as herd-3's first
page landed (combined 250 = 100 + 100 + 50 at that moment):

```
[herd] flag band=budget_cut_supported members=["account:herd-2","account:herd-1","account:herd-3"] combined=250 score=60.83333333333333
```

Advisory only: every herd request was still served. The detector
named the coordination; nothing blocked.

## 5. Negative control - a single polite user never flags

Server restarted fresh (protection on). One identity polite-1 reads
page 1 and page 2 (100 records, reaching its own cap), then a detail.
Server log for the whole run: only the startup line - no [herd] flag,
no quota warnings. A lone identity forms a group of 1, below
flagMinMembers 3, and cannot flag. (Its follow-up detail request got
a 429 - the cap nuance from section 3, not a herd action.)

Demo page: GET / -> HTTP 200, title "antirea-express-starter - demo".

## 6. Deploy free terms (checked 2026-11-10, re-check at publish time)

- Render: the free web-service plan in render.yaml is still real -
  $0 Hobby workspace, 750 free instance hours per workspace per
  month, services spin down after 15 idle minutes and take about a
  minute to wake (Render docs/pricing as reported Nov 2026). The
  design's warning that in-memory budget state resets on spin-down
  stands.
- Railway: terms changed since the design was drafted. Current
  shape: a 30-day trial with $5 of credit, then a permanent Free
  plan with $1 of usage credit per month (1 project, up to
  1 vCPU / 0.5 GB RAM per service, no custom domains). "Deploy on
  the free allowance" wording remains accurate but the allowance is
  now very thin; Hobby is $5/month. Re-verify at publish time.
- StackBlitz: STILL UNVERIFIED. The "Open in StackBlitz" link points
  at the GitHub repo dankezo/antirea-express-starter, which does not
  exist yet (repo creation is Danny's later step), and exercising
  the StackBlitz runtime needs that repo plus a browser session.
  Keep StackBlitz as a code-reading link only until verified after
  the repo exists; do not advertise it as runnable.

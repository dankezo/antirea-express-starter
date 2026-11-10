# antirea-express-starter

A small Express app with [antiRea](https://github.com/dankezo/antiRea)
wired in: one identity can only ever receive 20% of the dataset.
Clone it, run it, watch a scrape hit the wall.

Build it. Ship it. Keep it yours.

## What this is

- A demo API over 500 fake product records (generated in code,
  no database, no seed files).
- antiRea's record budget meters how many distinct records each
  identity may receive in 24 hours. Here the cap is 100 records,
  which is 20% of the dataset.
- A herd detector watches for identities that split the dataset
  between them. It only flags - it never blocks. You decide.
- Plain JavaScript, no build step. Node 20+, Express 4,
  @dannyphan190/anti-rea 2.8.1 from npm.

## Quickstart

```
git clone https://github.com/dankezo/antirea-express-starter.git
cd antirea-express-starter
npm install
npm start
```

Open http://localhost:3000 and press the scrape button, or keep
everything in the terminal with the scripts below.

Identity for the demo comes from an `x-demo-user` header
(default `account:demo-1`). Every JSON response carries a `usage`
field, so the meter is always visible.

## The demo: protection off vs on

Scraping is paginated politely here - 50 records per page, no
tricks. The only thing that changes is whether the budget gate
is on. The switch is `DEMO_PROTECTION` and exists for teaching
only: never ship an off switch for your own metering in a real
app.

**Protection off** - one identity takes the whole dataset:

```
DEMO_PROTECTION=off npm start
npm run scrape
# page 1-10: +50 records each, usage stays 0/100
# done: identity demo-1 received 500 distinct records
```

500 of 500 records, gone. Nothing metered, nothing logged.

**Protection on** - the same script stops at exactly 20%:

```
npm start
npm run scrape
# page 1: +50 records (usage 50/100)
# page 2: +50 records (usage 100/100)
# page 3: 429 record_budget_exceeded, used 100/100, remaining 0
# done: identity demo-1 received 100 distinct records
```

## The herd demo

One budget per identity just moves the problem: split the work
across accounts. Five identities each take a clean 100-record
slice, each within its own budget, and together they receive
all 500 records.

```
npm run scrape:herd
```

Nothing is blocked, but watch the server log. The herd detector
flags the coordination and names the group:

```
[herd] flag band=budget_cut_supported
  members=["account:herd-2","account:herd-1","account:herd-3"]
  combined=250 score=60.83
```

A single polite user reading alone never flags - one identity
is a group of one, below the minimum group size of 3.

Full run evidence: [RUN-LOG.md](RUN-LOG.md) and the raw captures
in [logs/](logs/).

## Endpoints

| Route | What happens |
|---|---|
| `GET /api/products?limit=50&page=1` | Budget-checked list page |
| `GET /api/products/:id` | One record; re-reading a seen record costs 0 |
| `GET /api/export?category=gear` | Priced export (see limits) |
| `GET /api/usage` | Current budget state for the demo identity |
| `GET /` | Browser demo page |

## What is wired where

All antiRea wiring lives in `src/antirea.js`:

- `createExpressQuotaMiddleware` - request quota and bounded
  pagination on `/api/`.
- `createRecordBudget` - the 100-record cap per identity per 24 h.
- `createHerdDetector` - advisory coordination flags, log only.

The app itself is `src/server.js`; the 500 records come from
`src/data.js`.

## Honest limits

These came out of actually running this starter (RUN-LOG.md
section 3), not from the brochure:

- At the budget cap, even re-reading a record you already saw
  returns 429. The gate checks before serving and cannot know the
  record is free. Below the cap, re-reads cost 0 as expected.
- Exports are priced at 2 units per unseen record. A 100-row
  export of new records passes the pre-check, then lands at
  200 of 100 units used. Read `consumeExported` pricing before
  wiring exports in your own app.
- Identity must come from your server-side session in a real
  app. The `x-demo-user` header is a teaching shortcut - anyone
  can set a header.
- Budget state is in memory. It resets when the server restarts,
  and it is not shared between instances. A real deployment
  needs a shared store.
- Advisory signals do not block anyone by themselves, and
  budgets dilute if accounts are free to create. The SDK's
  [LIMITATIONS.md](https://github.com/dankezo/antiRea/blob/main/docs/LIMITATIONS.md)
  says the rest plainly.

## Deploy

`render.yaml` is a Render blueprint (free tier) - point Render
at this repo and it builds with `npm install` and starts with
`npm start`. On free tiers the service sleeps when idle, which
resets the in-memory budget state; fine for a demo.

## Next steps

This starter wires the basics on purpose. The SDK also ships
an export guard with row limits, canary traps, and Web Bot Auth
verification:

- SDK repo and docs: https://github.com/dankezo/antiRea
- npm: https://www.npmjs.com/package/@dannyphan190/anti-rea

## License

MIT, see [LICENSE](LICENSE).

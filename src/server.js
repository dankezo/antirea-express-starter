"use strict";
const path = require("node:path");
const express = require("express");
const { PRODUCTS, PRODUCT_BY_ID } = require("./data");
const { quotaMiddleware, budget, herd, identityOf } = require("./antirea");

const PORT = Number(process.env.PORT || 3000);
// Teaching switch for the before/after demo. DEMO ONLY - a real app
// must never ship an off switch for its own metering.
const PROTECTION_ON = process.env.DEMO_PROTECTION !== "off";
const BUDGET_LIMIT = 100; // mirrors maxDistinctPerWindow in antirea.js

const app = express();
app.use(express.json());
app.use("/api/", quotaMiddleware);
app.use(express.static(path.join(__dirname, "..", "public")));

// --- 1. List -------------------------------------------------------------
app.get("/api/products", (req, res) => {
  const identity = identityOf(req);
  // VERIFIED in the published 2.8.1 package: the quota middleware
  // attaches its normalized pagination parse as req.quotaPagination
  // (quota-guard.d.ts, QuotaExpressRequest) with fields
  // { page, pageSize, offset, clamped }. The raw-query fallback below
  // only runs if the middleware is ever removed.
  const pageSize = req.quotaPagination?.pageSize ?? Math.min(50, Math.max(1, Number(req.query.limit || 20)));
  const offset = req.quotaPagination?.offset ?? Math.max(0, (Number(req.query.page || 1) - 1) * pageSize);

  if (PROTECTION_ON) {
    const check = budget.check(identity, pageSize);
    if (!check.allowed) {
      return res.status(429).json({ error: "record_budget_exceeded", usage: check });
    }
  }
  const page = PRODUCTS.slice(offset, offset + pageSize);
  const ids = page.map((p) => p.id);
  if (PROTECTION_ON) {
    budget.consume(identity, ids);
    herd.observe({ type: "list", identity, ip: req.ip, recordIds: ids, budgetLimit: BUDGET_LIMIT });
  }
  return res.json({ records: page, usage: budget.check(identity) });
});

// --- 2. Detail -------------------------------------------------------------
app.get("/api/products/:id", (req, res) => {
  const identity = identityOf(req);
  const product = PRODUCT_BY_ID.get(req.params.id);
  if (!product) return res.status(404).json({ error: "not_found" });

  if (PROTECTION_ON) {
    const check = budget.check(identity, 1);
    if (!check.allowed) {
      return res.status(429).json({ error: "record_budget_exceeded", usage: check });
    }
    budget.consume(identity, [product.id]);
    // VERIFIED in 2.8.1: HerdEventType includes a distinct "detail"
    // type (herd-detector.d.ts), so detail reads observe as "detail",
    // not "list" as the paper skeleton had it.
    herd.observe({ type: "detail", identity, ip: req.ip, recordIds: [product.id], budgetLimit: BUDGET_LIMIT });
  }
  return res.json({ record: product, usage: budget.check(identity) });
});

// --- 3. Export -------------------------------------------------------------
app.get("/api/export", (req, res) => {
  const identity = identityOf(req);
  const category = req.query.category;
  const rows = category ? PRODUCTS.filter((p) => p.category === category) : PRODUCTS;

  if (PROTECTION_ON) {
    // Range-proven pattern: gate on the full row count, then price the
    // export through consumeExported (an unseen record costs 2, an
    // already-viewed record costs 1 more to reach state 2 - verified
    // in record-budget.d.ts, 2.8.1). The check is therefore
    // conservative for large unseen exports - acceptable, and stated
    // in the README.
    const check = budget.check(identity, rows.length);
    if (!check.allowed) {
      return res.status(429).json({ error: "record_budget_exceeded", usage: check });
    }
    budget.consumeExported(identity, rows.map((p) => p.id));
    // VERIFIED in 2.8.1: "export" is a valid HerdEventType.
    herd.observe({ type: "export", identity, ip: req.ip, recordIds: rows.map((p) => p.id), budgetLimit: BUDGET_LIMIT });
  }
  return res.json({ records: rows, usage: budget.check(identity) });
  // v1.1 upgrade path: replace this hand gate with the export guard.
  // VERIFIED in the published 2.8.1 package: createExportGuard and
  // createExpressExportGuardMiddleware both exist (export-guard.d.ts)
  // with options maxRowsPerExport (required), requireFilterParams,
  // estimateRows and extractRecordIds - exactly as the design doc's
  // 2.8.0 dist-type reading claimed. Promotion to v1.1 is unblocked.
});

// --- Supporting ------------------------------------------------------------
app.get("/api/usage", (req, res) => {
  res.json({ identity: identityOf(req), usage: budget.check(identityOf(req)) });
});

app.listen(PORT, () => {
  console.log(`antirea-express-starter on http://localhost:${PORT} (protection ${PROTECTION_ON ? "on" : "off"})`);
});

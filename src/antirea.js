"use strict";
/*
 * antiRea wiring - the whole integration lives in this one file.
 *
 * Modules used, all confirmed in the published @dannyphan190/anti-rea
 * 2.8.1 package (dist types + runtime check, 2026-11-10):
 * - createExpressQuotaMiddleware (quota-guard.d.ts)
 * - createRecordBudget           (record-budget.d.ts)
 * - createHerdDetector           (herd-detector.d.ts, advisory only)
 */
const {
  createExpressQuotaMiddleware,
  createRecordBudget,
  createHerdDetector,
} = require("@dannyphan190/anti-rea");

// DEMO ONLY identity: a real host resolves identity from its server
// session. The header exists so the scrape scripts can play different
// users.
//
// VERIFIED FIX vs the paper skeleton: the skeleton read the header via
// req.headers.get("x-demo-user"). Express requests carry headers as a
// plain object (no .get method) - that line would throw at runtime.
// The SDK's QuotaRequestLike accepts both shapes, so this reader
// handles both: Fetch-style .get() when present, plain record otherwise.
function demoAccountId(req) {
  const headers = req.headers || {};
  let value;
  if (typeof headers.get === "function") {
    value = headers.get("x-demo-user");
  } else {
    value = headers["x-demo-user"];
  }
  if (Array.isArray(value)) value = value[0];
  return value ? String(value) : "demo-1";
}

// P0: request quota + pagination bounds (tiers trimmed from README s.1).
const quotaMiddleware = createExpressQuotaMiddleware({
  tiers: {
    anonymous: { maxRequests: 30, windowMs: 60_000, maxPageSize: 25, maxPage: 5 },
    free: { maxRequests: 120, windowMs: 60_000, maxPageSize: 50, maxPage: 20 },
  },
  resolveIdentity: (req) => ({
    accountId: demoAccountId(req),
    tier: "free",
  }),
  onQuotaExceeded: (event) => {
    console.warn("[quota-exceeded]", event.kind, event.dimension, event.accountId || event.ip || "");
  },
});

// The meter: at most 100 DISTINCT records per identity per 24 h.
// 100 of 500 is the same 20% ceiling the SDK README reports for its
// 10,000-record test setup, scaled to this demo dataset.
const budget = createRecordBudget({
  maxDistinctPerWindow: 100,
  windowMs: 86_400_000,
});

// Advisory herd detection: observes the same serving events, logs a
// flag when a group of identities tiles the dataset, blocks nothing.
//
// VERIFIED SCALING (prototype run 2026-11-10, see RUN-LOG.md): the
// shipped defaults were fitted on a 10,000-record lab dataset
// (combinedCoverageFloor 300, coverageRampDenominator 4000,
// defaultRecordCap 2000, unionFloor 300). On 500 records two of the
// defaults make a flag mathematically unreachable:
// - coverageRampDenominator 4000 caps the coverage feature at
//   500/4000 = 0.125 even when the herd takes the whole dataset.
// - unionFloor 300 blocks v2 linking outright: two members holding
//   disjoint 100-record slices have a pairwise union of 200 < 300.
// Scaled values below are proportional to the 500-record dataset and
// the 100-record budget. recordIndex enables the contiguity feature
// (0 without it, per herd-detector.d.ts).
const herd = createHerdDetector({
  combinedCoverageFloor: 100,
  coverageRampDenominator: 500,
  defaultRecordCap: 100,
  unionFloor: 100,
  recordIndex: (recordId) => {
    const n = Number(String(recordId).slice(5)); // "prod-0123" -> 123
    return Number.isFinite(n) ? n : undefined;
  },
  onFlag: (snap) => {
    // snap.band is "budget_cut_supported" or "graduated_only" and
    // snap.members is the member identity list - both field names
    // verified in herd-detector.d.ts (HerdFlagSnapshot) in 2.8.1.
    // The starter only logs; a real host would feed the snapshot to
    // applyHerdLadder() or a step-up flow.
    console.warn(
      "[herd] flag band=%s members=%j combined=%d score=%s",
      snap.band,
      snap.members,
      snap.combinedCoverage,
      snap.score
    );
  },
});

// One identity string form everywhere ("account:<id>"), so budget,
// herd and ladder all agree - README sections 7 and 8.
function identityOf(req) {
  return `account:${demoAccountId(req)}`;
}

module.exports = { quotaMiddleware, budget, herd, identityOf };

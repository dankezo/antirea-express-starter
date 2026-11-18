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

// Identity: a SERVER-ISSUED session cookie, never a client-chosen
// header. History: this starter originally read identity from an
// `x-demo-user` request header so the scrape scripts could play
// different users. An external review (2026-11-18) demonstrated the
// obvious failure: that header plus someone else's token served the
// victim's records from a different IP, because the client picked
// the identity the token binds to. The library cannot fix a host
// that lets the client choose its identity, so the starter now does
// what a real host must: the server mints the session id, keeps it
// in an HttpOnly cookie, and identity is whatever the server
// issued. A real app resolves identity from its own login session
// exactly the same way; this demo session stands in for that.
const crypto = require("node:crypto");

const SESSION_COOKIE = "antirea_session";
// Demo store of server-issued ids. A real host checks its own
// session store; the point here is that only ids the server minted
// count as identity.
const issuedSessions = new Set();

function readCookie(req, name) {
  const header = req.headers && req.headers.cookie;
  if (typeof header !== "string") return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

function sessionAccountId(req) {
  if (req.demoSessionId) return req.demoSessionId;
  const presented = readCookie(req, SESSION_COOKIE);
  // A cookie value the client made up is not an identity: only a
  // server-issued id is honored, anything else is replaced.
  if (presented && issuedSessions.has(presented)) {
    req.demoSessionId = presented;
    return presented;
  }
  const id = crypto.randomBytes(18).toString("base64url");
  issuedSessions.add(id);
  req.demoSessionId = id;
  req.demoSessionFresh = true;
  return id;
}

function setSessionCookie(res, id) {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax`
  );
}

// Mount before the quota middleware: guarantees every request
// carries a server-issued session and sets the cookie when a new
// one was minted.
function sessionMiddleware(req, res, next) {
  sessionAccountId(req);
  if (req.demoSessionFresh) setSessionCookie(res, req.demoSessionId);
  next();
}

// Demo "switch user": the old session id is retired server-side and
// a fresh one is minted. The client asks; the server decides - the
// client never supplies the new id.
function resetSession(req, res) {
  if (req.demoSessionId) issuedSessions.delete(req.demoSessionId);
  delete req.demoSessionId;
  delete req.demoSessionFresh;
  const id = sessionAccountId(req);
  setSessionCookie(res, id);
  return id;
}

// P0: request quota + pagination bounds (tiers trimmed from README s.1).
const quotaMiddleware = createExpressQuotaMiddleware({
  tiers: {
    anonymous: { maxRequests: 30, windowMs: 60_000, maxPageSize: 25, maxPage: 5 },
    free: { maxRequests: 120, windowMs: 60_000, maxPageSize: 50, maxPage: 20 },
  },
  resolveIdentity: (req) => ({
    accountId: sessionAccountId(req),
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
  return `account:${sessionAccountId(req)}`;
}

module.exports = { quotaMiddleware, budget, herd, identityOf, sessionMiddleware, resetSession };

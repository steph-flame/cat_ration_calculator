// Property-based convergence fuzzer for the sync merge layer (mergeV2). Complements the
// deterministic fixtures in mergeData.test.js with randomized multi-replica scenarios, built
// from the REAL pure reducers (catStore.js's addCat/deleteCat/clearCatHistory/
// updateCatProfile) plus a faithful re-implementation of AppState.jsx's log add/remove
// stamping seams (makeLogView.add/remove aren't exported standalone, so they're mirrored here
// exactly — see addLogEntry/removeEntryAt below — driving the same weightKey/intakeKey
// tombstone identity mergeData.js itself uses).
//
// Timestamps are a single globally-monotonic synthetic clock (`tick`, threaded explicitly
// through every reducer's `now` param) rather than Date.now() — every stamped op across every
// replica gets a strictly distinct tick, so LWW is deterministic and "two edits really did
// race" is never conflated with "two edits happened to get the same wall-clock ms". Ties are
// tested separately and explicitly (see the dedicated tie-focused properties below), with
// content that actually differs, so they can't accidentally be vacuously true.
//
// Intentional asymmetries (see mergeData.js's file banner) are NOT asserted as symmetric here:
//  - activeCatId and litterRobot are kept-local by design — excluded from projectConvergent
//    and covered by their own "must NOT be symmetric" properties instead.
//  - a stateModAt/settingsModAt TIE keeps local (not incoming) — the big fuzzer structurally
//    can't produce a content-differing tie (ticks never repeat except at the shared, identical
//    baseline of "never touched"), so tie behavior gets its own dedicated property with
//    hand-picked equal timestamps and differing content.
//
// Ops fuzzed: addCat, rename (profile edit), addWeighIn, addMeal, removeEntry (weight or
// intake), deleteCat, clearCatHistory — the full op list called for in the review brief. Food
// library edits are deliberately NOT in the op vocabulary (out of scope here — see the report).

import { describe, it, expect } from "vitest";
import fc from "fast-check";
import { mergeV2, weightKey, intakeKey } from "./mergeData.js";
import { addCat, deleteCat, clearCatHistory, updateCatProfile, freshCatState } from "./catStore.js";
import { uid } from "./util.js";

/* ---------- harness: wrap a catStore-shaped replica as a full v2 snapshot ---------- */

const BASE_NOW = 1_700_000_000_000; // fixed epoch, far from any TOMBSTONE_TTL_MS boundary

const wrapV2 = (replica) => ({
  v: 2,
  activeCatId: replica.activeCatId,
  cats: replica.cats,
  library: [],
  fridgeDays: 3,
  skin: "original",
  unit: "kg",
  estimator: "v3",
  litterRobot: null,
  settingsModAt: 0,
  deletedCats: replica.deletedCats || {},
});

// Everything mergeV2 is supposed to make converge, deliberately EXCLUDING the two fields
// that are kept-local by design (activeCatId, litterRobot) — see file banner.
const projectConvergent = (v2) => ({
  cats: v2.cats,
  deletedCats: v2.deletedCats,
  library: v2.library,
  fridgeDays: v2.fridgeDays,
  skin: v2.skin,
  unit: v2.unit,
  estimator: v2.estimator,
  settingsModAt: v2.settingsModAt,
});

// Mirrors AppState.jsx's makeLogView.add, generalized to an arbitrary catId (the real one is
// scoped to the active cat only). Deliberately does NOT stamp stateModAt — see catStore.js's
// updateActiveCatState banner: logs are append-only/unioned, not part of the LWW bundle.
const addLogEntry = (state, catId, field, entry) => {
  const cat = state.cats[catId];
  if (!cat) return state;
  return { ...state, cats: { ...state.cats, [catId]: { ...cat, [field]: [...cat[field], { id: uid(), ...entry }] } } };
};

// Mirrors AppState.jsx's makeLogView.remove, generalized to an arbitrary catId: removes one
// entry and records a deletedEntries tombstone under its mergeData key.
const removeEntryAt = (state, catId, field, pick, now) => {
  const cat = state.cats[catId];
  const arr = cat?.[field] || [];
  if (!arr.length) return state;
  const i = pick % arr.length;
  const removed = arr[i];
  const keyFn = field === "weightLog" ? weightKey : intakeKey;
  const nextCat = {
    ...cat,
    [field]: arr.filter((_, j) => j !== i),
    deletedEntries: { ...(cat.deletedEntries || {}), [keyFn(removed)]: now },
  };
  return { ...state, cats: { ...state.cats, [catId]: nextCat } };
};

// IMPORTANT: freshCatState() mints random ids (via blankFood()) for its blank ration/start
// rows. Every replica must start from the SAME baseline object (structurally cloned, not
// independently re-generated) — otherwise two replicas that never touch a given cat at all
// would still disagree on that cat's ration/start row ids, which isn't a merge bug, it's a
// test harness bug (comparing two "identical" cats that were never actually identical).
const makeBaselineTemplate = () => ({
  activeCatId: "cat-A",
  cats: { "cat-A": freshCatState(), "cat-B": freshCatState() },
  deletedCats: {},
});
const baselineReplica = (() => {
  const template = makeBaselineTemplate();
  return () => structuredClone(template);
})();

function applyOp(state, op, now) {
  switch (op.type) {
    case "rename": return state.cats[op.cat] ? updateCatProfile(state, op.cat, { name: op.name }, now) : state;
    case "addWeighIn": return addLogEntry(state, op.cat, "weightLog", { date: op.date, kg: op.kg, method: "petScale", source: "manual" });
    case "addMeal": return addLogEntry(state, op.cat, "intakeLog", { date: op.date, kcal: op.kcal, grams: null, name: null });
    case "removeEntry": return removeEntryAt(state, op.cat, op.field, op.pick, now);
    case "deleteCat": return state.cats[op.cat] ? deleteCat(state, op.cat, now) : state;
    case "clearHistory": return state.cats[op.cat] ? clearCatHistory(state, op.cat, now) : state;
    case "addCat": return addCat(state);
    default: return state;
  }
}

/* ---------- arbitraries ---------- */

const catArb = fc.constantFrom("cat-A", "cat-B");
const dateArb = fc.constantFrom("2026-01-01", "2026-01-02", "2026-01-03");
const opArb = fc.oneof(
  fc.record({ type: fc.constant("rename"), cat: catArb, name: fc.string({ minLength: 0, maxLength: 8 }) }),
  fc.record({ type: fc.constant("addWeighIn"), cat: catArb, kg: fc.float({ min: 2, max: 10, noNaN: true }), date: dateArb }),
  fc.record({ type: fc.constant("addMeal"), cat: catArb, kcal: fc.integer({ min: 50, max: 400 }), date: dateArb }),
  fc.record({ type: fc.constant("removeEntry"), cat: catArb, field: fc.constantFrom("weightLog", "intakeLog"), pick: fc.nat({ max: 6 }) }),
  fc.record({ type: fc.constant("deleteCat"), cat: catArb }),
  fc.record({ type: fc.constant("clearHistory"), cat: catArb }),
  fc.record({ type: fc.constant("addCat") }),
);

const makeScenarioArb = (replicaCount) => fc.record({
  replicaCount: fc.constant(replicaCount),
  ops: fc.array(fc.record({ replica: fc.nat({ max: replicaCount - 1 }), op: opArb }), { minLength: 0, maxLength: 14 }),
});

// The main gating property below merges exactly 2 replicas ONCE (no chaining) — see the "KNOWN
// BUG" section further down for why 3-way CHAINED merges are excluded from the gate: a real,
// reproducible order-dependence bug (not one of the documented intentional asymmetries) means a
// 3-replica chain fuzz WILL find genuine failures, and per review instructions those are
// reported/xfail'd rather than silently designed around. A single 2-replica merge cannot hit
// that bug (there's no "intermediate, not-yet-final" step for data to be lost in) and still
// exercises every non-chained invariant at full strength.
const scenarioArb = makeScenarioArb(2);

// Each replica starts from an IDENTICAL baseline (two blank cats) and independently evolves
// per its slice of a single globally-ordered op list — so op N always gets tick N regardless
// of which replica it targets, modeling arbitrary real-world interleaving of edits across
// devices with synchronized-enough clocks that no two edits ever land on the exact same ms
// (that scenario is the dedicated tie property, not this one).
function runScenario({ replicaCount, ops }) {
  const replicas = Array.from({ length: replicaCount }, baselineReplica);
  let tick = 0;
  for (const { replica, op } of ops) {
    const r = replica % replicaCount;
    tick += 1;
    replicas[r] = applyOp(replicas[r], op, BASE_NOW + tick * 1000);
  }
  return replicas;
}

const mergeChain = (snaps, order, now) => order.slice(1).reduce((acc, idx) => mergeV2(acc, snaps[idx], now), snaps[order[0]]);

// Replica i's converged view: itself, folded with every OTHER replica's snapshot, in every
// order (there are only ever ≤2 others since replicaCount ≤ 3) — also directly asserts the
// two orders agree (order-independence of the fold), not just that every replica agrees.
function convergedFor(snaps, i, now) {
  const others = snaps.map((_, idx) => idx).filter((idx) => idx !== i);
  if (others.length <= 1) return mergeChain(snaps, [i, ...others], now);
  const [a, b] = others;
  const forward = mergeChain(snaps, [i, a, b], now);
  const backward = mergeChain(snaps, [i, b, a], now);
  expect(projectConvergent(forward)).toEqual(projectConvergent(backward));
  return forward;
}

/* ---------- the big one: multi-replica convergence over random op sequences ---------- */

describe("fuzz: multi-replica convergence over random op sequences", () => {
  it("converges across replicas/merge-orders, is idempotent, commutative on convergent data, loses no live write, keeps deletes stuck, and LWWs correctly", () => {
    fc.assert(
      fc.property(scenarioArb, (scenario) => {
        const replicas = runScenario(scenario);
        const now = BASE_NOW + (scenario.ops.length + 10) * 1000;
        const snaps = replicas.map(wrapV2);

        // CONVERGENCE: every replica's fully-merged view agrees on the data that should converge.
        const converged = snaps.map((_, i) => convergedFor(snaps, i, now));
        for (let i = 1; i < converged.length; i++) {
          expect(projectConvergent(converged[i])).toEqual(projectConvergent(converged[0]));
        }

        // COMMUTATIVITY (data only): mergeV2(a,b) vs mergeV2(b,a), every pair.
        for (let i = 0; i < snaps.length; i++) {
          for (let j = i + 1; j < snaps.length; j++) {
            const ab = mergeV2(snaps[i], snaps[j], now);
            const ba = mergeV2(snaps[j], snaps[i], now);
            expect(projectConvergent(ab)).toEqual(projectConvergent(ba));
          }
        }

        // IDEMPOTENCE: merging the same incoming snapshot in again changes nothing further.
        const once = mergeV2(snaps[0], snaps[1], now);
        const twice = mergeV2(once, snaps[1], now);
        expect(projectConvergent(twice)).toEqual(projectConvergent(once));

        const finalView = converged[0];

        // Per-cat: derive the CORRECT outcome directly from the raw replica states (not from
        // mergeV2 itself, which is the thing under test) and check the converged view against it.
        const allCatIds = new Set(replicas.flatMap((r) => Object.keys(r.cats)));
        for (const catId of allCatIds) {
          const withCat = replicas.filter((r) => r.cats[catId]);
          const maxStateModAt = withCat.length ? Math.max(...withCat.map((r) => r.cats[catId].stateModAt ?? 0)) : -Infinity;
          const maxDeleteTick = Math.max(-Infinity, ...replicas.map((r) => r.deletedCats?.[catId] ?? -Infinity));
          const shouldSurvive = maxStateModAt > maxDeleteTick;
          const survived = !!finalView.cats[catId];
          expect(survived).toBe(shouldSurvive);
          if (!survived) continue;

          // NO LOST WRITES: every entry any surviving replica still has locally must be present.
          for (const field of ["weightLog", "intakeLog"]) {
            const keyFn = field === "weightLog" ? weightKey : intakeKey;
            const survivorKeys = new Set(finalView.cats[catId][field].map(keyFn));
            for (const r of withCat) {
              for (const e of r.cats[catId][field]) expect(survivorKeys.has(keyFn(e))).toBe(true);
            }
          }

          // DELETES STICK: every tombstoned key (from any replica) stays gone.
          const tombstoned = new Set();
          for (const r of replicas) for (const k of Object.keys(r.cats[catId]?.deletedEntries || {})) tombstoned.add(k);
          for (const field of ["weightLog", "intakeLog"]) {
            const keyFn = field === "weightLog" ? weightKey : intakeKey;
            for (const e of finalView.cats[catId][field]) expect(tombstoned.has(keyFn(e))).toBe(false);
          }

          // LWW: the surviving bundle belongs to whichever replica achieved the max stateModAt.
          // (Ties only occur at maxStateModAt === 0 — "nobody ever touched the bundle" — where
          // every tied replica's bundle is still the identical, untouched freshCatState default.)
          const winner = withCat.find((r) => (r.cats[catId].stateModAt ?? 0) === maxStateModAt);
          expect(finalView.cats[catId].profile).toEqual(winner.cats[catId].profile);
          expect(finalView.cats[catId].ration).toEqual(winner.cats[catId].ration);
          expect(finalView.cats[catId].tr).toEqual(winner.cats[catId].tr);
          expect(finalView.cats[catId].expSettings).toEqual(winner.cats[catId].expSettings);
        }
      }),
      { numRuns: 500 },
    );
  });
});

/* ---------- dedicated properties for the intentional keep-local asymmetries ---------- */

describe("fuzz: keep-local fields are NOT falsely required to be symmetric", () => {
  it("activeCatId is always local's, never incoming's — merge is deliberately non-commutative here", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (a, b) => {
      const local = wrapV2({ ...baselineReplica(), activeCatId: a });
      const incoming = wrapV2({ ...baselineReplica(), activeCatId: b });
      expect(mergeV2(local, incoming).activeCatId).toBe(a);
    }));
  });

  it("litterRobot: local's non-null connection is never replaced by incoming's — the reverse (adopt when local has none) is the only asymmetric exception", () => {
    fc.assert(fc.property(fc.string(), fc.string(), (t1, t2) => {
      fc.pre(t1 !== t2);
      const conn = (t) => ({ refreshToken: t, robots: [], pets: [], petMap: {}, robotMap: {}, lastSyncTs: null, weightScale: null });
      const local = { ...wrapV2(baselineReplica()), litterRobot: conn(t1) };
      const incoming = { ...wrapV2(baselineReplica()), litterRobot: conn(t2) };
      expect(mergeV2(local, incoming).litterRobot).toEqual(conn(t1));
      expect(mergeV2(incoming, local).litterRobot).toEqual(conn(t2)); // swapping position swaps the winner — proves it's position-, not value-, based
    }));
  });
});

/* ---------- dedicated tie property (content differs, timestamps exactly equal) ---------- */

describe("fuzz: an exact stateModAt TIE keeps local — asymmetric by design, not value-based", () => {
  it("swapping which snapshot is 'local' swaps the winner, even though the timestamps are identical", () => {
    fc.assert(fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 1e9 }), (nameA, nameB, tie) => {
      fc.pre(nameA !== nameB);
      const mk = (name) => wrapV2({
        activeCatId: "cat-A",
        cats: { "cat-A": { ...freshCatState(), profile: { ...freshCatState().profile, name }, stateModAt: tie } },
        deletedCats: {},
      });
      const a = mk(nameA), b = mk(nameB);
      expect(mergeV2(a, b).cats["cat-A"].profile.name).toBe(nameA); // a is local: a wins
      expect(mergeV2(b, a).cats["cat-A"].profile.name).toBe(nameB); // b is local: b wins
    }));
  });
});

/* ---------- dedicated LWW property: the strictly-newer bundle wins regardless of position ---------- */

describe("fuzz: LWW (distinct timestamps) picks the strictly-newer bundle regardless of local/incoming position", () => {
  it("the winner is determined by the timestamp, not by which side is 'local' — LWW itself IS commutative", () => {
    fc.assert(fc.property(
      fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: 1, max: 1e9 }),
      (nameA, nameB, t1, t2) => {
        fc.pre(t1 !== t2 && nameA !== nameB);
        const mk = (name, t) => wrapV2({
          activeCatId: "cat-A",
          cats: { "cat-A": { ...freshCatState(), profile: { ...freshCatState().profile, name }, stateModAt: t } },
          deletedCats: {},
        });
        const a = mk(nameA, t1), b = mk(nameB, t2);
        const expected = t1 > t2 ? nameA : nameB;
        expect(mergeV2(a, b).cats["cat-A"].profile.name).toBe(expected);
        expect(mergeV2(b, a).cats["cat-A"].profile.name).toBe(expected);
      },
    ));
  });
});

/* ---------- dedicated recreate/edit-beats-delete property ---------- */

describe("fuzz: recreate/edit beats an older delete tombstone; a tombstone >= the survivor's stateModAt still wins", () => {
  it("survival is exactly `editAt > deleteAt` (strict), for any relative ordering", () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 1e9 }), fc.integer({ min: -20, max: 20 }), (deleteAt, delta) => {
      const editAt = deleteAt + delta;
      fc.pre(editAt >= 0);
      const local = wrapV2({ activeCatId: "cat-A", cats: { "cat-A": freshCatState() }, deletedCats: { "cat-B": deleteAt } });
      const incoming = wrapV2({
        activeCatId: "cat-A",
        cats: { "cat-A": freshCatState(), "cat-B": { ...freshCatState(), stateModAt: editAt } },
        deletedCats: {},
      });
      const merged = mergeV2(local, incoming, Math.max(deleteAt, editAt) + 1_000_000); // `now` far from any TTL edge
      expect(!!merged.cats["cat-B"]).toBe(editAt > deleteAt);
    }));
  });
});

/* ==========================================================================================
 * KNOWN BUG (found by this fuzzer, not fixed — left for design review; see the test report)
 * ==========================================================================================
 *
 * mergeV2 is NOT associative across ≥3 parties (equivalently: 2 devices that sync more than
 * once with a third device's data landing in between) when a single cat is simultaneously:
 *   (1) deleted on one replica,
 *   (2) revived by a bundle edit (profile/ration/tr/expSettings — anything that bumps
 *       stateModAt) on a second replica, timestamped AFTER the delete — so the cat SHOULD
 *       survive ("recreate/edit beats delete", see mergeData.js's file banner and the
 *       dedicated property above, which passes) — AND
 *   (3) given a LOG-ONLY edit (a weigh-in/meal add or remove — anything that does NOT bump
 *       stateModAt, by design; see catStore.js's updateActiveCatState banner) on a THIRD
 *       replica that never otherwise touches the bundle.
 *
 * Root cause: mergeCats() (mergeData.js) decides, independently at EACH pairwise merge call,
 * whether a cat's tombstone currently beats the stateModAt visible in just that call's two
 * inputs — and when it does, the losing side's ENTIRE per-cat object (bundle AND logs) is
 * dropped from the output, not merely hidden. A merge of (the deleter, the log-only replica)
 * ALONE cannot distinguish "this cat is really gone" from "revival evidence exists on a third
 * replica this merge hasn't seen yet" — dropping it is the only defensible call given those two
 * inputs alone, but it's DESTRUCTIVE: once folded together, the log-only replica's weigh-in is
 * gone for good, even though merging the SAME three snapshots in a different order (revival
 * folded in before the deleter) preserves it. Pure cat-level revive-vs-delete with NO log data
 * at stake (verified separately, not committed as a test — see the session's report) IS
 * order-independent; the bug is specifically the log/deletedEntries data riding along with a
 * provisionally-dropped cat.
 *
 * This is genuine data loss, not one of the documented intentional asymmetries (activeCatId /
 * litterRobot / exact-tie-keeps-local) — but the correct fix isn't a local one-liner: it needs
 * mergeCats to stop physically discarding a tombstoned cat's unioned data (bundle+logs) at
 * intermediate merges, deferring "is this cat currently visible" to every read site instead
 * (AppState.jsx's catsFromV2/catsSummary/activeCat lookup, all of which currently treat
 * *absence* from `cats` as the deletion signal) — which in turn raises a new question this
 * session isn't positioned to answer unilaterally: once a cat's tombstone itself ages out past
 * TOMBSTONE_TTL_MS (pruneTombstones), does its now-orphaned bundle+log data get GC'd too, and by
 * what rule? That's a design decision, not a bug fix, so this is intentionally left failing and
 * flagged for review rather than patched.
 *
 * `it.fails` keeps `npm test` green — a deliberately-expected failure, not a passing/weakened
 * assertion — without hiding the bug. If a future fix lands, this flips to fail-unexpectedly,
 * which is the signal to convert it to a normal `it` (and delete the second, broader canary).
 */

describe("KNOWN BUG: delete-vs-revive-vs-log-only-edit races across ≥3 replicas are not associative", () => {
  it.fails("a weigh-in added on a not-yet-tombstoned replica survives regardless of merge order (currently order-dependent — see comment above)", () => {
    // Exact minimal case (originally found by fast-check, shrunk from a random run; hand-built
    // here so this reproduction never depends on a seed):
    //   replica 1: deleteCat("cat-B")                    @ tick 1
    //   replica 0: rename("cat-B", "")                   @ tick 2  (bundle edit, newer than the delete)
    //   replica 2: addWeighIn("cat-B", kg: 2)             @ tick 3  (log-only, stateModAt untouched)
    const replicas = runScenario({
      replicaCount: 3,
      ops: [
        { replica: 1, op: { type: "deleteCat", cat: "cat-B" } },
        { replica: 0, op: { type: "rename", cat: "cat-B", name: "" } },
        { replica: 2, op: { type: "addWeighIn", cat: "cat-B", kg: 2, date: "2026-01-01" } },
      ],
    });
    const now = BASE_NOW + 1_000_000;
    const snaps = replicas.map(wrapV2);
    const deleterAndLogOnlyFirst = mergeChain(snaps, [1, 2, 0], now); // weigh-in is lost
    const reviverAndLogOnlyFirst = mergeChain(snaps, [0, 2, 1], now); // weigh-in survives
    expect(projectConvergent(deleterAndLogOnlyFirst)).toEqual(projectConvergent(reviverAndLogOnlyFirst));
  });

  // Broader canary, same op vocabulary as the main gating property but with chained 3-replica
  // merges enabled — characterizes the bug's shape rather than just the one hand-built case.
  // Also `it.fails`: expected to find SOME violation; if fast-check ever fails to find one
  // within numRuns, `it.fails` itself fails, which is a real signal worth investigating (either
  // the bug's been fixed, or this needs more runs).
  it.fails("multi-replica convergence still breaks somewhere under 3-way chained merges (canary)", () => {
    fc.assert(
      fc.property(makeScenarioArb(3), (scenario) => {
        const replicas = runScenario(scenario);
        const now = BASE_NOW + (scenario.ops.length + 10) * 1000;
        const snaps = replicas.map(wrapV2);
        const converged = snaps.map((_, i) => convergedFor(snaps, i, now));
        for (let i = 1; i < converged.length; i++) {
          expect(projectConvergent(converged[i])).toEqual(projectConvergent(converged[0]));
        }
      }),
      { numRuns: 300 },
    );
  });
});

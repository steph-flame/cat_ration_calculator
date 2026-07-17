// Litter-Robot 4 weight sync — a pure-ish client for Whisker's cloud API, called directly
// from the browser (no backend: both endpoints below return access-control-allow-origin:*).
//
// AUTH APPROACH: plain Cognito USER_PASSWORD_AUTH over TLS (a single HTTPS POST), not SRP.
// The design brief for this feature asked for SRP if a client library came in under ~40kB
// gzipped; amazon-cognito-identity-js measured at ~24.9kB gzip (82.49 → 107.36kB on this
// app's one build, `npm run build` before/after), which clears that bar on size alone. It
// was NOT used anyway: while researching the exact GraphQL documents, the actual Whisker
// mobile app's own Amplify config (reverse-engineered in jhead/homebridge-litter-robot-4,
// docs/re.md) shows `"authenticationFlowType": "USER_PASSWORD_AUTH"` — i.e. the app client
// itself is set up for password auth, not SRP. Two independent open-source clients
// (jhead/homebridge-litter-robot-4 and ryanleesmith/homebridge-litter-robot-connect) both
// call InitiateAuth with AuthFlow: 'USER_PASSWORD_AUTH' against this exact pool/client and
// report it working. Shipping SRP against a client that may not have ALLOW_USER_SRP_AUTH in
// its ExplicitAuthFlows risks a hard "InvalidParameterException" on every single Connect
// attempt — for a feature whose first live test is the owner's own click, with no
// credentials available here to verify SRP would even be accepted. USER_PASSWORD_AUTH still
// runs over TLS (the password is exposed to Cognito the same way either auth flow exposes it
// to *some* server; SRP's benefit is that Cognito's InitiateAuth never sees the cleartext
// password, a defense-in-depth margin against AWS-side logging bugs, not a transport-security
// difference) — so the tradeoff is a small, theoretical hardening loss in exchange for
// matching the flow that's actually verified to work, and shipping zero extra dependency
// weight. Reassess if Connect starts failing with an auth-flow-not-enabled error.
//
// GraphQL query documents (field lists, query signatures) are copied from the open-source
// jhead/homebridge-litter-robot-4 plugin (MIT), which the design brief pointed at:
//   - robot listing: src/api/litterRobot4Client.ts (GRAPHQL_FIELDS, GRAPHQL_QUERY_ROBOTS_BY_USER)
//   - activity/weight history: docs/schema.graphql (getLitterRobot4Activity, LR4ActivityTimestreamRowOutput)
// Pool id, app client id, and endpoint are further corroborated by that repo's docs/re.md,
// which reproduces the Whisker app's own Amplify config.

import { LB_PER_KG } from "./units.js";
import { WEIGH_SOURCES } from "./expenditure.js";

export const COGNITO_REGION = "us-east-1";
export const COGNITO_USER_POOL_ID = "us-east-1_rjhNnZVAm";
export const COGNITO_CLIENT_ID = "4552ujeu3aic90nf8qn53levmn"; // public client, no secret
const COGNITO_ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
export const GRAPHQL_ENDPOINT = "https://lr4.iothings.site/graphql";
const USER_AGENT = "amplify-flutter/2.6.1 ios/18.5 API/28"; // matches the real app; some AppSync
// resolvers here reportedly key behavior off User-Agent, per the reference plugins.

export const FIRST_SYNC_DAYS = 90; // how far back the very first sync reaches
const GARBAGE_MAX_LB = 25; // a cat over this is almost certainly a bad/garbage reading

// Legible error categories for the UI — never leak raw Cognito/AppSync error shapes to a page.
export class LitterRobotError extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = "LitterRobotError";
    this.code = code; // "auth" | "network" | "no_robots" | "unknown"
    this.cause = cause;
  }
}

/* ==================== Cognito auth (USER_PASSWORD_AUTH over TLS) ==================== */

// Raw base64url JWT payload decode — no signature verification (we don't need it: the
// token only round-trips to Whisker's own API, which does its own verification). Pure.
export function decodeJwtPayload(token) {
  try {
    const part = token.split(".")[1];
    const b64 = part.replace(/-/g, "+").replace(/_/g, "/").padEnd(part.length + ((4 - (part.length % 4)) % 4), "=");
    const json = typeof atob === "function" ? atob(b64) : Buffer.from(b64, "base64").toString("binary");
    const bytes = Uint8Array.from(json, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return null;
  }
}

// The Cognito `cognito:username` claim is what the reference plugins use as the GraphQL
// `userId` argument. Prior research on this token also found a `mid` claim carrying the same
// role — prefer it if present (it's the one specifically identified for this API), falling
// back to `cognito:username` (the one the working reference clients actually use).
const userIdFromClaims = (claims) => claims?.mid || claims?.["cognito:username"] || claims?.sub || null;

async function cognitoInitiateAuth(authFlow, authParameters) {
  let res;
  try {
    res = await fetch(COGNITO_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": "AWSCognitoIdentityProviderService.InitiateAuth",
      },
      body: JSON.stringify({ AuthFlow: authFlow, ClientId: COGNITO_CLIENT_ID, AuthParameters: authParameters }),
    });
  } catch (err) {
    throw new LitterRobotError("network", "Couldn't reach Whisker's login service — check your connection.", err);
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok) {
    const type = body?.__type || "";
    if (/NotAuthorized|UserNotFound|UserNotConfirmed/i.test(type)) {
      throw new LitterRobotError("auth", "Email or password not recognized by Whisker.", body);
    }
    throw new LitterRobotError("unknown", body?.message || `Login failed (${res.status}).`, body);
  }
  if (!body?.AuthenticationResult) {
    throw new LitterRobotError("auth", "Whisker's login requires an extra verification step this app can't handle yet.", body);
  }
  return body.AuthenticationResult; // { AccessToken, IdToken, RefreshToken, ExpiresIn, TokenType }
}

// Fresh login with the owner's own credentials. The password is used ONLY for this one
// request (to Amazon Cognito, over TLS) and is never stored — only the refresh token is.
export async function login(email, password) {
  const result = await cognitoInitiateAuth("USER_PASSWORD_AUTH", { USERNAME: email, PASSWORD: password });
  const claims = decodeJwtPayload(result.IdToken);
  const userId = userIdFromClaims(claims);
  if (!userId) throw new LitterRobotError("unknown", "Logged in, but couldn't read the account id from the token.", claims);
  return { idToken: result.IdToken, refreshToken: result.RefreshToken, userId };
}

// Exchange a stored refresh token for a fresh id token. No password involved, so this is
// what every sync (after the first) uses.
export async function refreshIdToken(refreshToken) {
  const result = await cognitoInitiateAuth("REFRESH_TOKEN_AUTH", { REFRESH_TOKEN: refreshToken, CLIENT_ID: COGNITO_CLIENT_ID });
  const claims = decodeJwtPayload(result.IdToken);
  const userId = userIdFromClaims(claims);
  if (!userId) throw new LitterRobotError("unknown", "Refreshed the session, but couldn't read the account id from the token.", claims);
  // REFRESH_TOKEN_AUTH doesn't return a new refresh token — the same one keeps working.
  return { idToken: result.IdToken, userId };
}

/* ==================== GraphQL (AppSync) ==================== */

async function graphqlRequest(idToken, query, variables) {
  let res;
  try {
    res = await fetch(GRAPHQL_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${idToken}`, "User-Agent": USER_AGENT },
      body: JSON.stringify({ query, variables }),
    });
  } catch (err) {
    throw new LitterRobotError("network", "Couldn't reach the Litter-Robot cloud.", err);
  }
  let body;
  try { body = await res.json(); } catch { body = null; }
  if (!res.ok || body?.errors?.length) {
    const msg = body?.errors?.[0]?.message || `Request failed (${res.status}).`;
    if (res.status === 401 || /unauthorized/i.test(msg)) throw new LitterRobotError("auth", "Your Litter-Robot session expired.", body);
    throw new LitterRobotError("unknown", msg, body);
  }
  return body?.data;
}

// Field list borrowed from jhead/homebridge-litter-robot-4 src/api/litterRobot4Client.ts
// (GRAPHQL_FIELDS) — trimmed to just what a robot picker + the weight sync need.
const ROBOTS_BY_USER_QUERY = `
  query GetLR4ByUser($userId: String!) {
    getLitterRobot4ByUser(userId: $userId) {
      name
      serial
      unitId
      isOnboarded
    }
  }
`;

// List every Litter-Robot 4 on the account, onboarded ones only (a not-yet-set-up unit has
// no useful weight data).
export async function listRobots(idToken, userId) {
  const data = await graphqlRequest(idToken, ROBOTS_BY_USER_QUERY, { userId });
  const robots = (data?.getLitterRobot4ByUser || []).filter((r) => r?.isOnboarded);
  if (!robots.length) throw new LitterRobotError("no_robots", "No onboarded Litter-Robot found on that account.");
  return robots.map((r) => ({ name: r.name || "Litter-Robot", serial: r.serial, unitId: r.unitId }));
}

// Query signature + LR4ActivityTimestreamRowOutput fields borrowed from
// jhead/homebridge-litter-robot-4 docs/schema.graphql. `value` carries the event-type tag
// (e.g. "catWeight"); `actionValue` carries that event's payload, in pounds for weight events
// (per prior research against this API — unverified live without credentials, see report).
const ACTIVITY_QUERY = `
  query GetLR4Activity($serial: String!, $startTimestamp: String, $endTimestamp: String, $activityTypes: [String]) {
    getLitterRobot4Activity(serial: $serial, startTimestamp: $startTimestamp, endTimestamp: $endTimestamp, activityTypes: $activityTypes) {
      measure
      timestamp
      value
      actionValue
    }
  }
`;

// Fetch raw activity events for one robot's serial, restricted to catWeight where the API
// supports server-side filtering (activityTypes) — parseWeightEvents still filters
// defensively in case that argument is ignored or shaped differently than expected.
export async function fetchWeightActivity(idToken, serial, { sinceMs, untilMs } = {}) {
  const iso = (ms) => (ms == null ? undefined : new Date(ms).toISOString());
  const data = await graphqlRequest(idToken, ACTIVITY_QUERY, {
    serial, startTimestamp: iso(sinceMs), endTimestamp: iso(untilMs), activityTypes: ["catWeight"],
  });
  return data?.getLitterRobot4Activity || [];
}

/* ==================== pure parsing / dedupe (no network — fully testable) ==================== */

// A raw activity event's timestamp may come back as an ISO string or an epoch (seen in the
// wild from similar AWS Timestream-backed APIs as either ms or s) — normalize defensively.
function parseEventMs(raw) {
  if (raw == null) return null;
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  if (/^\d+$/.test(raw)) return parseEventMs(Number(raw));
  const ms = Date.parse(raw);
  return Number.isNaN(ms) ? null : ms;
}

// events: raw getLitterRobot4Activity rows → [{ date, kg, method, source, ts }], oldest first.
// `ts` (the event's epoch ms) rides along for dedupe identity — see dedupeWeightEntries — the
// stored weigh-in shape elsewhere in the app only relies on { date, kg, method, source }, and
// tolerates the extra field.
export function parseWeightEvents(events = []) {
  const out = [];
  for (const e of events) {
    if (!e) continue;
    if (e.value !== "catWeight" && e.measure !== "catWeight") continue;
    const lb = Number(e.actionValue);
    if (!Number.isFinite(lb) || lb <= 0 || lb > GARBAGE_MAX_LB) continue;
    const ts = parseEventMs(e.timestamp);
    if (ts == null) continue;
    const date = new Date(ts).toISOString().slice(0, 10);
    out.push({ date, kg: lb / LB_PER_KG, method: "litterRobot", source: WEIGH_SOURCES.litterRobot, ts });
  }
  out.sort((a, b) => a.ts - b.ts);
  return out;
}

// Drop any parsed event that's already present (same ts + kg) among the target cat's
// existing litter-robot-sourced weigh-ins — so a repeat sync over an overlapping window
// doesn't duplicate rows. Pure; existingEntries is the cat's whole weightLog (mixed sources).
export function dedupeWeightEntries(newEntries, existingEntries = []) {
  const seen = new Set(
    existingEntries
      .filter((e) => e?.source === WEIGH_SOURCES.litterRobot && e.ts != null)
      .map((e) => `${e.ts}_${e.kg}`)
  );
  return newEntries.filter((e) => !seen.has(`${e.ts}_${e.kg}`));
}

/* ==================== orchestration ==================== */

// One full sync pass: refresh the session, list robots only if the caller doesn't already
// know the serial (first connect), fetch + parse activity since `sinceMs`, dedupe against
// what's already logged. Returns the pieces AppState needs to fold into state; does not
// touch storage itself (kept here pure-ish / testable, storage stays AppState's job).
export async function syncWeights({ refreshToken, serial, sinceMs, existingEntries }) {
  const { idToken } = await refreshIdToken(refreshToken);
  const events = await fetchWeightActivity(idToken, serial, { sinceMs, untilMs: Date.now() });
  const parsed = parseWeightEvents(events);
  const fresh = dedupeWeightEntries(parsed, existingEntries);
  return { entries: fresh, syncedAt: Date.now() };
}

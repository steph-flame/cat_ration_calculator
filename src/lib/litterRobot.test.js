import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LB_PER_KG } from "./units.js";
import { WEIGH_SOURCES } from "./expenditure.js";
import {
  parseWeightEvents, dedupeWeightEntries, decodeJwtPayload,
  login, refreshIdToken, listRobots, fetchWeightActivity,
  COGNITO_CLIENT_ID, GRAPHQL_ENDPOINT, LitterRobotError,
} from "./litterRobot.js";

// NOTE: no live credentials here — this file mocks fetch and only exercises pure logic and
// request-shaping. The first real authenticated round trip happens when the app's owner
// clicks Connect; see the report for what stays unverified until then.

const catWeightEvent = (lb, iso) => ({ measure: "activity", value: "catWeight", actionValue: String(lb), timestamp: iso });

describe("parseWeightEvents", () => {
  it("converts lbs to kg and tags method/source", () => {
    const [e] = parseWeightEvents([catWeightEvent(10, "2026-01-01T12:00:00Z")]);
    expect(e.kg).toBeCloseTo(10 / LB_PER_KG, 6);
    expect(e.date).toBe("2026-01-01");
    expect(e.method).toBe("litterRobot");
    expect(e.source).toBe(WEIGH_SOURCES.litterRobot);
    expect(typeof e.ts).toBe("number");
  });

  it("ignores non-catWeight events", () => {
    const events = [
      { measure: "activity", value: "cyclesComplete", actionValue: "1", timestamp: "2026-01-01T00:00:00Z" },
      catWeightEvent(9, "2026-01-01T01:00:00Z"),
    ];
    expect(parseWeightEvents(events)).toHaveLength(1);
  });

  it("filters non-positive and garbage-large readings", () => {
    const events = [
      catWeightEvent(0, "2026-01-01T00:00:00Z"),
      catWeightEvent(-3, "2026-01-01T01:00:00Z"),
      catWeightEvent(30, "2026-01-01T02:00:00Z"), // > 25 lb garbage ceiling
      catWeightEvent(9.4, "2026-01-01T03:00:00Z"),
    ];
    const out = parseWeightEvents(events);
    expect(out).toHaveLength(1);
    expect(out[0].kg).toBeCloseTo(9.4 / LB_PER_KG, 6);
  });

  it("drops events with unparseable timestamps or actionValue", () => {
    const events = [
      catWeightEvent(9, "not-a-date"),
      { measure: "activity", value: "catWeight", actionValue: "not-a-number", timestamp: "2026-01-01T00:00:00Z" },
    ];
    expect(parseWeightEvents(events)).toHaveLength(0);
  });

  it("preserves multiple readings on the same day", () => {
    const events = [
      catWeightEvent(9.1, "2026-02-01T08:00:00Z"),
      catWeightEvent(9.3, "2026-02-01T20:00:00Z"),
    ];
    const out = parseWeightEvents(events);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.date === "2026-02-01")).toBe(true);
  });

  it("orders output oldest-first regardless of input order", () => {
    const events = [
      catWeightEvent(9, "2026-01-03T00:00:00Z"),
      catWeightEvent(9, "2026-01-01T00:00:00Z"),
      catWeightEvent(9, "2026-01-02T00:00:00Z"),
    ];
    const out = parseWeightEvents(events);
    expect(out.map((e) => e.date)).toEqual(["2026-01-01", "2026-01-02", "2026-01-03"]);
  });

  it("accepts epoch-seconds and epoch-ms timestamps", () => {
    const seconds = Math.floor(Date.parse("2026-03-01T00:00:00Z") / 1000);
    const ms = Date.parse("2026-03-02T00:00:00Z");
    const out = parseWeightEvents([
      { measure: "activity", value: "catWeight", actionValue: "9", timestamp: seconds },
      { measure: "activity", value: "catWeight", actionValue: "9", timestamp: ms },
    ]);
    expect(out.map((e) => e.date)).toEqual(["2026-03-01", "2026-03-02"]);
  });
});

describe("dedupeWeightEntries", () => {
  it("drops entries already present (same ts + kg) among litter-robot-sourced existing entries", () => {
    const parsed = parseWeightEvents([catWeightEvent(9, "2026-01-01T00:00:00Z"), catWeightEvent(9.2, "2026-01-02T00:00:00Z")]);
    const existing = [{ date: parsed[0].date, kg: parsed[0].kg, method: "litterRobot", source: "litter-robot", ts: parsed[0].ts }];
    const fresh = dedupeWeightEntries(parsed, existing);
    expect(fresh).toHaveLength(1);
    expect(fresh[0].ts).toBe(parsed[1].ts);
  });

  it("ignores manual entries when computing dedupe (no ts, different source)", () => {
    const parsed = parseWeightEvents([catWeightEvent(9, "2026-01-01T00:00:00Z")]);
    const existing = [{ date: "2026-01-01", kg: parsed[0].kg, method: "petScale", source: "manual" }];
    expect(dedupeWeightEntries(parsed, existing)).toHaveLength(1); // not deduped — different source
  });

  it("is a no-op against an empty existing log", () => {
    const parsed = parseWeightEvents([catWeightEvent(9, "2026-01-01T00:00:00Z")]);
    expect(dedupeWeightEntries(parsed, [])).toHaveLength(1);
    expect(dedupeWeightEntries(parsed, undefined)).toHaveLength(1);
  });
});

describe("decodeJwtPayload", () => {
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  it("decodes a well-formed JWT payload", () => {
    const payload = { mid: "abc123", exp: 1234 };
    const token = `${b64url({ alg: "none" })}.${b64url(payload)}.sig`;
    expect(decodeJwtPayload(token)).toEqual(payload);
  });
  it("returns null for garbage input", () => {
    expect(decodeJwtPayload("not-a-jwt")).toBeNull();
    expect(decodeJwtPayload("")).toBeNull();
  });
});

/* ---------- request-shaping (mocked fetch — no live credentials) ---------- */
describe("network request shaping (mocked)", () => {
  let fetchMock;
  beforeEach(() => { fetchMock = vi.fn(); global.fetch = fetchMock; });
  afterEach(() => { vi.restoreAllMocks(); });

  const okJson = (body) => ({ ok: true, status: 200, json: async () => body });
  const b64url = (obj) => Buffer.from(JSON.stringify(obj)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const fakeIdToken = (claims) => `${b64url({ alg: "none" })}.${b64url(claims)}.sig`;

  it("login() POSTs USER_PASSWORD_AUTH to the Cognito IDP endpoint with the public client id", async () => {
    const idToken = fakeIdToken({ mid: "user-1" });
    fetchMock.mockResolvedValueOnce(okJson({ AuthenticationResult: { IdToken: idToken, RefreshToken: "rt-1", AccessToken: "at-1" } }));
    const { idToken: got, refreshToken, userId } = await login("a@b.com", "hunter2");
    expect(got).toBe(idToken);
    expect(refreshToken).toBe("rt-1");
    expect(userId).toBe("user-1");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    expect(opts.headers["X-Amz-Target"]).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(opts.headers["Content-Type"]).toBe("application/x-amz-json-1.1");
    const body = JSON.parse(opts.body);
    expect(body.AuthFlow).toBe("USER_PASSWORD_AUTH");
    expect(body.ClientId).toBe(COGNITO_CLIENT_ID);
    expect(body.AuthParameters).toEqual({ USERNAME: "a@b.com", PASSWORD: "hunter2" });
  });

  it("login() surfaces a bad password as an 'auth'-coded error, never the raw Cognito shape", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({ __type: "NotAuthorizedException", message: "Incorrect username or password." }) });
    await expect(login("a@b.com", "wrong")).rejects.toMatchObject({ code: "auth" });
  });

  it("login() surfaces a fetch failure as a 'network'-coded error", async () => {
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));
    await expect(login("a@b.com", "x")).rejects.toBeInstanceOf(LitterRobotError);
    await expect(login("a@b.com", "x")).rejects.toMatchObject({ code: "network" });
  });

  it("refreshIdToken() uses REFRESH_TOKEN_AUTH and never sends a password", async () => {
    const idToken = fakeIdToken({ mid: "user-1" });
    fetchMock.mockResolvedValueOnce(okJson({ AuthenticationResult: { IdToken: idToken, AccessToken: "at" } }));
    await refreshIdToken("rt-stored");
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.AuthFlow).toBe("REFRESH_TOKEN_AUTH");
    expect(body.AuthParameters).toEqual({ REFRESH_TOKEN: "rt-stored", CLIENT_ID: COGNITO_CLIENT_ID });
    expect(JSON.stringify(body)).not.toMatch(/PASSWORD/i);
  });

  it("listRobots() POSTs to the GraphQL endpoint with a Bearer token and returns onboarded robots", async () => {
    fetchMock.mockResolvedValueOnce(okJson({
      data: { getLitterRobot4ByUser: [
        { name: "LR4", serial: "LR4-123", unitId: "u1", isOnboarded: true },
        { name: "Not set up", serial: "LR4-999", unitId: "u2", isOnboarded: false },
      ] },
    }));
    const robots = await listRobots("id-token", "user-1");
    expect(robots).toEqual([{ name: "LR4", serial: "LR4-123", unitId: "u1" }]);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe(GRAPHQL_ENDPOINT);
    expect(opts.headers.Authorization).toBe("Bearer id-token");
    const body = JSON.parse(opts.body);
    expect(body.query).toMatch(/getLitterRobot4ByUser/);
    expect(body.variables).toEqual({ userId: "user-1" });
  });

  it("listRobots() throws a 'no_robots'-coded error when nothing is onboarded", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: { getLitterRobot4ByUser: [] } }));
    await expect(listRobots("id-token", "user-1")).rejects.toMatchObject({ code: "no_robots" });
  });

  it("fetchWeightActivity() sends the serial, ISO time window, and activityTypes filter", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ data: { getLitterRobot4Activity: [] } }));
    const sinceMs = Date.parse("2026-01-01T00:00:00Z");
    const untilMs = Date.parse("2026-02-01T00:00:00Z");
    await fetchWeightActivity("id-token", "LR4-123", { sinceMs, untilMs });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toMatch(/getLitterRobot4Activity/);
    expect(body.variables).toEqual({
      serial: "LR4-123",
      startTimestamp: new Date(sinceMs).toISOString(),
      endTimestamp: new Date(untilMs).toISOString(),
      activityTypes: ["catWeight"],
    });
  });

  it("fetchWeightActivity() surfaces a 401 as an 'auth'-coded error", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 401, json: async () => ({ errors: [{ message: "Unauthorized" }] }) });
    await expect(fetchWeightActivity("stale-token", "LR4-123", {})).rejects.toMatchObject({ code: "auth" });
  });
});

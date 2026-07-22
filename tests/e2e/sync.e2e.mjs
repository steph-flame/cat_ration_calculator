// Two-device UI journey for the sync merge feature, driven against a REAL built app in the
// system Chrome via puppeteer-core (no bundled-browser download — see package.json's
// test:e2e script). Deliberately NOT part of `npm test` (the deploy gate): it's slower and
// touches a real browser + a real preview server + a real file download/upload, so it's its
// own `npm run test:e2e` script instead. Meant to be run locally and read, not on every push.
//
// What it proves, end to end, through the ACTUAL UI (not the pure reducers/mergeData directly
// — see mergeData.test.js/mergeData.fuzz.test.js for that, and AppState.integration.test.jsx
// for the hook-level seam — this is the outermost layer: real clicks, real typing, a real file
// download, a real file upload, two REALLY isolated browser contexts = two devices, separate
// localStorage partitions):
//   1. Device A: add a cat, name it, log two weigh-ins. Export (real download).
//   2. Device B: add its OWN differently-named cat. Import A's file (real upload + the app's
//      real "this will ADD, not replace" confirm dialog). Assert B now shows BOTH cats and
//      both of A's weigh-ins.
//   3. Device B renames the shared cat. Export B.
//   4. Device A deletes one of its two weigh-ins, then imports B's export. Assert A picks up
//      B's rename (LWW — B's edit is newer). Export A.
//   5. Device B imports A's export. Assert the weigh-in deleted on A does NOT resurrect on B
//      (tombstone propagation), while the other weigh-in (never deleted) is still there.
//
// Run: `npm run test:e2e` — builds first, starts/stops its own scratch preview server, closes
// its own browser, leaves nothing running behind, and never touches the owner's pre-existing
// dev server on :5173.

import puppeteer from "puppeteer-core";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const CHROME_PATH = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PORT = 4173; // vite preview's own default — a scratch port, distinct from the owner's :5173 dev server
const BASE_URL = `http://localhost:${PORT}/`;
const ROOT = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function assert(cond, msg) {
  if (!cond) throw new Error(`ASSERTION FAILED: ${msg}`);
}

async function waitForServer(url, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch { /* not up yet */ }
    await sleep(200);
  }
  throw new Error(`preview server never came up at ${url}`);
}

/* ---------- page-level helpers (real DOM interaction, no shortcuts) ---------- */

const goto = (page, hash) => page.evaluate((h) => { window.location.hash = h; }, hash);

async function addCat(page) {
  await goto(page, "#/cats");
  await sleep(150);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "add a cat");
    if (!btn) throw new Error('"add a cat" button not found');
    btn.click();
  });
  await sleep(150);
}

async function setActiveCatName(page, name) {
  await goto(page, "#/cats");
  await sleep(150);
  const ok = await page.evaluate((n) => {
    const setNativeValue = (el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    // The most-recently-added cat is the one whose name is still blank ("unnamed cat" aria-label).
    const input = [...document.querySelectorAll('input[type="text"]')].find((i) => i.getAttribute("aria-label")?.endsWith("'s name") && i.value === "");
    if (!input) return false;
    setNativeValue(input, n);
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }, name);
  assert(ok, `could not find a blank name input to set to "${name}"`);
  await sleep(150);
}

async function renameCat(page, oldName, newName) {
  await goto(page, "#/cats");
  await sleep(150);
  const ok = await page.evaluate((oldN, newN) => {
    const setNativeValue = (el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const input = [...document.querySelectorAll('input[type="text"]')].find((i) => i.value === oldN);
    if (!input) return false;
    setNativeValue(input, newN);
    input.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  }, oldName, newName);
  assert(ok, `could not find a name input with value "${oldName}" to rename`);
  await sleep(150);
}

// Logs one weigh-in (kg) for the currently-active cat via the real Weight-log form + button.
async function logWeighIn(page, kg) {
  await goto(page, "#/log");
  await sleep(150);
  const ok = await page.evaluate((kgVal) => {
    const setNativeValue = (el, val) => {
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      setter.call(el, val);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    };
    const h2 = [...document.querySelectorAll("h2")].find((h) => h.textContent.trim() === "Weight log");
    if (!h2) return false;
    const section = h2.closest("section");
    const input = section.querySelector('input[type="number"]');
    const btn = [...section.querySelectorAll("button")].find((b) => b.querySelector("svg"));
    if (!input || !btn) return false;
    setNativeValue(input, String(kgVal));
    btn.click();
    return true;
  }, kg);
  assert(ok, `could not log a ${kg}kg weigh-in`);
  await sleep(600); // clear the 400ms autosave debounce before any localStorage read
}

// Removes the weigh-in row whose displayed weight text contains `kgText` (e.g. "4.4") via the
// real per-row remove ("X") button.
async function removeWeighIn(page, kgText) {
  await goto(page, "#/log");
  await sleep(150);
  const ok = await page.evaluate((needle) => {
    const removeButtons = [...document.querySelectorAll('button[aria-label="Remove this weigh-in"]')];
    for (const btn of removeButtons) {
      const row = btn.closest("li") || btn.parentElement;
      if (row && row.textContent.includes(needle)) { btn.click(); return true; }
    }
    return false;
  }, kgText);
  assert(ok, `could not find a weigh-in row containing "${kgText}" to remove`);
  await sleep(600); // clear the 400ms autosave debounce before any localStorage read
}

async function readWeightKgSet(page) {
  const blob = await page.evaluate(() => window.localStorage.getItem("catration_v1"));
  assert(blob, "no persisted state to read back");
  const parsed = JSON.parse(blob);
  const kgs = new Set();
  for (const cat of Object.values(parsed.cats)) for (const e of cat.weightLog || []) kgs.add(e.kg);
  return kgs;
}

async function readCatNames(page) {
  const blob = await page.evaluate(() => window.localStorage.getItem("catration_v1"));
  assert(blob, "no persisted state to read back");
  const parsed = JSON.parse(blob);
  return Object.values(parsed.cats).map((c) => c.profile?.name).sort();
}

async function exportViaUI(page, downloadDir) {
  const before = new Set(fs.existsSync(downloadDir) ? fs.readdirSync(downloadDir) : []);
  await goto(page, "#/settings");
  await sleep(150);
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent.trim() === "Export data");
    if (!btn) throw new Error("Export data button not found");
    btn.click();
  });
  const deadline = Date.now() + 5000;
  let file;
  while (Date.now() < deadline) {
    const after = fs.readdirSync(downloadDir).filter((f) => !f.endsWith(".crdownload"));
    file = after.find((f) => !before.has(f));
    if (file) break;
    await sleep(100);
  }
  assert(file, "export download never landed");
  return path.join(downloadDir, file);
}

async function importViaUI(page, filePath) {
  await goto(page, "#/settings");
  await sleep(150);
  const inputHandle = await page.$('input[type="file"]');
  assert(inputHandle, "import file input not found");
  await inputHandle.uploadFile(filePath); // real CDP DOM.setFileInputFiles — a genuine file upload, not a shortcut
  await sleep(700); // FileReader + confirm() + importData + re-render, then clear the 400ms autosave debounce
}

/* ---------- main ---------- */

async function main() {
  console.log("building the app…");
  await new Promise((resolve, reject) => {
    const build = spawn("npx", ["vite", "build"], { cwd: ROOT, stdio: "inherit" });
    build.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`vite build exited ${code}`))));
  });

  console.log(`starting a scratch preview server on :${PORT}…`);
  const preview = spawn("npx", ["vite", "preview", "--port", String(PORT), "--strictPort"], { cwd: ROOT, stdio: "pipe" });
  let browser;
  const downloadDirA = fs.mkdtempSync(path.join(os.tmpdir(), "kilocat-e2e-a-"));
  const downloadDirB = fs.mkdtempSync(path.join(os.tmpdir(), "kilocat-e2e-b-"));

  try {
    await waitForServer(BASE_URL);
    console.log("preview server is up. launching Chrome…");
    browser = await puppeteer.launch({ executablePath: CHROME_PATH, headless: true });

    // Two ISOLATED browser contexts = two devices with separate localStorage partitions.
    const ctxA = await browser.createBrowserContext();
    const ctxB = await browser.createBrowserContext();
    const pageA = await ctxA.newPage();
    const pageB = await ctxB.newPage();
    for (const p of [pageA, pageB]) p.on("dialog", (d) => d.accept()); // the real "this will ADD, not replace" confirm

    const clientA = await pageA.createCDPSession();
    await clientA.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirA });
    const clientB = await pageB.createCDPSession();
    await clientB.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDirB });

    console.log("--- device A: add a cat, name it, log two weigh-ins ---");
    await pageA.goto(BASE_URL, { waitUntil: "networkidle0" });
    await sleep(200);
    await addCat(pageA);
    await setActiveCatName(pageA, "Mithril");
    await logWeighIn(pageA, 4.4);
    await logWeighIn(pageA, 4.5);
    const kgsA1 = await readWeightKgSet(pageA);
    assert(kgsA1.has(4.4) && kgsA1.has(4.5), `device A should have logged both weigh-ins, got ${[...kgsA1]}`);

    console.log("--- device A: export ---");
    const exportA1 = await exportViaUI(pageA, downloadDirA);

    console.log("--- device B: add its OWN cat, then import A's export ---");
    await pageB.goto(BASE_URL, { waitUntil: "networkidle0" });
    await sleep(200);
    await addCat(pageB);
    await setActiveCatName(pageB, "Salem");
    await importViaUI(pageB, exportA1);

    const namesB1 = await readCatNames(pageB);
    assert(namesB1.join(",") === "Mithril,Salem", `device B should show BOTH cats after import, got [${namesB1.join(", ")}]`);
    const kgsB1 = await readWeightKgSet(pageB);
    assert(kgsB1.has(4.4) && kgsB1.has(4.5), `device B should have picked up A's weigh-ins, got ${[...kgsB1]}`);
    console.log("    OK: B shows A's cat + both weigh-ins after import");

    console.log("--- device B: rename the shared cat (an edit newer than A's creation), export ---");
    await sleep(50); // ensure this edit's stateModAt is strictly newer than A's original name-set
    await renameCat(pageB, "Mithril", "Mithril II");
    const exportB1 = await exportViaUI(pageB, downloadDirB);

    console.log("--- device A: delete one weigh-in, then import B's export ---");
    await removeWeighIn(pageA, "4.4");
    const kgsAAfterDelete = await readWeightKgSet(pageA);
    assert(!kgsAAfterDelete.has(4.4) && kgsAAfterDelete.has(4.5), `device A should have only 4.5 left locally, got ${[...kgsAAfterDelete]}`);
    await importViaUI(pageA, exportB1);

    const namesA2 = await readCatNames(pageA);
    assert(namesA2.includes("Mithril II"), `device A should adopt B's newer rename (LWW), got [${namesA2.join(", ")}]`);
    console.log("    OK: A picked up B's rename via LWW");

    console.log("--- device A: export; device B imports it — the deleted weigh-in must NOT resurrect ---");
    const exportA2 = await exportViaUI(pageA, downloadDirA);
    await importViaUI(pageB, exportA2);

    const kgsB2 = await readWeightKgSet(pageB);
    assert(!kgsB2.has(4.4), `4.4 was deleted on A and must NOT resurrect on B, got ${[...kgsB2]}`);
    assert(kgsB2.has(4.5), `4.5 was never deleted and must still be present on B, got ${[...kgsB2]}`);
    console.log("    OK: deleted weigh-in stayed deleted on B; the other survived");

    console.log("\nALL E2E ASSERTIONS PASSED");
  } finally {
    if (browser) await browser.close().catch(() => {});
    preview.kill();
    fs.rmSync(downloadDirA, { recursive: true, force: true });
    fs.rmSync(downloadDirB, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error("\nE2E FAILED:", err.message);
  process.exit(1);
});

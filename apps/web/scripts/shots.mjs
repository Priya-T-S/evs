// Visual verification for the command center.
//   node scripts/shots.mjs                 -> onboarding/explain-in-place set, 1440x900 + 1280x800, light + dark
//   node scripts/shots.mjs tour            -> only shots whose name contains "tour"
//   COMBOS=1440-dark node scripts/shots.mjs -> one viewport/theme combination
//   node scripts/shots.mjs legacy          -> the older full walkthrough (hotspot, recommendation, admin…)
//   node scripts/shots.mjs realtime        -> realtime test (creates a guest report while the page is open)
// Requires: dev server on :5173, API on :8000, Playwright (installed at the repo root).
// The theme is chosen through the emulated system preference, which also checks that the
// app follows the OS theme by default.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const WEB = process.env.WEB_URL ?? "http://localhost:5173";
const API = process.env.API_URL ?? "http://localhost:8000";
const OUT = process.env.SHOTS_DIR ?? join(tmpdir(), "ecopulse-shots", "web-v2");
const only = process.argv[2] ?? "";
mkdirSync(OUT, { recursive: true });

const ALL_COMBOS = [
  { key: "1440-dark", width: 1440, height: 900, scheme: "dark" },
  { key: "1440-light", width: 1440, height: 900, scheme: "light" },
  { key: "1280-dark", width: 1280, height: 800, scheme: "dark" },
  { key: "1280-light", width: 1280, height: 800, scheme: "light" },
];
const COMBOS = process.env.COMBOS ? ALL_COMBOS.filter((c) => process.env.COMBOS.split(",").includes(c.key)) : ALL_COMBOS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function apiLogin(email) {
  const r = await fetch(`${API}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email, password: "ecopulse-demo" }) });
  return (await r.json()).access_token;
}
async function apiGet(path, token) {
  const r = await fetch(`${API}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return r.json();
}

async function login(page, email) {
  await page.goto(`${WEB}/login`);
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("ecopulse-demo");
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(`${WEB}/`);
}

async function settle(page, ms = 2500) {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await sleep(ms);
}

const errors = [];
let prefix = "";
async function shot(page, name) {
  const file = join(OUT, `${prefix}${name}.png`);
  await page.screenshot({ path: file });
  console.log("shot", file);
}

/** Hover a "?" InfoTip by the thing it explains, e.g. tip(page, "P1 priority"). */
async function hoverTip(page, label) {
  const b = page.getByRole("button", { name: `What is “${label}”?` }).first();
  await b.scrollIntoViewIfNeeded().catch(() => {});
  await b.hover();
  await page.waitForSelector("[role=tooltip]", { timeout: 3000 }).catch(() => {});
  await sleep(250);
}

async function onboarding(browser, c) {
  prefix = `${c.key}-`;
  const ctx = await browser.newContext({ viewport: { width: c.width, height: c.height }, deviceScaleFactor: 1, colorScheme: c.scheme, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m) => m.type() === "error" && errors.push(`console: ${m.text()}`));
  const want = (n) => !only || n.includes(only);

  if (want("login")) {
    await page.goto(`${WEB}/login`);
    await settle(page, 600);
    await shot(page, "00-login");
  }

  // Fresh context = first visit, so the welcome tour starts on its own.
  await login(page, "officer@ecopulse.dev");
  await settle(page, 3000);
  const pop = page.locator("[data-tour-popover]");
  await pop.waitFor({ timeout: 8000 }).catch(() => errors.push("tour did not start on first visit"));
  for (let i = 1; i <= 5; i++) {
    if (!(await pop.count())) break;
    await sleep(i === 4 ? 2200 : 500);
    if (want("tour")) await shot(page, `01-tour-${i}`);
    await page.getByRole("button", { name: i === 5 ? "Finish" : "Next" }).click();
  }
  // Tour must not come back after reload.
  await page.reload();
  await settle(page, 2500);
  if (await pop.count()) errors.push("tour shown again after finishing");
  await page.evaluate(() => window.__ecoSelect(null));
  await sleep(500);

  if (want("tip")) {
    await hoverTip(page, "P1 priority");
    await shot(page, "02-tip-priority");
    const risk = page.locator("[data-queue-row]").first().getByText(/^Risk/);
    await risk.hover();
    await sleep(500);
    await shot(page, "03-tip-risk");
    await page.mouse.move(700, 500);
    await page.getByRole("button", { name: /^Layers/ }).click();
    await sleep(500);
    await page.getByRole("checkbox", { name: "Flood risk" }).check();
    await settle(page, 1500);
    await hoverTip(page, "Flood risk");
    await shot(page, "04-tip-layer");
    await page.getByRole("checkbox", { name: "Flood risk" }).uncheck();
    await page.getByLabel("Close layer panel").click();
    await sleep(300);
  }

  if (want("drawer")) {
    await page.locator("[data-queue-row]").first().click();
    await settle(page, 2500);
    await shot(page, "05-drawer");
    await hoverTip(page, "Risk");
    await shot(page, "06-drawer-tip-risk");
    await page.mouse.move(10, 10);
    const assign = page.getByRole("button", { name: /Assign to team|Change team/ });
    if (await assign.count()) {
      await assign.first().click();
      await settle(page, 1200);
      await shot(page, "07-dialog-assign");
      await page.getByRole("button", { name: "Cancel" }).click();
    } else errors.push("no assign button in drawer");
    await sleep(300);
    await page.keyboard.press("Escape");
    await sleep(400);
  }

  if (want("shortcuts")) {
    await page.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => {});
    await page.keyboard.press("?");
    await sleep(500);
    await shot(page, "08-shortcuts");
    await page.keyboard.press("Escape");
    await sleep(300);
  }

  if (want("analytics")) {
    await page.goto(`${WEB}/analytics`);
    await settle(page, 3000);
    await hoverTip(page, "Reports per day, by type of problem");
    await shot(page, "09-analytics");
    await page.mouse.move(10, 10);
    await page.locator("main").evaluate((el) => (el.scrollTop = 700));
    await sleep(400);
    await hoverTip(page, "How far problems got");
    await shot(page, "10-analytics-scrolled");
  }

  await ctx.close();
}

async function run() {
  const browser = await chromium.launch();
  if (only === "realtime" || only === "legacy") {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
    if (only === "realtime") await realtimeTest(page);
    else await legacy(page);
    await browser.close();
    return;
  }
  for (const c of COMBOS) await onboarding(browser, c);
  await browser.close();
}

async function finishTourIfShown(page) {
  const pop = page.locator("[data-tour-popover]");
  await pop.waitFor({ timeout: 4000 }).catch(() => {});
  if (await pop.count()) await page.getByRole("button", { name: "Skip tour" }).click();
}

async function legacy(page) {
  prefix = "legacy-";
  await login(page, "officer@ecopulse.dev");
  const token = await apiLogin("officer@ecopulse.dev");
  await settle(page, 2000);
  await finishTourIfShown(page);
  await shot(page, "01-command");
  const hs = await apiGet("/hotspots", token);
  const h = hs.items[0];
  await page.evaluate((h) => window.__ecoSelect({ kind: "hotspot", id: h.id, lon: h.lon, lat: h.lat, properties: {} }, { fly: true, zoom: 14 }), h);
  await settle(page, 3000);
  await shot(page, "05-command-hotspot");
  await page.evaluate(() => window.__ecoSelect({ kind: "neighbourhood", id: 15, lon: 77.6101, lat: 12.9166, properties: {} }, { fly: true, zoom: 13 }));
  await settle(page, 2000);
  await shot(page, "07-command-neighbourhood");
  for (const [route, name] of [
    ["/hotspots", "11-hotspots"],
    ["/recommendations", "12-recommendations"],
    ["/assistant", "16-assistant"],
  ]) {
    await page.goto(`${WEB}${route}`);
    await settle(page, 3000);
    await shot(page, name);
  }
}

async function realtimeTest(page) {
  const frames = [];
  page.on("websocket", (ws) => ws.on("framereceived", (f) => {
    try {
      const e = JSON.parse(f.payload);
      if (e.type !== "pong") frames.push(`${e.type} ${e.data?.ref ?? ""} ${e.data?.title ?? ""} reporters=${e.data?.reporter_count ?? ""}`);
    } catch {}
  }));
  await login(page, "officer@ecopulse.dev");
  await settle(page, 3500);
  await finishTourIfShown(page);
  await page.evaluate(() => window.__ecoSelect(null));
  const before = await page.locator("dl[aria-label='City status']").innerText();
  await shot(page, process.env.RT_SHOT ? process.env.RT_SHOT + "-before" : "20-realtime-before");
  // Make a small real JPEG in the browser, then report as a guest from Node.
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 320;
    c.height = 240;
    const g = c.getContext("2d");
    g.fillStyle = "#6b5a3a";
    g.fillRect(0, 0, 320, 240);
    for (let i = 0; i < 60; i++) {
      g.fillStyle = `hsl(${(i * 37) % 360},40%,${30 + (i % 5) * 8}%)`;
      g.fillRect((i * 53) % 300, (i * 29) % 220, 24, 18);
    }
    return c.toDataURL("image/jpeg", 0.85);
  });
  const jpeg = Buffer.from(dataUrl.split(",")[1], "base64");
  const guest = await (await fetch(`${API}/auth/guest`, { method: "POST" })).json();
  const form = new FormData();
  form.set("category", process.env.RT_CATEGORY ?? "garbage");
  form.set("lat", process.env.RT_LAT ?? "12.9395");
  form.set("lon", process.env.RT_LON ?? "77.6190");
  form.set("description", "Realtime test: overflowing garbage bins near the bus stop");
  form.set("photo", new Blob([jpeg], { type: "image/jpeg" }), "test.jpg");
  const r = await fetch(`${API}/reports`, { method: "POST", headers: { Authorization: `Bearer ${guest.access_token}` }, body: form });
  const rep = await r.json();
  console.log("report", r.status, JSON.stringify({ status: rep.status, incident: rep.incident, ai: rep.ai?.label }));
  const t0 = frames.length;
  await sleep(6000);
  console.log("ws events after report:", JSON.stringify(frames.slice(t0), null, 1));
  const after = await page.locator("dl[aria-label='City status']").innerText();
  console.log("stats before:", before.replace(/\n/g, " "), "\nstats after: ", after.replace(/\n/g, " "));
  await shot(page, process.env.RT_SHOT ?? "21-realtime-after");
}

run()
  .then(() => {
    if (errors.length) console.log("ISSUES:\n" + [...new Set(errors)].slice(0, 40).join("\n"));
    else console.log("no browser errors");
  })
  .catch((e) => {
    console.error(e);
    if (errors.length) console.log("ISSUES:\n" + [...new Set(errors)].slice(0, 40).join("\n"));
    process.exit(1);
  });

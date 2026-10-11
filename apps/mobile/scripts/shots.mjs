// Visual walkthrough of the EcoPulse citizen app with Playwright.
// Usage: pnpm dev (port 5174) in one terminal, then `node scripts/shots.mjs` from apps/mobile.
//   node scripts/shots.mjs            phone (390×844) + desktop browser (1440×900) walkthrough
//   node scripts/shots.mjs --extras   also noise measurement, realtime, offline queue and dark mode
// Screenshots go to %LOCALAPPDATA%\Temp\ecopulse-shots\mobile-v2 (or $SHOTS_DIR).
// Guest creation is rate-limited per IP; if "Continue as guest" fails, the script signs in with
// the demo citizen account instead, and the signed-in state is reused for later contexts.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const APP = process.env.APP_URL ?? "http://localhost:5174";
const API = process.env.API_URL ?? "http://localhost:8000";
const OUT = process.env.SHOTS_DIR ?? join(tmpdir(), "ecopulse-shots", "mobile-v2");
const EXTRAS = process.argv.includes("--extras");
mkdirSync(OUT, { recursive: true });

const GEO = { latitude: 12.9352, longitude: 77.6245 };
const base = (colorScheme = "light") => ({
  geolocation: { ...GEO, accuracy: 12 },
  permissions: ["geolocation", "microphone"],
  colorScheme,
  locale: "en-IN",
  timezoneId: "Asia/Kolkata",
});
const phone = (c) => ({ ...base(c), viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const desktop = (c) => ({ ...base(c), viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const log = (...a) => console.log("[shots]", ...a);
const results = [];
async function shot(page, name) {
  await page.waitForTimeout(400);
  const file = join(OUT, `${name}.png`);
  await page.screenshot({ path: file });
  results.push(file);
  log("saved", file);
}

async function makeJpeg(page) {
  const dataUrl = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 1200;
    c.height = 900;
    const g = c.getContext("2d");
    // A crude "garbage pile on a pavement" scene: ground, wall, heap of shapes.
    g.fillStyle = "#9a958a";
    g.fillRect(0, 0, 1200, 900);
    g.fillStyle = "#c9c2b0";
    g.fillRect(0, 0, 1200, 380);
    g.fillStyle = "#6d675c";
    g.fillRect(0, 380, 1200, 12);
    const colors = ["#3d5a3c", "#2b2b2b", "#d6d1c4", "#6b4a2f", "#2f4e7a", "#c4442d", "#e2dccb", "#4b4b44"];
    let seed = 7;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let i = 0; i < 420; i++) {
      const x = 260 + rnd() * 680;
      const y = 470 + rnd() * 330 - Math.max(0, 200 - Math.abs(x - 600) * 0.6) * rnd();
      g.fillStyle = colors[Math.floor(rnd() * colors.length)];
      g.beginPath();
      g.ellipse(x, y, 14 + rnd() * 40, 10 + rnd() * 26, rnd() * 3, 0, Math.PI * 2);
      g.fill();
    }
    return c.toDataURL("image/jpeg", 0.85);
  });
  return Buffer.from(dataUrl.split(",")[1], "base64");
}

async function scrollMain(page, px) {
  await page.evaluate((px) => {
    const el = [...document.querySelectorAll(".scroll-area")].filter((e) => e.scrollHeight > e.clientHeight && e.offsetParent).sort((a, b) => b.clientHeight - a.clientHeight)[0];
    if (el) el.scrollTop = px === "end" ? el.scrollHeight : px;
  }, px);
  await page.waitForTimeout(300);
}
/** Scroll the scrollable body of the open dialog (sheet). */
async function scrollSheet(page, px) {
  await page.evaluate((px) => {
    const d = [...document.querySelectorAll('[role="dialog"]')].pop();
    const el = d && [...d.querySelectorAll(".scroll-area")].find((e) => e.scrollHeight > e.clientHeight);
    if (el) el.scrollTop = px === "end" ? el.scrollHeight : px;
  }, px);
  await page.waitForTimeout(300);
}

async function waitMapData(page) {
  await page.waitForFunction(() => !!window.__epMap && window.__epMap.isStyleLoaded(), null, { timeout: 30000 });
  await page.evaluate(() => window.__epMap.jumpTo({ center: [77.6225, 12.9365], zoom: 14.6 }));
  await page.waitForFunction(
    () => {
      const m = window.__epMap;
      if (!m || !m.loaded()) return false;
      const f = m.queryRenderedFeatures({ layers: ["incident", "cluster"].filter((l) => m.getLayer(l)) });
      return f.length > 0;
    },
    null,
    { timeout: 30000 },
  );
  await page.waitForTimeout(1200);
}

async function tapIncident(page, touch = true) {
  const pt = await page.evaluate(() => {
    const m = window.__epMap;
    const rect = m.getCanvas().getBoundingClientRect();
    const feats = m.queryRenderedFeatures({ layers: ["incident"] });
    const cx = rect.width / 2,
      cy = rect.height / 2;
    let best = null;
    for (const f of feats) {
      const p = m.project(f.geometry.coordinates);
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (p.y > 260 && p.y < rect.height - 140 && p.x > 30 && p.x < rect.width - 30 && (!best || d < best.d)) best = { x: p.x + rect.left, y: p.y + rect.top, d, id: f.properties.id };
    }
    return best;
  });
  if (!pt) throw new Error("no incident rendered to tap");
  log("tapping incident", pt.id);
  if (touch) await page.touchscreen.tap(pt.x, pt.y);
  else await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('[role="dialog"]', { timeout: 8000 });
}

/** Get past the intro: try guest; if guest creation is refused (rate limit), sign in with the demo account. */
async function enterApp(page) {
  await page.getByRole("button", { name: "Continue as guest" }).click();
  const ok = await page
    .getByRole("button", { name: "Yes, use my location" })
    .waitFor({ timeout: 8000 })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    log("guest creation failed (likely rate-limited) — signing in with the demo citizen");
    await page.getByRole("button", { name: "I have an account" }).click();
    await page.getByRole("button", { name: /Use the sample account/ }).click();
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await page.getByRole("button", { name: "Yes, use my location" }).waitFor({ timeout: 10000 });
  }
}

const browser = await chromium.launch({ args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"] });
const consoleErrors = [];
const watch = (page) => {
  page.on("console", (m) => m.type() === "error" && consoleErrors.push(m.text()));
  page.on("pageerror", (e) => consoleErrors.push(String(e)));
};
try {
  const ctx = await browser.newContext(phone("light"));
  const page = await ctx.newPage();
  watch(page);

  // ---------------------------------------------------------------- intro / how it works
  await page.goto(APP);
  await page.getByRole("button", { name: "Continue as guest" }).waitFor();
  await shot(page, "01-intro");
  await scrollMain(page, "end");
  await shot(page, "01b-intro-how-it-works");
  await enterApp(page);
  await shot(page, "02-location-explainer");
  await page.getByRole("button", { name: "Yes, use my location" }).click();

  // ---------------------------------------------------------------- home
  await page.getByText("What you can do").waitFor({ timeout: 15000 });
  await page.getByText(/Score \d+ out of 100/).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1500);
  await shot(page, "03-home");
  await scrollMain(page, 520);
  await shot(page, "03b-home-area");
  await scrollMain(page, 1100);
  await shot(page, "03c-home-nearby");
  await scrollMain(page, "end");
  await shot(page, "03d-home-live");
  await scrollMain(page, 520);
  await page.getByRole("button", { name: /How do we know this\?/ }).first().click();
  await page.waitForTimeout(800);
  await shot(page, "04-score-sheet");
  await page.locator('[role="dialog"]').getByRole("button", { name: "Details" }).first().click();
  await page.waitForTimeout(300);
  await shot(page, "04b-score-sheet-details");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------- map
  await page.getByRole("link", { name: "Map" }).click();
  await waitMapData(page);
  await page.getByText("Tap a coloured dot to see what's there").waitFor({ timeout: 5000 });
  await shot(page, "05-map-coach-mark");
  await page.getByRole("button", { name: "Got it" }).click();
  await page.getByRole("button", { name: "What do the colours mean?" }).click();
  await shot(page, "05b-map-legend");
  await page.getByRole("button", { name: "Hide" }).click();
  await tapIncident(page);
  await page.waitForTimeout(1500);
  await shot(page, "06-incident-peek");
  await page.getByRole("button", { name: "Expand details" }).click();
  await page.waitForTimeout(1500);
  await shot(page, "06b-incident-full");
  await scrollSheet(page, 480);
  await shot(page, "06c-incident-urgency");
  const how = page.locator('[role="dialog"]').getByRole("button", { name: "How do we know this?" }).first();
  if (await how.count()) {
    await how.click();
    await page.waitForTimeout(300);
    await shot(page, "06d-incident-details-open");
  }
  await scrollSheet(page, "end");
  await shot(page, "06e-incident-end");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  await page.getByRole("button", { name: "What to show on the map" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "07-layer-picker");
  await page.getByRole("button", { name: "Done" }).click();
  await page.waitForTimeout(500);

  // ---------------------------------------------------------------- report flow
  const jpeg = await makeJpeg(page);
  await page.getByRole("button", { name: "Report a problem" }).first().click();
  await page.getByText("What's the problem?").waitFor();
  await shot(page, "08-report-category");
  const t0 = Date.now();
  await page.getByRole("listitem").filter({ hasText: "Overflowing bins" }).click();
  await page.getByRole("heading", { name: "Take a photo" }).waitFor();
  await shot(page, "09-report-photo");
  await page.setInputFiles("#photo-camera", { name: "photo.jpg", mimeType: "image/jpeg", buffer: jpeg });
  await page.getByText(/Looks like:|couldn't check the photo/).waitFor({ timeout: 15000 });
  await shot(page, "10-report-photo-check");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Where is it?").waitFor();
  await page.waitForTimeout(2500);
  await shot(page, "11-report-location");
  await page.getByRole("button", { name: "Next" }).click();
  await page.getByText("Anything to add?").waitFor();
  await page.locator("textarea").fill("The pile has been growing for a week next to the bus stop.");
  await shot(page, "12-report-details");
  await page.getByRole("button", { name: "Send report" }).click();
  await page.getByText("Thank you!").waitFor({ timeout: 15000 });
  log("report submitted in", ((Date.now() - t0) / 1000).toFixed(1), "s (scripted)");
  await page.getByText(/people have reported this|now on the map/).waitFor({ timeout: 25000 });
  await page.getByText(/EcoPoints/).first().waitFor();
  await page.waitForTimeout(2000);
  await shot(page, "13-report-success");
  log("outcome:", (await page.getByText(/people have reported this|now on the map/).first().innerText()).replace(/\s+/g, " "));
  await page.getByRole("button", { name: "Done" }).click();

  const access = await page.evaluate(() => JSON.parse(localStorage.getItem("ecopulse-app")).state.access);
  const mine = await fetch(`${API}/reports?mine=true`, { headers: { Authorization: `Bearer ${access}` } }).then((r) => r.json());
  log("GET /reports?mine=true →", mine.items.slice(0, 3).map((r) => `${r.category}:${r.status}:${r.incident?.ref}`).join(", "));

  // ---------------------------------------------------------------- activity + messages
  await page.getByRole("link", { name: "Activity" }).click();
  await page.getByText("Latest updates").waitFor();
  await page.waitForTimeout(1500);
  await shot(page, "14-activity");
  await scrollMain(page, "end");
  await shot(page, "14b-activity-problem-areas");
  const area = page.getByRole("button", { name: /urgency/i }).first();
  if (await area.count()) {
    await area.click();
    await page.waitForTimeout(2500);
    await shot(page, "14c-problem-area-sheet");
    await page.getByRole("button", { name: "Expand details" }).click().catch(() => undefined);
    await page.waitForTimeout(1200);
    await shot(page, "14d-problem-area-full");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(500);
  }
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByRole("button", { name: /Messages for you/ }).click();
  await page.waitForTimeout(1200);
  await shot(page, "15-messages");
  await page.getByRole("button", { name: "Back" }).click();

  // ---------------------------------------------------------------- profile, help, text size
  await page.getByRole("link", { name: "Profile" }).click();
  await page.getByRole("heading", { name: "Your reports" }).waitFor();
  await page.waitForTimeout(1200);
  await shot(page, "16-profile");
  await scrollMain(page, "end");
  await shot(page, "16b-profile-settings");
  await page.getByRole("button", { name: /Help & questions/ }).click();
  await page.waitForTimeout(600);
  await shot(page, "17-help");
  await page.getByRole("button", { name: "Is my exact location shared?" }).click();
  await page.getByRole("button", { name: "What do the colours mean?" }).click();
  await page.waitForTimeout(300);
  await shot(page, "17b-help-answers");
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForTimeout(500);
  await scrollMain(page, "end");
  await page.getByRole("button", { name: /Where our information comes from/ }).click();
  await page.waitForTimeout(1200);
  await shot(page, "16c-sources");
  await page.getByRole("button", { name: "Back" }).click();
  await page.waitForTimeout(500);
  await scrollMain(page, "end");
  await page.getByRole("button", { name: /How EcoPulse works/ }).click();
  await page.waitForTimeout(600);
  await shot(page, "18-how-it-works-replay");
  await page.getByRole("button", { name: "Got it" }).click();
  await page.waitForTimeout(500);
  await scrollMain(page, "end");
  await page.getByRole("radio", { name: "Large", exact: true }).click();
  await page.waitForTimeout(500);
  await shot(page, "19-text-size-large-profile");
  await page.getByRole("link", { name: "Home" }).click();
  await page.getByText("What you can do").waitFor();
  await page.waitForTimeout(1200);
  await shot(page, "19b-text-size-large-home");
  await page.getByRole("link", { name: "Profile" }).click();
  await page.waitForTimeout(600);
  await scrollMain(page, "end");
  await page.getByRole("radio", { name: "Extra large" }).click();
  await page.getByRole("link", { name: "Home" }).click();
  await page.waitForTimeout(1200);
  await shot(page, "19c-text-size-xl-home");
  await page.getByRole("link", { name: "Profile" }).click();
  await page.waitForTimeout(600);
  await scrollMain(page, "end");
  await page.getByRole("radio", { name: "Normal", exact: true }).click();
  await page.waitForTimeout(300);

  // ---------------------------------------------------------------- desktop browser
  const state = await ctx.storageState();
  const dctx = await browser.newContext({ ...desktop("light"), storageState: state });
  const dp = await dctx.newPage();
  watch(dp);
  await dp.goto(APP + "/");
  await dp.getByText("What you can do").waitFor({ timeout: 15000 });
  await dp.waitForTimeout(1500);
  await shot(dp, "30-desktop-home");
  await dp.getByRole("button", { name: /How do we know this\?/ }).first().click();
  await dp.waitForTimeout(800);
  await shot(dp, "31-desktop-score-sheet");
  await dp.keyboard.press("Escape");
  await dp.waitForTimeout(500);
  await dp.getByRole("link", { name: "Map" }).click();
  await waitMapData(dp);
  await shot(dp, "32-desktop-map");
  await tapIncident(dp, false);
  await dp.getByRole("button", { name: "Expand details" }).click();
  await dp.waitForTimeout(1500);
  await shot(dp, "33-desktop-incident");
  await dp.keyboard.press("Escape");
  await dp.waitForTimeout(500);
  await dp.getByRole("button", { name: "Report a problem" }).first().click();
  await dp.getByText("What's the problem?").waitFor();
  await shot(dp, "34-desktop-report");
  await dp.goto(APP + "/profile/help");
  await dp.waitForTimeout(1000);
  await shot(dp, "35-desktop-help");
  await dctx.close();

  // Fresh desktop visitor: the intro.
  const fctx = await browser.newContext(desktop("light"));
  const fp = await fctx.newPage();
  await fp.goto(APP);
  await fp.getByRole("button", { name: "Continue as guest" }).waitFor();
  await shot(fp, "36-desktop-intro");
  await fctx.close();

  if (EXTRAS) {
    // ---------------------------------------------------------------- noise measurement
    await page.goto(APP + "/");
    await page.getByRole("button", { name: "Report a problem" }).first().click();
    await page.getByRole("listitem").filter({ hasText: "Loudspeakers" }).click();
    await page.getByRole("button", { name: "Skip photo" }).click();
    await page.getByText("Where is it?").waitFor();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: /Measure noise/ }).click();
    await page.waitForTimeout(2500);
    await shot(page, "40-noise-measuring");
    await page.getByText(/On average/).waitFor({ timeout: 10000 });
    await shot(page, "40b-noise-result");
    await page.goto(APP + "/");

    // ---------------------------------------------------------------- offline queue
    await page.getByText("What you can do").waitFor();
    await ctx.setOffline(true);
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Report a problem" }).first().click();
    await page.getByRole("listitem").filter({ hasText: "Water collected" }).click();
    await page.getByRole("button", { name: "Skip photo" }).click();
    await page.getByText("Where is it?").waitFor();
    await page.waitForTimeout(800);
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Send report" }).click();
    await page.getByText("Saved on your phone").waitFor({ timeout: 10000 });
    await shot(page, "41-report-saved-offline");
    await page.getByRole("button", { name: "Done" }).click();
    await page.waitForTimeout(1000);
    await shot(page, "41b-home-offline");
    await ctx.setOffline(false);
    await page.getByText("Your saved report was sent").waitFor({ timeout: 30000 }).then(
      () => log("OFFLINE QUEUE OK: sent after reconnect"),
      () => log("OFFLINE QUEUE: no 'sent' toast within 30 s"),
    );

    // ---------------------------------------------------------------- dark mode
    const dark = await browser.newContext({ ...phone("dark"), storageState: await ctx.storageState() });
    const kp = await dark.newPage();
    await kp.goto(APP + "/");
    await kp.getByText("What you can do").waitFor({ timeout: 15000 });
    await kp.waitForTimeout(1200);
    await shot(kp, "42-home-dark");
    await kp.getByRole("link", { name: "Map" }).click();
    await waitMapData(kp);
    await shot(kp, "42b-map-dark");
    await dark.close();
  }
  await ctx.close();
} catch (e) {
  console.error("[shots] FAILED:", e);
  process.exitCode = 1;
} finally {
  if (consoleErrors.length) log("console errors:\n  " + [...new Set(consoleErrors)].slice(0, 20).join("\n  "));
  await browser.close();
  log(`${results.length} screenshots in ${OUT}`);
}

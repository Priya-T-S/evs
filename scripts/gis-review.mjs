// GIS review: screenshots the command-center map at city / neighbourhood / street zoom with
// different layer sets, and records every console error / MapLibre style error.
import { chromium } from "playwright";
const OUT = process.env.TEMP + "/ecopulse-shots/review";
import fs from "node:fs";
fs.mkdirSync(OUT, { recursive: true });
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errors = [];
p.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(`[${m.type()}] ${m.text().slice(0, 200)}`));
p.on("pageerror", (e) => errors.push(`[pageerror] ${e.message}`));
await p.goto("http://localhost:5173/login");
await p.fill('input[type="email"]', "officer@ecopulse.dev");
await p.fill('input[type="password"]', "ecopulse-demo");
await p.keyboard.press("Enter");
await p.waitForURL("http://localhost:5173/");
await p.waitForFunction(() => window.__epMap && window.__epMap.isStyleLoaded());
const views = [
  ["city", [77.6, 12.97], 10.2, ["risk", "hotspots", "incidents"]],
  ["neighbourhood", [77.625, 12.935], 13, ["hotspots", "incidents", "neighbourhoods"]],
  ["street", [77.6195, 12.9395], 15.6, ["incidents", "hotspots", "infrastructure", "interventions"]],
  ["heat-waste", [77.63, 12.95], 11.5, ["waste", "hotspots"]],
  ["flood", [77.6, 12.98], 11, ["flood", "incidents"]],
  ["green", [77.59, 12.965], 13.5, ["green", "interventions"]],
  ["air", [77.6, 12.97], 10.5, ["air"]],
];
for (const [name, center, zoom, layers] of views) {
  await p.evaluate(([c, z, l]) => { window.__epCtl.setLayers(l); window.__epMap.jumpTo({ center: c, zoom: z }); }, [center, zoom, layers]);
  await p.waitForTimeout(3500);
  await p.screenshot({ path: `${OUT}/web-${name}.png` });
  const n = await p.evaluate(() => window.__epMap.queryRenderedFeatures().filter((f) => !f.source.startsWith("openmaptiles")).length);
  console.log(name, "rendered data features:", n);
}
console.log("console errors/warnings:", errors.length);
[...new Set(errors)].slice(0, 15).forEach((e) => console.log("  ", e));
await b.close();

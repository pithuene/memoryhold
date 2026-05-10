import { chromium } from "playwright";

const url = process.env.MEMORYHOLD_URL ?? "http://localhost:5173";
const out = process.env.MEMORYHOLD_SCREENSHOT ?? "tmp/memoryhold-ui.png";
const width = Number(process.env.MEMORYHOLD_SCREENSHOT_WIDTH ?? 1440);
const height = Number(process.env.MEMORYHOLD_SCREENSHOT_HEIGHT ?? 1000);
const openFirstSession = process.env.MEMORYHOLD_OPEN_FIRST_SESSION === "1";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
page.on("console", (msg) => console.log(`[browser:${msg.type()}] ${msg.text()}`));
page.on("pageerror", (err) => console.error(`[browser:error] ${err.message}`));
await page.goto(url, { waitUntil: "networkidle", timeout: 30_000 });
if (openFirstSession) {
  const firstSession = page.locator(".session").first();
  if (await firstSession.count()) {
    await firstSession.click();
    await page.waitForTimeout(800);
  }
}
await page.screenshot({ path: out, fullPage: false });
await browser.close();
console.log(`Wrote ${out}`);

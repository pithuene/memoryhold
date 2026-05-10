import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const width = Number(process.env.CHATGPT_REF_WIDTH ?? process.env.MEMORYHOLD_SCREENSHOT_WIDTH ?? 1440);
const height = Number(process.env.CHATGPT_REF_HEIGHT ?? process.env.MEMORYHOLD_SCREENSHOT_HEIGHT ?? 1000);
const outDir = process.env.CHATGPT_REF_DIR ?? "tmp";
const prefix = process.env.CHATGPT_REF_PREFIX ?? "chatgpt-reference";
const waitMs = Number(process.env.CHATGPT_REF_WAIT_MS ?? 120_000);
const url = process.env.CHATGPT_REF_URL ?? "https://chatgpt.com";

await mkdir(outDir, { recursive: true });

const userDataDir = path.join(outDir, "playwright-chatgpt-profile");
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  viewport: { width, height },
  deviceScaleFactor: 1,
});

const page = context.pages()[0] ?? await context.newPage();
console.log(`Opening ${url}`);
console.log("Log in / navigate to the ChatGPT view you want captured.");
console.log(`Capturing in ${Math.round(waitMs / 1000)}s...`);
console.log("Tip: set CHATGPT_REF_WAIT_MS=300000 for 5 minutes.");

await page.goto(url, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(waitMs);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(outDir, `${prefix}-${timestamp}.png`);
await page.screenshot({ path: file, fullPage: false });
console.log(`Wrote ${file}`);

await context.close();

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";

const width = Number(process.env.CHATGPT_REF_WIDTH ?? process.env.MEMORYHOLD_SCREENSHOT_WIDTH ?? 1440);
const height = Number(process.env.CHATGPT_REF_HEIGHT ?? process.env.MEMORYHOLD_SCREENSHOT_HEIGHT ?? 1000);
const outDir = process.env.CHATGPT_REF_DIR ?? "tmp";
const prefix = process.env.CHATGPT_REF_PREFIX ?? "chatgpt-reference";
const waitMs = Number(process.env.CHATGPT_REF_WAIT_MS ?? 120_000);
const setupMode = process.env.CHATGPT_REF_SETUP === "1";
const url = process.env.CHATGPT_REF_URL ?? "https://chatgpt.com";
const browserChannel = process.env.CHATGPT_REF_BROWSER_CHANNEL ?? "chrome";

await mkdir(outDir, { recursive: true });

const userDataDir = path.join(outDir, "playwright-chatgpt-profile");
const launchOptions = {
  headless: false,
  viewport: { width, height },
  deviceScaleFactor: 1,
};

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    ...launchOptions,
    channel: browserChannel,
  });
} catch (error) {
  if (browserChannel) {
    console.warn(`Could not launch Chromium channel '${browserChannel}', falling back to bundled Playwright Chromium.`);
    console.warn(error?.message ?? error);
    context = await chromium.launchPersistentContext(userDataDir, launchOptions);
  } else {
    throw error;
  }
}

const page = context.pages()[0] ?? await context.newPage();
console.log(`Opening ${url}`);
console.log(`Using persistent profile: ${userDataDir}`);

await page.goto(url, { waitUntil: "domcontentloaded" });

if (setupMode) {
  console.log("Setup mode: log in to ChatGPT in the opened browser window.");
  console.log("When login is complete, close the browser window. The profile/session will be saved.");
  await new Promise((resolve) => context.on("close", resolve));
  process.exit(0);
}

console.log("Navigate to the ChatGPT view you want captured if needed.");
console.log(`Capturing in ${Math.round(waitMs / 1000)}s...`);
console.log("Tip: set CHATGPT_REF_WAIT_MS=300000 for 5 minutes.");
await page.waitForTimeout(waitMs);

const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const file = path.join(outDir, `${prefix}-${timestamp}.png`);
await page.screenshot({ path: file, fullPage: false });
console.log(`Wrote ${file}`);

await context.close();

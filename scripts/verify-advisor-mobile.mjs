// P1-UI-3 acceptance: at a 375px viewport, drive /advisor into the multi-adjustment state
// (Top N 30 > Top K 20, uptime 1000) and assert the document NEVER scrolls horizontally.
// Run: `npm run dev` (or point APP_URL at a served build), then `node scripts/verify-advisor-mobile.mjs`.
import puppeteer from "puppeteer-core";

const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = process.env.APP_URL || "http://localhost:3005/advisor";

const errors = [];
const fail = (m) => {
  console.error("ASSERT FAIL:", m);
  errors.push(m);
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: "new",
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});
const page = await browser.newPage();
await page.setViewport({ width: 375, height: 812, isMobile: true });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

await page.goto(URL, { waitUntil: "networkidle0", timeout: 60000 });
await page.waitForSelector('[data-testid="decision-summary"]', { timeout: 30000 });

// Switch to Expert and create MULTIPLE adjustments (Top N > Top K, uptime > 730).
// Click Expert until the toggle actually flips (guards against pre-hydration clicks).
await page.waitForSelector('[data-testid="mode-expert"]', { timeout: 15000 });
for (let i = 0; i < 20; i++) {
  await page.click('[data-testid="mode-expert"]');
  const pressed = await page.$eval('[data-testid="mode-expert"]', (el) => el.getAttribute("aria-pressed"));
  if (pressed === "true") break;
  await new Promise((r) => setTimeout(r, 500));
}
await page.waitForSelector("#adv-topn", { timeout: 15000 });
const setField = async (id, value) => {
  await page.waitForSelector(`#${id}`, { timeout: 15000 });
  await page.focus(`#${id}`);
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await page.keyboard.type(String(value));
  await page.keyboard.press("Tab"); // blur-commit
};
await setField("adv-topn", 30);
await setField("adv-uptime", 1000);
await page.waitForSelector('[data-testid="adjustments-panel"]', { timeout: 15000 });

const rows = await page.$$eval('[data-testid^="adjustment-"]', (els) => els.length);
if (rows < 2) fail(`expected ≥2 adjustment rows, got ${rows}`);

const { scrollWidth, innerWidth } = await page.evaluate(() => ({
  scrollWidth: document.documentElement.scrollWidth,
  innerWidth: window.innerWidth,
}));
if (scrollWidth > innerWidth) fail(`horizontal overflow at 375px: scrollWidth ${scrollWidth} > viewport ${innerWidth}`);
else console.log(`OK: no horizontal overflow (scrollWidth ${scrollWidth} ≤ viewport ${innerWidth}, ${rows} adjustment rows)`);

if (consoleErrors.length) fail(`browser console errors: ${consoleErrors.join(" | ")}`);

await browser.close();
if (errors.length) {
  console.error(`\n${errors.length} assertion(s) failed`);
  process.exit(1);
}
console.log("advisor mobile acceptance: PASS");

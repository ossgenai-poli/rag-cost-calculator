// Headless end-to-end verification of the STATIC bundle (no backend).
// Drives the app with puppeteer-core against system Chrome.
import puppeteer from "puppeteer-core";
import { mkdirSync } from "node:fs";

const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const URL = process.env.APP_URL || "http://localhost:3100";

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
await page.setViewport({ width: 1440, height: 2400 });

const consoleErrors = [];
page.on("console", (msg) => {
  if (msg.type() === "error") consoleErrors.push(msg.text());
});
page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

// A request-failure watch: nothing should call /api/prices in static mode.
let apiCalled = false;
page.on("request", (r) => {
  if (r.url().includes("/api/prices")) apiCalled = true;
});

await page.goto(URL, { waitUntil: "networkidle0", timeout: 30000 });

await page
  .waitForFunction(() => !document.body.innerText.includes("Loading prices"), { timeout: 15000 })
  .catch(() => fail("app stuck on 'Loading prices' — never rendered results"));

const text = await page.evaluate(() => document.body.innerText);

// ---- Acceptance assertions ----------------------------------------------
// innerText applies CSS text-transform, so match case-insensitively.
const must = (re, label) => {
  if (!re.test(text)) fail(`${label}: expected to match ${re}`);
};
must(/RAG Cost Calculator/i, "title");
must(/Pricing updated/i, "freshness line");
must(/Estimated monthly cost/i, "headline metric");
must(/Total cost per 1,000 queries/i, "per-1k metric");
// Both build strategies present under their descriptive names.
if (!/Self-built/i.test(text) || !/Managed retrieval/i.test(text))
  fail("both build strategies (Self-built / Managed retrieval) not present");
// Managed retrieval is now fully priced from AWS's published rates (no longer
// "incomplete"). Assert the priced card is shown and the old framing is gone.
must(/AWS published rates|verified pricing/i, "managed-priced card (AWS published rates)");
if (/Pricing unavailable/i.test(text))
  fail("managed retrieval still shows 'Pricing unavailable' — it is priced now");
// crossover verdict + dominant lever callouts
if (!/self-host efficient|API wins in practice/.test(text)) fail("crossover verdict callout missing");
if (!/cost driver|Biggest cost/i.test(text)) fail("dominant-lever callout missing");
// token construction transparency
must(/Total model tokens/i, "token construction panel");

if (apiCalled) fail("static bundle called /api/prices — must NOT hit backend");

// charts present (Recharts renders <svg class="recharts-surface">): breakdown + crossover
const svgCount = await page.evaluate(() => document.querySelectorAll("svg.recharts-surface").length);
if (svgCount < 2) fail(`expected >=2 Recharts charts (breakdown + crossover), found ${svgCount}`);

// ---- Levers: numDocs raises total; IVF-PQ lowers vector-store cost --------
async function setNumberByLabel(labelText, value) {
  return page.evaluate(
    (labelText, value) => {
      const want = labelText.toLowerCase().trim();
      const candidates = [...document.querySelectorAll("label, span, div")].filter((n) => {
        const own = [...n.childNodes]
          .filter((c) => c.nodeType === 3)
          .map((c) => c.textContent)
          .join(" ")
          .toLowerCase()
          .trim();
        return own.startsWith(want);
      });
      for (const label of candidates) {
        let scope = label;
        for (let up = 0; up < 3 && scope; up++) {
          const input = scope.querySelector('input[type="number"], input:not([type])');
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
            setter.call(input, String(value));
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
          scope = scope.parentElement;
        }
      }
      return false;
    },
    labelText,
    value
  );
}

async function setAlgo(value) {
  return page.evaluate((value) => {
    for (const s of [...document.querySelectorAll("select")]) {
      const opts = [...s.options].map((o) => o.value);
      if (opts.includes("ivf_pq") && opts.includes("hnsw")) {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, "value").set;
        setter.call(s, value);
        s.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, value);
}

// The all-in total lives in the sticky summary strip ("$X /month") and the
// "Estimated monthly cost" card. Read the card's dollar value.
async function readTotal() {
  return page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find(
      (n) => /^estimated monthly cost$/i.test((n.textContent || "").trim()) && n.children.length === 0
    );
    const card = label?.closest("div.panel") || label?.parentElement;
    const m = card?.innerText.match(/\$([0-9,]+(?:\.[0-9]+)?)/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
  });
}
// Vector-store monthly cost from the cost-breakdown table row.
async function readVectorStoreCost() {
  return page.evaluate(() => {
    const row = [...document.querySelectorAll("tr")].find((tr) => /vector store/i.test(tr.textContent || ""));
    const m = row?.innerText.match(/\$([0-9,]+(?:\.[0-9]+)?)/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
  });
}

await setAlgo("hnsw");
await new Promise((r) => setTimeout(r, 300));
const totalBefore = await readTotal();
const bumped = await setNumberByLabel("Number of documents", 20000000);
await new Promise((r) => setTimeout(r, 300));
await setNumberByLabel("Avg tokens per document", 2000);
await new Promise((r) => setTimeout(r, 500));
const totalAfter = await readTotal();
console.log("total before bump:", totalBefore, "-> after:", totalAfter);
if (bumped && !(totalAfter > totalBefore)) fail(`numDocs bump did not raise total ($${totalBefore} -> $${totalAfter})`);
if (!bumped) fail("could not set numDocs — lever test inconclusive");

// At this large corpus, IVF-PQ must cost less than HNSW for the vector store.
await setAlgo("hnsw");
await new Promise((r) => setTimeout(r, 500));
const vsHnsw = await readVectorStoreCost();
await page.screenshot({ path: "docs/lever-hnsw.png" });

await setAlgo("ivf_pq");
await new Promise((r) => setTimeout(r, 500));
const vsIvf = await readVectorStoreCost();
await page.screenshot({ path: "docs/lever-ivfpq.png" });

console.log("VS $/mo  HNSW:", vsHnsw, " IVF-PQ:", vsIvf);
if (!(vsIvf <= vsHnsw)) fail(`IVF-PQ vector-store $/mo (${vsIvf}) should be <= HNSW (${vsHnsw})`);
if (vsIvf === vsHnsw) fail("HNSW vs IVF-PQ identical vector-store cost — lever not visible at this N");

// ---- Screenshot ----------------------------------------------------------
await setAlgo("hnsw");
await new Promise((r) => setTimeout(r, 400));
mkdirSync("docs", { recursive: true });
await page.screenshot({ path: "docs/screenshot.png", fullPage: true });
console.log("screenshot saved -> docs/screenshot.png");

console.log("\nconsole errors:", consoleErrors.length ? consoleErrors : "none");
if (consoleErrors.length) fail("browser console had errors");

await browser.close();

console.log("\n=== E2E RESULT:", errors.length ? `FAIL (${errors.length})` : "PASS", "===");
process.exit(errors.length ? 1 : 0);

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
await page.setViewport({ width: 1440, height: 2200 });

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

// Wait for the app to finish loading prices + rendering results.
await page
  .waitForFunction(
    () => !document.body.innerText.includes("Loading prices"),
    { timeout: 15000 }
  )
  .catch(() => fail("app stuck on 'Loading prices' — never rendered results"));

const text = await page.evaluate(() => document.body.innerText);

// ---- Acceptance assertions ----------------------------------------------
// innerText applies CSS text-transform, so match case-insensitively.
const must = (re, label) => {
  if (!re.test(text)) fail(`${label}: expected to match ${re}`);
};
must(/AWS RAG Price Calculator/i, "title");
must(/Prices as of/i, "freshness line");
if (!/Mode A/i.test(text) || !/Mode B/i.test(text)) fail("Mode A/B not both present");
must(/total/i, "total metric");
// crossover verdict text (either branch is acceptable)
if (!/self-host efficient|API wins in practice/.test(text))
  fail("crossover verdict callout missing");
// dominant lever callout
if (!/cost (driver|lever)|Biggest cost/i.test(text))
  fail("dominant-lever callout missing");

if (apiCalled) fail("static bundle called /api/prices — must NOT hit backend");

// charts present (Recharts renders <svg class="recharts-surface">)
const svgCount = await page.evaluate(
  () => document.querySelectorAll("svg.recharts-surface").length
);
if (svgCount < 2)
  fail(`expected >=2 Recharts charts (breakdown + crossover), found ${svgCount}`);

// ---- Exercise the HNSW -> IVF-PQ lever -----------------------------------
// Bump numVectors high enough to exceed the OCU floor, then compare algos.
async function setNumberByLabel(labelText, value) {
  return page.evaluate(
    (labelText, value) => {
      const want = labelText.toLowerCase().trim();
      // Find the label element whose OWN text (not descendants') matches, then
      // locate the input in the same field-row container.
      const candidates = [...document.querySelectorAll("label, span, div")].filter(
        (n) => {
          const own = [...n.childNodes]
            .filter((c) => c.nodeType === 3)
            .map((c) => c.textContent)
            .join(" ")
            .toLowerCase()
            .trim();
          return own.startsWith(want);
        }
      );
      for (const label of candidates) {
        // search the label, its container, and up to 2 ancestors for an input
        let scope = label;
        for (let up = 0; up < 3 && scope; up++) {
          const input = scope.querySelector('input[type="number"], input:not([type])');
          if (input) {
            const setter = Object.getOwnPropertyDescriptor(
              window.HTMLInputElement.prototype,
              "value"
            ).set;
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
    const selects = [...document.querySelectorAll("select")];
    for (const s of selects) {
      const opts = [...s.options].map((o) => o.value);
      if (opts.includes("ivf_pq") && opts.includes("hnsw")) {
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLSelectElement.prototype,
          "value"
        ).set;
        setter.call(s, value);
        s.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  }, value);
}

// read the Vector Store metric card ($/mo + OCU/RAM subtext) — the metric card,
// not the input-panel section header. It is the node containing "search OCU".
async function readVectorStore() {
  return page.evaluate(() => {
    const nodes = [...document.querySelectorAll("*")].filter(
      (n) =>
        /vector store/i.test(n.textContent || "") &&
        /search OCU/i.test(n.textContent || "") &&
        n.children.length <= 4
    );
    const card = nodes[nodes.length - 1];
    // innerText inserts line breaks between the card's block children, so the
    // "$X", "N search OCU", "G GB RAM" tokens stay separated.
    return card ? card.innerText.replace(/[ \t]+/g, " ").trim() : "";
  });
}
async function readTotal() {
  return page.evaluate(() => {
    const el = [...document.querySelectorAll("*")].find(
      (n) => /^total$/i.test(n.innerText?.trim() || "") && n.children.length === 0
    );
    // the dollar value is a sibling within the same card
    const card = el?.closest("div");
    const m = card?.parentElement?.innerText.match(/\$([0-9,]+(?:\.[0-9]+)?)/);
    return m ? parseFloat(m[1].replace(/,/g, "")) : NaN;
  });
}
// parse "$352.80 2.00 search OCU · 0.2 GB RAM" -> {dollars, ocu, ram}
const parseVS = (s) => {
  const d = (s.match(/\$([0-9,]+(?:\.[0-9]+)?)/) || [])[1];
  const ocu = (s.match(/([0-9.]+)\s*search OCU/i) || [])[1];
  const ram = (s.match(/([0-9.]+)\s*GB RAM/i) || [])[1];
  return {
    dollars: d ? parseFloat(d.replace(/,/g, "")) : NaN,
    ocu: ocu ? parseFloat(ocu) : NaN,
    ram: ram ? parseFloat(ram) : NaN,
  };
};

// Lift N well above the OCU floor so the algorithm choice is visible.
await setAlgo("hnsw");
await new Promise((r) => setTimeout(r, 300));
const totalBefore = await readTotal();
const bumped = await setNumberByLabel("Number of documents", 20000000);
await new Promise((r) => setTimeout(r, 300));
await setNumberByLabel("Avg tokens per document", 2000);
await new Promise((r) => setTimeout(r, 500));
const totalAfter = await readTotal();
console.log("total before bump:", totalBefore, "-> after:", totalAfter);
if (bumped && !(totalAfter > totalBefore))
  fail(`numDocs bump did not raise total ($${totalBefore} -> $${totalAfter})`);

await setAlgo("hnsw");
await new Promise((r) => setTimeout(r, 500));
const vsHnsw = parseVS(await readVectorStore());
await page.screenshot({ path: "docs/lever-hnsw.png" });

await setAlgo("ivf_pq");
await new Promise((r) => setTimeout(r, 500));
const vsIvf = parseVS(await readVectorStore());
await page.screenshot({ path: "docs/lever-ivfpq.png" });

console.log("numDocs bumped:", bumped);
console.log("VS(hnsw):", JSON.stringify(vsHnsw));
console.log("VS(ivf_pq):", JSON.stringify(vsIvf));
if (!bumped) fail("could not set numDocs — lever test inconclusive");
if (!(vsIvf.ram < vsHnsw.ram))
  fail(`IVF-PQ RAM (${vsIvf.ram}) should be < HNSW RAM (${vsHnsw.ram})`);
if (!(vsIvf.ocu <= vsHnsw.ocu))
  fail(`IVF-PQ OCU (${vsIvf.ocu}) should be <= HNSW OCU (${vsHnsw.ocu})`);
if (!(vsIvf.dollars <= vsHnsw.dollars))
  fail(`IVF-PQ $/mo (${vsIvf.dollars}) should be <= HNSW $/mo (${vsHnsw.dollars})`);
if (vsIvf.ocu === vsHnsw.ocu && vsIvf.dollars === vsHnsw.dollars)
  fail("HNSW vs IVF-PQ identical OCU AND cost — lever not visible at this N");

// ---- Screenshot ----------------------------------------------------------
await setAlgo("hnsw"); // restore for a representative screenshot
await new Promise((r) => setTimeout(r, 400));
mkdirSync("docs", { recursive: true });
await page.screenshot({ path: "docs/screenshot.png", fullPage: true });
console.log("screenshot saved -> docs/screenshot.png");

console.log("\nconsole errors:", consoleErrors.length ? consoleErrors : "none");
if (consoleErrors.length) fail("browser console had errors");

await browser.close();

console.log("\n=== E2E RESULT:", errors.length ? `FAIL (${errors.length})` : "PASS", "===");
process.exit(errors.length ? 1 : 0);

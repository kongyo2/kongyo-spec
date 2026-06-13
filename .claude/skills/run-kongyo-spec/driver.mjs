import { _electron as electron } from "playwright-core";
import * as readline from "node:readline";
import * as fs from "node:fs";
import * as path from "node:path";

const APP_DIR = path.resolve(import.meta.dirname, "../../..");
const SHOT_DIR = process.env.SCREENSHOT_DIR || "/tmp/shots";
const USER_DATA_DIR = process.env.USER_DATA_DIR || "/tmp/kongyo-userdata";
fs.mkdirSync(SHOT_DIR, { recursive: true });

const electronBin =
  process.platform === "darwin"
    ? path.join(APP_DIR, "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron")
    : path.join(APP_DIR, "node_modules/electron/dist/electron");

const SAMPLE = [
  "# Demo Spec",
  "",
  "Intro paragraph with **bold**, _italic_, ~~strike~~, `inline code`, and inline math $E = mc^2$.",
  "",
  "| Feature | Status |",
  "| --- | :---: |",
  "| GFM table | done |",
  "| Mermaid | done |",
  "",
  "- [x] Shiki syntax highlighting",
  "- [ ] Write your own spec",
  "",
  "### TypeScript (Shiki)",
  "",
  "```ts",
  "export function add(a: number, b: number): number {",
  "  return a + b;",
  "}",
  "```",
  "",
  "### Math (KaTeX)",
  "",
  "$$",
  "\\int_0^\\infty e^{-x^2}\\,dx = \\frac{\\sqrt{\\pi}}{2}",
  "$$",
  "",
  "### Diagram (Mermaid)",
  "",
  "```mermaid",
  "flowchart LR",
  "  A[Edit] --> B[Preview] --> C[Render]",
  "```",
  "",
].join("\n");

let app = null;
let page = null;

async function setMode(mode) {
  await page.evaluate((m) => {
    const want = m === "source" ? "Source" : "Preview";
    const btn = [...document.querySelectorAll(".mode-toggle button")].find((b) => b.textContent.trim() === want);
    if (btn) btn.click();
  }, mode);
}

const COMMANDS = {
  async launch() {
    if (app) return console.log("already launched");
    app = await electron.launch({
      executablePath: electronBin,
      args: ["--no-sandbox", "--disable-gpu", `--user-data-dir=${USER_DATA_DIR}`, APP_DIR],
      env: { ...process.env, DISPLAY: process.env.DISPLAY || ":99" },
      timeout: 45_000,
    });
    page = await app.firstWindow();
    try {
      await page.waitForSelector(".app", { timeout: 30_000 });
      console.log("launched. app ready. url:", page.url());
    } catch {
      console.log("launched but .app not found. windows:");
      for (const w of app.windows()) console.log(" ", w.url());
    }
  },

  async ss(name) {
    if (!page) return console.log("ERROR: launch first");
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + ".png");
    await page.screenshot({ path: f });
    console.log("screenshot:", f);
  },

  async new(title) {
    if (!page) return console.log("ERROR: launch first");
    const name = (title || "Demo Spec").trim();
    const before = await page.evaluate(() => document.querySelectorAll(".spec-item").length);
    await page.click(".new-spec-button");
    await page.waitForSelector(".modal-input", { timeout: 5_000 });
    await page.fill(".modal-input", name);
    await page.click(".modal-confirm");
    await page.waitForFunction(
      (prev) => {
        const items = document.querySelectorAll(".spec-item");
        const active = document.querySelector(".spec-item.active");
        return items.length > prev && !!active && active === items[0] && !!document.querySelector(".editor-input");
      },
      before,
      { timeout: 8_000 },
    );
    console.log("created + opened (source mode):", name);
  },

  async fill(text) {
    if (!page) return console.log("ERROR: launch first");
    await page.fill(".editor-input", text);
    console.log("filled editor:", text.length, "chars");
  },

  async mode(m) {
    if (!page) return console.log("ERROR: launch first");
    await setMode(m === "source" ? "source" : "preview");
    console.log("mode:", m);
  },

  async demo() {
    if (!page) return console.log("ERROR: launch first");
    await COMMANDS.new("Demo Spec");
    await page.fill(".editor-input", SAMPLE);
    await page.waitForTimeout(900);
    await COMMANDS.ss("demo-1-source");
    await setMode("preview");
    await page.waitForSelector(".markdown-body", { timeout: 10_000 });
    await page.waitForSelector(".shiki", { timeout: 10_000 });
    await page.waitForSelector(".katex", { timeout: 10_000 });
    try {
      await page.waitForSelector(".mermaid-block svg", { timeout: 20_000 });
    } catch {
      console.log("WARN: mermaid svg not found within 20s");
    }
    await COMMANDS.ss("demo-2-preview-top");
    await page.evaluate(() => {
      const el = document.querySelector(".preview");
      if (el) el.scrollTo(0, el.scrollHeight);
    });
    await page.waitForTimeout(400);
    await COMMANDS.ss("demo-3-preview-mermaid");
    await COMMANDS.probe();
  },

  async probe() {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate(() => ({
      app: !!document.querySelector(".app"),
      specs: document.querySelectorAll(".spec-item").length,
      pages: document.querySelectorAll(".page-item").length,
      md: document.querySelectorAll(".markdown-body *").length,
      shiki: document.querySelectorAll(".shiki").length,
      katex: document.querySelectorAll(".katex").length,
      mermaidSvg: document.querySelectorAll(".mermaid-block svg").length,
      mermaidErr: document.querySelectorAll(".mermaid-error").length,
    }));
    console.log("probe:", JSON.stringify(r));
  },

  async click(sel) {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return "NOT_FOUND";
      el.click();
      return "OK";
    }, sel);
    console.log("click", sel, "->", r);
  },

  async "click-text"(text) {
    if (!page) return console.log("ERROR: launch first");
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const el = els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return "NOT_FOUND";
      el.click();
      return "OK: " + el.tagName;
    }, text);
    console.log("click-text", JSON.stringify(text), "->", r);
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 20 });
  },
  async press(key) {
    if (page) await page.keyboard.press(key);
  },

  async wait(sel) {
    if (!page) return console.log("ERROR: launch first");
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log("found:", sel);
    } catch {
      console.log("TIMEOUT:", sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log("ERROR: launch first");
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log("ERROR:", e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log("ERROR: launch first");
    console.log(
      await page.evaluate((s) => (s ? document.querySelector(s) : document.body)?.innerText ?? "(null)", sel || null),
    );
  },

  async windows() {
    if (!app) return console.log("ERROR: launch first");
    for (const w of app.windows()) console.log(" ", w.url());
    const wcs = await app.evaluate(({ webContents }) =>
      webContents.getAllWebContents().map((w) => ({ id: w.id, type: w.getType(), url: w.getURL() })),
    );
    console.log("webContents:");
    for (const w of wcs) console.log(` [${w.id}] ${w.type}: ${w.url}`);
  },

  async quit() {
    if (app) await app.close().catch(() => {});
    app = null;
    page = null;
  },
  help() {
    console.log("commands:", Object.keys(COMMANDS).join(", "));
  },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync("/dev/stdin", "r") });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: "driver> " });

rl.on("line", async (line) => {
  const trimmed = line.trim();
  const idx = trimmed.indexOf(" ");
  const cmd = idx === -1 ? trimmed : trimmed.slice(0, idx);
  const arg = idx === -1 ? "" : trimmed.slice(idx + 1);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log("unknown:", cmd, "- try: help");
    return rl.prompt();
  }
  try {
    await fn(arg);
  } catch (e) {
    console.log("ERROR:", e.message);
  }
  if (cmd === "quit") {
    rl.close();
    process.exit(0);
  }
  rl.prompt();
});
rl.on("close", async () => {
  await COMMANDS.quit();
  process.exit(0);
});

console.log('Kongyo Spec driver - "help" for commands, "launch" to start');
rl.prompt();

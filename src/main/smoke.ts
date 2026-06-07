import { app, type BrowserWindow } from "electron";

const PROBE = `(async () => {
  const errs = [];
  window.addEventListener("error", (e) => errs.push(String(e.message)));
  window.addEventListener("unhandledrejection", (e) => errs.push("reject: " + ((e.reason && e.reason.message) || String(e.reason))));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const items = () => Array.from(document.querySelectorAll(".page-item"));
  const out = {
    app: !!document.querySelector(".app"),
    specs: document.querySelectorAll(".spec-item").length,
    pages: items().length,
    md: 0, shiki: 0, katex: 0, mermaidSvg: 0, mermaidErr: 0, errs: [],
  };
  let mermaidIndex = -1;
  for (let i = 0; i < items().length; i++) {
    items()[i].click();
    await sleep(700);
    out.md = Math.max(out.md, document.querySelectorAll(".markdown-body *").length);
    out.shiki = Math.max(out.shiki, document.querySelectorAll(".shiki").length);
    out.katex = Math.max(out.katex, document.querySelectorAll(".katex").length);
    if (document.querySelector(".mermaid-block")) mermaidIndex = i;
  }
  if (mermaidIndex >= 0) {
    items()[0].click();
    await sleep(700);
    items()[mermaidIndex].click();
    for (let t = 0; t < 30; t++) {
      await sleep(500);
      if (document.querySelector(".mermaid-block svg") || document.querySelector(".mermaid-error")) break;
    }
    out.mermaidSvg = document.querySelectorAll(".mermaid-block svg").length;
    out.mermaidErr = document.querySelectorAll(".mermaid-error").length;
  }
  out.errs = errs.slice(0, 6);
  return out;
})()`;

interface SmokeResult {
  app: boolean;
  specs: number;
  pages: number;
  md: number;
  shiki: number;
  katex: number;
  mermaidSvg: number;
  mermaidErr: number;
  errs: string[];
}

export function registerSmokeTest(window: BrowserWindow): void {
  window.webContents.on("console-message", (details) => {
    console.log(`[renderer:${details.level}] ${details.message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    console.error("[smoke] render-process-gone:", details.reason);
    process.exitCode = 1;
    app.quit();
  });
  window.webContents.once("did-finish-load", () => {
    setTimeout(() => {
      void window.webContents
        .executeJavaScript(PROBE)
        .then((raw: unknown) => {
          const result = raw as SmokeResult;
          const ok =
            result.app &&
            result.specs > 0 &&
            result.pages > 0 &&
            result.md > 0 &&
            result.shiki > 0 &&
            result.katex > 0 &&
            result.mermaidSvg > 0 &&
            result.mermaidErr === 0 &&
            result.errs.length === 0;
          console.log(`[smoke] ${ok ? "PASS" : "FAIL"}:`, JSON.stringify(result));
          if (!ok) process.exitCode = 1;
        })
        .catch((error: unknown) => {
          console.error("[smoke] eval failed:", error);
          process.exitCode = 1;
        })
        .finally(() => app.quit());
    }, 1500);
  });
}

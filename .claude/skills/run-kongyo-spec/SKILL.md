---
name: run-kongyo-spec
description: Build, run, and drive the Kongyo Spec Electron desktop app (a markdown spec editor with GFM, Shiki, KaTeX, Mermaid). Use when asked to run, start, launch, build, or screenshot the app, or to interact with its UI — create a spec, edit markdown, preview rendering, or verify shiki/katex/mermaid output.
---

Kongyo Spec is an Electron + React desktop markdown editor. It has a window,
so a headless agent drives it via the Playwright REPL at
`.claude/skills/run-kongyo-spec/driver.mjs`, launched under `xvfb`. The driver
launches the app, creates a spec through the real UI, fills the editor, flips to
Preview, and screenshots the rendered output. Launch takes ~10s and the app
loads the **built** renderer (`out/renderer/index.html`), so you must build
first.

All paths below are relative to the repo root (the unit directory).

## Prerequisites

```bash
apt-get update -qq
apt-get install -y xvfb libnss3 libgbm1 libasound2t64 libgtk-3-0 libxss1 \
  libxkbcommon0 libatk-bridge2.0-0 libcups2 libdrm2 libatk1.0-0 libatspi2.0-0
```

## Build

Run these in order. **`npm install` does not download the Electron binary in
this environment** (the postinstall is skipped), and `playwright-core` is not a
project dependency — both extra steps are required.

```bash
npm install
node node_modules/electron/install.js          # fetch the Electron binary (~216MB)
npm install --no-save playwright-core           # driver dependency; keeps package.json clean
npm run build                                    # builds out/main, out/preload, out/renderer
```

## Run (agent path)

Drive the app through the REPL under xvfb, wrapped in tmux so you can iterate
without relaunching the (slow) app:

```bash
rm -rf /tmp/kongyo-userdata                       # optional: clean slate (app starts empty)
tmux kill-session -t app 2>/dev/null
tmux new-session -d -s app -x 220 -y 55
tmux send-keys -t app 'xvfb-run -a node .claude/skills/run-kongyo-spec/driver.mjs' Enter
timeout 30 bash -c 'until tmux capture-pane -t app -p | grep -q "driver>"; do sleep 0.3; done'

tmux send-keys -t app 'launch' Enter
timeout 70 bash -c 'until tmux capture-pane -t app -p | grep -q "app ready"; do sleep 0.5; done'

tmux send-keys -t app 'demo' Enter                # full flow: create -> edit -> preview -> screenshots
timeout 60 bash -c 'until tmux capture-pane -t app -p | grep -q "probe:"; do sleep 0.5; done'
tmux capture-pane -t app -p | grep -vE '^\s*$' | tail -10
```

Screenshots land in `/tmp/shots/` (override with `SCREENSHOT_DIR`). `demo`
writes `demo-1-source.png`, `demo-2-preview-top.png`, `demo-3-preview-mermaid.png`
and prints a `probe:` line. A healthy run looks like:

```
probe: {"app":true,"specs":1,"pages":1,"md":277,"shiki":1,"katex":2,"mermaidSvg":1,"mermaidErr":0}
```

`shiki>=1`, `katex>=1`, `mermaidSvg>=1`, `mermaidErr==0` means the whole render
pipeline works. **Then actually open the PNGs and look** — a green probe with a
blank screenshot still means something's wrong.

### Commands

| command | what it does |
|---|---|
| `launch` | launch the app under xvfb, wait for `.app` |
| `demo` | create a spec, fill rich markdown, Preview, 3 screenshots, `probe` |
| `probe` | print JSON counts: app/specs/pages/md/shiki/katex/mermaidSvg/mermaidErr |
| `new [title]` | create a spec via the sidebar dialog (opens in Source mode) |
| `fill <text>` | replace editor content (single line; `demo` handles multi-line) |
| `mode <preview\|source>` | switch the toolbar mode |
| `ss [name]` | screenshot → `/tmp/shots/<name>.png` |
| `click <css>` | DOM click (via `el.click()`, not coordinates) |
| `click-text <text>` | click a button/link by its text |
| `type <text>` / `press <key>` | keyboard input |
| `wait <css>` | wait for a selector (10s timeout) |
| `eval <js>` | evaluate an expression in the page, print JSON |
| `text [css]` | print `innerText` of a selector (or the body) |
| `windows` | list windows + webContents |
| `quit` | close the app and exit the REPL |

Useful selectors: `.app`, `.spec-item`, `.page-item`, `.new-spec-button`,
`.modal-input`, `.modal-confirm`, `.editor-input`, `.mode-toggle button`,
`.markdown-body`, `.shiki`, `.katex`, `.mermaid-block svg`, `.toast`.

## Run (human path)

```bash
npm run dev      # electron-vite dev server + window; useless headless. Ctrl-C to quit.
```

`npm run dev` serves the renderer over `ELECTRON_RENDERER_URL` and opens a real
window — fine on a desktop, but there is nothing to see headless. Use the driver.

## Gotchas

- **`npm install` skips the Electron binary download** here. Without
  `node node_modules/electron/install.js`, launch fails with
  `spawn .../node_modules/electron/dist/electron ENOENT`.
- **The app loads the built renderer, not a dev server**, when the driver
  launches it (no `ELECTRON_RENDERER_URL` set). If you edit renderer code,
  re-run `npm run build` or the driver shows the old UI.
- **The app starts empty — there are no seed specs.** Seeding was removed, so on
  a fresh `--user-data-dir` the UI shows the empty state until you create a spec.
  `new`/`demo` create content; `rm -rf /tmp/kongyo-userdata` resets it.
- **`--no-sandbox` and `--disable-gpu` are required** in the container; the
  driver passes both. Electron's sandbox needs user namespaces that aren't there.
- **Mermaid renders asynchronously.** The driver waits up to 20s for
  `.mermaid-block svg`; `probe`'s `mermaidErr` count catches diagram failures
  that still leave the rest of the page intact.
- **There is no built-in headless self-check.** Validate rendering through the
  driver's `demo`/`probe` (counts of shiki/katex/mermaid in the live DOM).

## Troubleshooting

- **`spawn .../electron ENOENT`** → Electron binary not installed:
  `node node_modules/electron/install.js`.
- **`Cannot find package 'playwright-core'`** → `npm install --no-save playwright-core`.
- **Launch hangs / `.app` not found** → you skipped `npm run build`; `out/` is
  missing. Build, then relaunch.
- **`Missing X server` / cannot open display** → you forgot `xvfb-run`.
- **Stale Xvfb locks after a crash** → `rm -f /tmp/.X*-lock; pkill Xvfb`.
- **Driver REPL won't accept input** → run it inside tmux and use
  `send-keys` / `capture-pane`; Electron grabs stdin otherwise.

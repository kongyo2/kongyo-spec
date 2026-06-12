# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Kongyo Spec — AI 駆動開発のための仕様書 (spec) を書く Electron + React 19 + TypeScript のデスクトップ markdown エディタ。UI 文言・コミットメッセージ・コード内コメントは日本語で書く。

## コマンド

```bash
npm run typecheck    # tsc 2 構成 (node 用 + web 用) を両方検査
npm run lint:ci      # oxlint、CI と同条件 (--deny-warnings)。lint は warning を許す、lint:fix で自動修正
npm run format:check # prettier (*.md は対象外)
npm run build        # electron-vite build → out/
npm run dev          # dev サーバー + ウィンドウ (ヘッドレス環境では使えない)
```

- テストは存在しない。CI は typecheck / lint:ci / format:check / build の 4 つを実行する。変更後は同じ 4 つを通す (`npm run lint` だけでは warning を見逃して CI で落ちる)。
- アプリの起動・UI 操作・描画確認は `run-kongyo-spec` スキルを使う (ビルド済み renderer を読むので、renderer 変更後は再ビルドが必要)。

## アーキテクチャ

Electron 3 プロセス構成。renderer は sandbox 有効・Node 不可で、main との通信は preload が公開する `window.api` のみ。

- `src/shared/` — 両プロセスから参照される唯一の境界。`api.ts` の `KongyoApi` インターフェースと、`schemas/` の zod スキーマ (IPC 入力検証・LLM 応答検証・永続化形式がすべてここに集まる)。
- `src/main/` — ファイル I/O (`specsStore`)、スナップショット履歴 (`historyStore`)、設定 (`settingsStore`、node:sqlite + safeStorage で API キー暗号化)、LLM 呼び出し (`assist.ts`)。IPC チャネルは `ipc.ts` に登録 (例外: 終了時フラッシュの `app:flush-*` だけは `index.ts` の `createWindow` 内で登録)。
- `src/renderer/` — React UI。状態管理ライブラリはなく `App.tsx` が全状態のハブで、各パネルは props で受け取る。純粋ロジックは `lib/` に切り出す。

**IPC を追加する手順**: ① `shared/api.ts` にメソッド型 → ② 入力を取るチャネルなら `shared/schemas/` に zod パーサ → ③ `preload/index.ts` に `ipcRenderer.invoke` → ④ `main/ipc.ts` に `ipcMain.handle`。入力があるなら必ず zod parse を通す。`specs:list` のような入力なしチャネルに ② は不要。

**データモデル**: 仕様書と履歴はファイルベース (DB なし)。1 仕様書 = `userData/specs/<id>.md` (frontmatter 付き)。履歴は `userData/specs/history/<specId>/` に世代別 markdown。設定だけは SQLite (`userData/kongyo-spec.db`、settingsStore)。仕様書本文は H1/H2 見出しで「仮想ページ」に分割して表示する (`renderer/lib/pages.ts`)。画像は `specfile://` カスタムプロトコル経由で specs ディレクトリ内のみ配信。

**markdown パイプライン**: unified (remark-gfm / remark-math → rehype-katex / shiki) + mermaid。`renderer/lib/markdown.ts` の `renderCached` がページ単位でキャッシュする。

**LLM アシスト**: LLM 呼び出しは main プロセスの `assist.ts` に集約。プロバイダは 2 系統 — Gemini (`@google/genai`、ネイティブの responseSchema で構造化出力) と OpenAI 互換 API (`callOpenAiCompatible`、スキーマをプロンプトに埋め込み `response_format: json_object` を要求)。能力と失敗モードが異なるが、どちらの応答も最終的に `shared/schemas/assist.ts` の zod 検証を通る。プロファイル複数 + main/fallback ルーティング。機能名は織物メタファーで統一:

| 名前 | 役割 |
| --- | --- |
| Lens | 仕様レビュー (過剰具体 / 根拠なき断定 / 未決定事項の指摘 + 高度測定) |
| Loom (Weave) | 素材から仕様を織り上げ・織り直し |
| Warp | ユーザーストーリー + EARS・Mermaid 図への整形 |
| Tailor | 実装計画の生成と実装 AI への引き渡しプロンプト |
| Fray | 整合性検査 (LLM なしのローカル検出 `lib/fray.ts` + LLM audit) |
| Selvage | スナップショット履歴・差分・巻き戻し (LLM なし) |

新機能を足すときもこの命名系に合わせる。

## 実装の野心

実装には野心とクリエイティビティを存分に発揮してよい。新規タスク (ユーザーがゼロから始めるもの) では特に、自由度を活かして大胆に踏み込む。

スコープが曖昧なときこそ、価値の高いクリエイティブな一手を加える。

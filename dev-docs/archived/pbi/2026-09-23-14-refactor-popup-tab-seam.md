# PBI 2026-09-23-14 — popup active-tab 読取の一元化

**優先度**: 順位 14 / RICE 6.4（Reach 4 × Impact 1 × Confidence 80% ÷ Effort 0.5 人週）
**根拠**: `getCurrentTab()` helper・同一ファイル内の素 `chrome.tabs.query` ×2・場当たり hostname パースの 3 綴りが同居。単一 Seam 化で null-tab・不正 URL 扱いを 1 箇所に集め、約 30 テスト mock を収束させる。
**種別**: refactor（非機能追加）

## 背景

popup の active-tab identity＋URL に 3 つの綴りがある: `tabUtils.ts:10-14` の `getCurrentTab()` helper（`statusPanel.ts:308,337` の 2 importer＋約 30 テスト mock）、同一 `statusPanel.ts` 内の素 `chrome.tabs.query({active:true,currentWindow:true})` ×2（:383,403）、場当たり hostname パース（:406 の `new URL().hostname` vs :150/310 の `extractDomain`）。Seam は存在するが唯一経路でなく、null-tab 扱い・query flag・正規化が箇所ごとに drift する。

## 実装戦略

1. `tabUtils` を単一 Seam に深化する: `getCurrentTab()` を残し、`getActiveTabUrl()` / `requireActiveTabUrl()` 等の狭い Adapter を追加して query flag・null 契約・`extractDomain` 正規化を集中させる。
2. 2 素クエリと `new URL` 箇所を新 Seam 経由に寄せる。
3. popup 文脈専用に留める（`isRecordable` 系政策はアーカイブ済みのため吸収しない）。
4. null 時の panel-hide path の振る舞いが不変であることをテストで pin する。

## 受け入れ基準（BDD）

### シナリオ 1: tab 読取は 1 経路になる
- **Given** popup の active-tab 読取箇所
- **When** 全箇所を走査する
- **Then** 素クエリと独自 hostname パースが残っておらず、tabUtils Seam 経由に統一されている

### シナリオ 2: null・不正 URL の扱いが 1 箇所に集まる
- **Given** null tab と不正 URL
- **When** 各 Adapter を呼ぶ
- **Then** panel-hide を含む振る舞いが現行と同一である

### シナリオ 3: テスト mock が収束する
- **Given** 約 30 のテスト mock
- **When** 新 Seam に寄せる
- **Then** mock 対象が 1 Seam になり、全テストが緑である

## DoD（Definition of Done）

- [ ] 素クエリ 2 箇所と独自パース 1 箇所が新 Seam 経由になる
- [ ] null 時の振る舞いがテストで pin される
- [ ] `npm run type-check` / `npm run lint` / `npm test` が緑

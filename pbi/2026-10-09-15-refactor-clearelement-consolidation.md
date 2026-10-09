# 要素クリア規約の 2 系統分裂解消 — clearElement の utils 移設と dashboard 直書き統合（refactor）

## 1. タイトル + 種別

- **タイトル**: `clearElement` を `src/utils` へ移設して popup から re-export し、dashboard の `innerHTML = ''` 直書きを統合 + `check-innerhtml-escape.mjs` の TARGET_DIRS に dashboard を追加する（archloop-1007 台帳送り L1 のトリガー発火による消費）
- **種別**: refactor（挙動不変。空文字クリアと同一）
- **見積もり**: 2 SP

## 2. 優先度

- **優先度**: 順位 15
- **RICE**: R4 / I1 / C1.0 / E2 → **2.0**
- **根拠**:
  - dashboard の UI 改修頻度は高く（直近ラウンドで多数のパネルを改修）、規約の 2 系統分裂が「新パネルは規約順守 / レガシー dashboard は直書き＆無検査」として固定化している
  - archloop-1007 台帳送り L1 のトリガー「次に dashboard UI を触る時」が本ラウンドの dashboard UI 候補で発火するため、消費を早める目的で 2.0 群の先頭に配置（純 RICE 順からの逸脱として台帳に記録済み）
- **依存**: **なし**

## 3. ユーザーストーリー

**dashboard 実装の保守担当者として**、要素クリアが単一の `clearElement` seam に統一され、lint ゲートが dashboard も検査してほしい。なぜなら、`innerHTML = ''` の直書きが無検査で残っていると、新パネル層の「innerHTML を使わない」規約がレガシー層で空洞化し、規約違反が静かに増えるから。

## 4. 背景

`scripts/check-innerhtml-escape.mjs` のヘッダ（`:4-7`）は「Element clearing must use `clearElement` from `src/popup/domUtils.ts`」と宣言するが、`TARGET_DIRS`（`:13`）は `src/popup` / `src/privacy` のみで dashboard を管轄しない。実際に dashboard の本番コードが `innerHTML = ''` を直書きしており、`clearElement` は popup にしか存在しないため dashboard からは層違反なく使えない。対照的にパネル分割で新設された層は厳格な規約を守る（`src/dashboard/panels/PanelNotices.ts:36`「DOM writes are textContent + setAttribute only, never innerHTML」）。

archloop-1007 台帳送り L1 は dashboard の `innerHTML = ''` 13 箇所の `clearElement` 統一を「次に dashboard UI を触る時」のトリガーで予約していた。

該当箇所（全 file:line 検証済み）:

- `scripts/check-innerhtml-escape.mjs:13`（`TARGET_DIRS` = popup/privacy のみ）と `:4-7`（規約宣言）
- dashboard 直書き箇所（13 箇所）: `src/dashboard/trancoConsent.ts:131` / `src/dashboard/tagsPanel.ts:47,67,143` / `src/dashboard/domainFilterTagUI.ts:78` / `src/dashboard/aiTestProgressView.ts:24` / `src/dashboard/cleansingStatsView.ts:262,364` / `src/dashboard/cspSettings.ts:111` / `src/dashboard/cleansingFeedbackView.ts:77` / `src/dashboard/models-dev-dialog.ts:276,358`
- 併せて `src/dashboard/domainFilterTagUI.ts:173` の古い `setTimeout(0)` コメント修正（L1 の同梱対象）
- `src/popup/domUtils.ts:37`（`clearElement` 唯一の実装）
- 対比: `src/dashboard/panels/PanelNotices.ts:36`（新パネル層の規約コメント）

改善案: `clearElement` を `src/utils` へ移設（Element 引数のみで document/chrome に触れない純粋関数）し、`popup/domUtils` から re-export（既存の互換 shim 慣行に準拠）。dashboard の直書き箇所を `clearElement` へ差し替え、`check-innerhtml-escape.mjs` の `TARGET_DIRS` に `src/dashboard` を追加する。空文字クリアと同一のため挙動不変。移設先の新規 utils ファイルには `@layer` 宣言を付与し、統合側が SSOT リストに登録する（NN03 のゲート慣行）。

## 5. BDD シナリオ

### シナリオ 1: dashboard の直書きが clearElement に統一される

```gherkin
Given src/utils から clearElement がエクスポートされている
When dashboard の 13 箇所の要素クリアを確認する
Then すべてが clearElement を呼んでいること
And 各ファイルに innerHTML = '' の直書きが残っていないこと
```

### シナリオ 2: lint ゲートが dashboard を検査する

```gherkin
Given check-innerhtml-escape.mjs の TARGET_DIRS に src/dashboard が含まれている
When dashboard のいずれかのファイルに innerHTML = '' を再導入する
Then check-innerhtml-escape が違反として報告すること
```

### シナリオ 3: 既存の popup 互換が保たれる

```gherkin
Given src/popup/domUtils.ts が clearElement を re-export している
When 既存の popup / privacy の呼び出し元が import する
Then 変更なしで動作し、popup/privacy の既存テストが green であること
```

## 6. 受け入れ基準

- [ ] `clearElement` の実装が `src/utils` の新規ファイルへ移設され、`src/popup/domUtils.ts` から re-export されている
- [ ] dashboard の 13 箇所（`trancoConsent.ts:131` / `tagsPanel.ts:47,67,143` / `domainFilterTagUI.ts:78` / `aiTestProgressView.ts:24` / `cleansingStatsView.ts:262,364` / `cspSettings.ts:111` / `cleansingFeedbackView.ts:77` / `models-dev-dialog.ts:276,358`）が `clearElement` を使用している
- [ ] `scripts/check-innerhtml-escape.mjs` の `TARGET_DIRS` に `src/dashboard` が追加され、dashboard を含めて gate が pass する
- [ ] `src/dashboard/domainFilterTagUI.ts:173` の古い `setTimeout(0)` コメントが現状に合わせて修正されている
- [ ] 新規 utils ファイルに `@layer` 宣言が付与され、SSOT リストに登録されている
- [ ] popup / privacy の既存テストが無変更で green である
- [ ] 空文字クリアと同一の挙動が維持されている（外部挙動不変）

## 7. テスト戦略

1. **gate の安全網**: 移設・置換前に `npm run check-innerhtml-escape` を実行して現状 pass を確認し、TARGET_DIRS 拡張後に dashboard を含めて pass することを確認する
2. **既存テストの green 維持**: popup / privacy / dashboard のクリア処理を含む既存テストを無変更で通過させる
3. **移設の型・境界確認**: `clearElement` が document/chrome に触れない純粋関数であることを確認し、`@layer` 宣言と SSOT 登録を確認する
4. **validate green**: `npm run validate`（type-check + test）で全体通過を確認する

## 8. 見積もり

**2 SP** — utils 移設 + re-export + 13 箇所の置換 + gate スクリプトの TARGET_DIRS 拡張 + SSOT 登録。置換は機械的だが対象ファイル数が多い。

## 9. DoD

- [ ] 受け入れ基準 7 件すべて充足
- [ ] `npm run check-innerhtml-escape` が dashboard を含めて pass
- [ ] dashboard に `innerHTML = ''` の直書きが残っていない
- [ ] 新規 utils ファイルが `@layer` 宣言付きで SSOT に登録されている
- [ ] `npm run validate`（type-check + test）が green
- [ ] 外部挙動不変（クリア結果が現行と同一）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- archloop-1007 台帳送り L1 のトリガー発火による消費
- RICE 順位 15（R4 / I1 / C1.0 / E2 → 2.0）
- 依存: なし

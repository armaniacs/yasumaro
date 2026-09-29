# PBI: タグ設定パネルの死んだナビゲーション修正と RTL リストの正本一本化

種別: fix
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ5）。タグ設定パネルから履歴へ遷移する導線が production で繋がっていない実害と、RTL ロケール一覧の二重実装を解消する。

## ユーザーストーリー

ダッシュボードのタグ設定パネルでカテゴリボタンをクリックしても履歴パネルへ遷移せず、画面上何も起きないユーザーとして、意図した panel-sqlite-history への遷移（searchTag 付き）が実際に起きる状態を目指す。同時に、RTL 対応言語の判定が 1 箇所に集約され、ckb / sd / ps でも正しく右向き表示になる状態を目指す。

## 優先度

- 順位: 2 / 10
- RICE スコア: 18.0（Reach=3 / Impact=3 / Confidence=100% / Effort=0.5）
- 根拠: タグクリックが無反応なのは主要導線が production で未接続という、ユーザーが即座に体感する機能停止である。修正は既に存在する seam（`navigateToHistoryWithTag`）の呼び出し 2 行置換で済み、既存 PBI（2026-09-24-13）で 6/8 パネルは移行済みという前例もある。RTL の二重実装は表面上は顕在化していないが、正本と乖離して silent に縮退しており、後続言語追加時に再発する。2 件とも変更ファイルが重複せず独立で、技術的リスクはいずれも低い。

## 現状と問題（file:line 証拠付き）

### 実害1: タグクリックが production で無反応

- `src/dashboard/tagsPanel.ts:52` と `:83` の 2 箇所が `document.dispatchEvent(new CustomEvent('navigate-to-tag', { detail: category }))` を発火する
- このイベントのリスナは production コードに 1 つも存在しない。`addEventListener` はテストのみ（`tagsPanel-r2.test.ts:368`、`tagsPanel.dom-integration.test.ts:239,255`、`navigateToHistory.test.ts:25`、`clusterGraphRenderer.test.ts:89`、`tagClusterPanel.keyboard.test.ts:84`）
- 正しい seam は既に存在する: `src/dashboard/panels/navigateToHistory.ts:12-16` の `navigateToHistoryWithTag(tag)` が `tryNavigateTyped('panel-sqlite-history', { searchTag: tag }, fallback)` を行う。6 パネルは既に移行済み
- 経緯: PBI `2026-09-24-13-refactor-navigate-to-history-helper`（アーカイブ済み、`pbi/00-INDEX.md:389`）は tagsPanel を「挙動保存のため現状維持（記録済み逸脱）」とした。しかし production リスナ不在 = クリック無反応という実害は当時の記録に含まれていない。本 PBI はこの逸脱を「実害あり」と反転させる判断を含む

### 実害2: RTL リストの二重実装

- `src/dashboard/dashboard.ts:75-81` の `setHtmlLangDir()` が独自リスト `['ar','he','fa','ur','ku','yi','dv']`（`dashboard.ts:79`）を持つ
- 正本 `src/utils/localeUtils.ts:40` は `['ar','he','fa','ur','yi','ckb','sd','ps']`。`ku` / `dv` と `ckb` / `sd` / `ps` が相互に欠落
- 正本を利用する `src/utils/i18n-dom.ts:161-166` の `setHtmlLangAndDir()` は既に存在し、`entrypoints/options/main.ts` からも使われている
- `dashboard.ts:87` の `setHtmlLangDir()` 呼び出しは、実行順により正本に隠れている実質 no-op の二重実行

## 改善方針（方向性）

1. `src/dashboard/tagsPanel.ts:52,83` を `navigateToHistoryWithTag(category)` への呼び出しに置換する（2 行変更）
2. `src/dashboard/dashboard.ts:75-81` の `setHtmlLangDir()` を削除し、i18n-dom / localeUtils の正本に一本化する。`initDashboard` からの呼び出し（`dashboard.ts:87`）も削除するか正本へ委譲する
3. 関連テスト（`tagsPanel-r2.test.ts`、`navigateToHistory.test.ts` 等）を新しい呼び出しへ追従させる

## BDD 受け入れシナリオ

```gherkin
Scenario: カテゴリクリックで履歴パネルに遷移する
  Given タグ設定パネルが表示されている
  When 既定カテゴリのボタンをクリックする
  Then panel-sqlite-history へ searchTag 付きで遷移する

Scenario: registry 未初期化時はフォールバック
  Given registry が未初期化（テスト環境）
  When カテゴリボタンをクリックする
  Then navigate-to-tag イベントが fallback として発火する

Scenario: ckb / sd / ps で RTL が効く
  Given locale が ckb のとき
  When ページを初期化する
  Then documentElement.dir が rtl になる
```

## 受け入れ基準

- [x] `src/dashboard/tagsPanel.ts:52,83` の `navigate-to-tag` dispatch が `navigateToHistoryWithTag` 呼び出しに置換されている
- [x] `src/dashboard/dashboard.ts` から独自 RTL リストと `setHtmlLangDir()` が削除され、RTL 判定は `src/utils/localeUtils.ts` の正本 1 箇所に集約されている
- [x] `ckb` / `sd` / `ps` が RTL 対象として正本で扱われ、`ku` / `dv` の扱いが意図として明文化されている（正本に含める場合はlocaleUtils.ts:40 側へ、含めない場合は根拠コメントとして残す）
- [x] `navigate-to-tag` のリスナが production コードに存在しないことを確認済みである旨がレビューで共有されている
- [x] PBI `2026-09-24-13` の「記録済み逸脱」判定が本 PBI で「実害あり」に反転されたことが記録されている

## テスト戦略

- 単体: tagsPanel の dispatch 置換に伴う既存テスト（`tagsPanel-r2.test.ts`、`tagsPanel.dom-integration.test.ts`、`navigateToHistory.test.ts`）の追従と更新
- 単体: `localeUtils` / `i18n-dom` の RTL 統合テスト（ckb / sd / ps を含む正本リスト全体）
- E2E: 不要（小規模でページ内導線の変更のみ）

## 見積もり

0.5 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録（2026-09-29）

### 変更ファイル

| ファイル | 変更 |
|----------|------|
| `src/dashboard/tagsPanel.ts` | `:52` / `:83` の `CustomEvent('navigate-to-tag')` dispatch を `navigateToHistoryWithTag(category)` 呼び出しに置換。`./panels/navigateToHistory.js` を import 追加 |
| `src/dashboard/dashboard.ts` | `setHtmlLangDir()` と `initDashboard` からの呼び出しを削除。ヘッダコメントの「language direction」記述を正本（`i18n-dom.ts`）への参照に更新 |
| `src/utils/localeUtils.ts` | RTL リストを和集合 `['ar','he','fa','ur','yi','ckb','sd','ps','ku','dv']` に統合し、理由コメントを付与 |
| `src/dashboard/__tests__/tagsPanel-r2.test.ts` | イベント発火の検証を `navigateTyped('panel-sqlite-history', { searchTag })` の検証に置換（偽 registry を `setRegistry` で注入、afterEach で破棄） |
| `src/dashboard/__tests__/tagsPanel.dom-integration.test.ts` | 既定カテゴリ / ユーザーカテゴリの検証を registry 経由の遷移に置換。registry 未初期化時に `navigate-to-tag` へフォールバックすることを確認するテストを 1 件追加（BDD シナリオ2） |
| `src/dashboard/__tests__/dashboard.test.ts` | 削除した `setHtmlLangDir` の import と 5 件のテストを削除（同等カバレッジは `i18n-dom` / `localeUtils` 側に集約済みのため） |
| `src/utils/__tests__/localeUtils.test.ts` | `ku` / `dv` のケースと、正本リスト全体（`ar`〜`dv` 10 種、地域付きも）を pin する `it.each` を追加 |
| `src/utils/__tests__/i18n-dom-branch.test.ts` | `ckb` / `sd` / `ps` / `ku` / `dv` で `documentElement.dir === 'rtl'` になる `it.each` を追加（BDD シナリオ3） |

### 検証

```
npx vitest run src/dashboard/__tests__/tagsPanel-r2.test.ts \
  src/dashboard/__tests__/tagsPanel.dom-integration.test.ts \
  src/dashboard/__tests__/dashboard.test.ts \
  src/dashboard/panels/__tests__/navigateToHistory.test.ts \
  src/utils/__tests__/localeUtils.test.ts \
  src/utils/__tests__/i18n-dom-branch.test.ts \
  src/utils/__tests__/i18n.test.ts
# → Test Files 7 passed (7) / Tests 221 passed (221)
```

内訳: tagsPanel-r2 14 / tagsPanel.dom-integration 18 / dashboard 24 / navigateToHistory 4 / localeUtils 59 / i18n-dom-branch 57 / i18n 45。

- `npx eslint <変更 8 ファイル>`: 指摘なし
- `npx tsc --noEmit -p tsconfig.json`: 残存エラーは `src/background/alarmRegistry.ts:60` と `src/background/dailyPurgeHandler.ts:31` の 2 件のみで、いずれも本 PBI と無関係な並行 WIP（PBI 2026-09-29-31 の audit log purge 追加）由来。本 PBI の変更ファイル由来のエラーはない

### 受け入れ基準 4 の確認（`navigate-to-tag` リスナ不在）

`src/` と `entrypoints/` の非テストコードで `navigate-to-tag` が出現するのは `src/dashboard/panels/navigateToHistory.ts:8,14`（doc コメントと fallback dispatch）のみ。`addEventListener('navigate-to-tag', ...)` はテストファイルにしか存在せず、production リスナはゼロ。全パネルの遷移が registry 経路に統一されたため、このイベントは registry 未初期化または `navigateTyped` が失敗した場合の fallback としてのみ発火する（テストと初期化前の breadcrumb 用）。

### 逸脱判定の反転

PBI `2026-09-24-13-refactor-navigate-to-history-helper`（アーカイブ）が tagsPanel を「挙動保存のため現状維持（記録済み逸脱）」とした判定は、本 PBI において**「実害あり」に反転**する。production にリスナが存在しない CustomEvent への dispatch は挙動保存ではなく機能停止（タグクリックが無反応）である。`navigateToHistoryWithTag` 内の fallback イベントは上述のとおり registry 未初期化/失敗時のみ発火するテスト breadcrumb として意図的に残す。

### 補足（未実施）

- `CHANGELOG.md` への追記と `pbi/00-INDEX.md` の更新は本 PBI のスコープ外（リリース時 / インデックス更新フェーズで扱う）
- 実害の修正はページ内導線のみで、Chrome 実機での手動確認は未実施


# PBI: 履歴パネルの削減率バーを欠測時も一貫表示する

## ユーザーストーリー
履歴を見る人として、削減率のバー表示を全エントリで一貫して見たい、なぜならTech CNNのようにバーだけ消えるエントリがあると不具合か仕様か判断できず混乱するから

## ビジネス価値
- 履歴パネルへの信頼を維持する。正常に見えるBBCエントリとバーなしのTech CNNエントリの差が「予期しない変化」に見える問題を解消する
- 測定方法: 欠測エントリでもバー領域が維持され理由が表示されること、正常エントリの表示が変わらないこと

## BDD受け入れシナリオ

```gherkin
Scenario: 欠測エントリでもバー領域が維持される
  Given コンテンツ抽出が計測なしの履歴エントリがある
  When 履歴パネルでそのエントリを見る
  Then 削減率バー領域が消えず理由付きで表示される
  And 正常エントリと同じ位置にバー領域が存在する

Scenario: 正常エントリの表示が変わらない
  Given バイト計測がある履歴エントリがある
  When 履歴パネルでそのエントリを見る
  Then 従来通りの削減率バーと数値ラベルが表示される

Scenario: 空ページでは対象なしと表示される
  Given 本文がないページの履歴がある
  When 履歴パネルでそのエントリを見る
  Then バー領域に計測対象なしの理由が表示される
```

## 受け入れ基準
- [x] `computeCleansingReduction` が null の場合もバー領域が消えない（プレースホルダー表示または理由ラベル付き表示）
- [x] AIなし記録と旧記録と空ページを既存3分類（`no-ai` / `unmeasured` / `empty`）の文言で区別する
- [x] 既存の正常エントリのバー表示が変わらない（数値ラベル・幅計算を維持）
- [x] 日英の両localeで文言が表示される（既存 `historyMissingReason*` 3 keyを再利用、新規keyなし）
- [x] XSS対策として理由文言と数値のescapeを維持する
- [x] バー領域は既存の診断行と同じ文字サイズとコントラストで読み取れる（`cleansing-progress-wrapper` 構造を維持）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 固定fixtureの欠測エントリでバー領域が存在することを確認
- 正常fixture（`long-page.html`）で従来通りのバーが表示されることを確認

### 統合テスト
- `formatDiagnosticMetadataHtml` が欠測時にバー領域HTMLを含む
- i18nのjaとenでkey解決できる

### 単体テスト
- `buildCleansingProgressBarHtml` が `page_bytes` 欠落時に空文字ではなく理由付きHTMLを返す
- `page_bytes` が0の場合に対象なし判定になる
- 正常バイトがある場合に従来通りの幅とラベルを返す
- 理由判定がescape済みHTMLを返す

## 実装アプローチ
- **Outside-In**: 受け入れシナリオに対応するViewテスト（`sqliteHistoryPanelView.test.ts`）から開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDDサイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2 （要チームでの見積もり）。内訳はバー欠測時の表示分岐と単体テストで1、View分岐とlocale追加と既存テスト更新で1

## 技術的考慮事項
- 依存関係: なし。履歴Viewの表示層のみの変更
- テスタビリティ: `buildCleansingProgressBarHtml` と `formatDiagnosticMetadataHtml` は純粋関数で検証できる
- 非機能要件: 追加クエリなし。既存entryのfield判定のみで描画するため性能影響なし
- i18n: 既存の `historyMissingReasonNoAi` / `historyMissingReasonUnmeasured` / `historyMissingReasonEmpty` を再利用し、新規key追加は最小限にする
- セキュリティ: 理由文言は定数とし、数値とprovider名は従来通りescapeHtmlを通す
- アクセシビリティ: バー領域は既存の `cleansing-progress-wrapper` と同じclassを使い、スクリーンリーダーで通常行と同様に読み上げできるようにする

## 実装者向け注記

### 現状コードの確認
着手前の必須チェックは本PBI作成時に実施済み（代行検索で合意済み）。未実装ではなく「欠測時は空文字を返す仕様」が原因であり、調査タスクではなく修正PBIとして扱う。

```bash
# 機能に関連するキーワードでコードを探す
grep -rn "computeCleansingReduction" src/
grep -rn "buildCleansingProgressBarHtml" src/
grep -rn "計測なし" src/ public/_locales/
```

確認結果:
- `computeCleansingReduction`（`src/dashboard/panels/asyncData/historyEntryPresentation.ts:35`）が `base` / `sentToAI` のいずれか欠落または `base === 0` のとき null を返す
- `buildCleansingProgressBarHtml`（`src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts:56`）が reduction null の場合に `''` を返し、`formatDiagnosticMetadataHtml`（同 `186-187`）は何も追加しないためバー領域ごと消える
- Tech CNNエントリは「コンテンツ抽出 — 計測なし」「Content Cleansing — 計測なし」のため null 経路に入り、BBCエントリ（数値あり）との差がスクリーンショットの不整合になる
- 前回PBI 2026-09-18-01 ではこのバー欠落を対象外と明記（同PBI `111` 行、`142` 行のなぜなぜ11番）。今回はその残課題を扱う
- 既存テスト `src/dashboard/panels/asyncData/__tests__/sqliteHistoryPanelView.test.ts:32-39` は欠測時に空文字を期待しており、仕様変更に伴い更新が必要

### 実装手順
1. `buildCleansingProgressBarHtml` の null 分岐を変更する。空文字ではなく、既存の理由分類（`classifyDiagnosticMissing` 系）を用いたプレースホルダーHTMLを返す。置き場所は現行のView関数を維持し、判定は `historyEntryPresentation.ts` に寄せる
2. プレースホルダーは既存の `cleansing-progress-wrapper` 構造を維持し、バー幅は最小表示または空トラック、ラベルに理由文言を入れる。CSSの追加は最小限にする
3. 既存テストを更新する。`sqliteHistoryPanelView.test.ts` の空文字期待2件を新仕様に合わせ、理由付き表示のケースを追加する
4. jaとenのmessages.jsonに不足keyがあれば追加する。既存 `historyMissingReason*` の再利用を優先する

### 落とし穴
- 削減率の定義（fallback連鎖）は `historyEntryPresentation.ts` が単一所有。View側に計算を複製しない
- `page_bytes` が0の場合は削減率を計算しない。0除算の回帰に注意する
- short-pageとover-cleansed-pageは理由表示の対象ではない。数値表示のままであることを回帰ガードする
- 理由文言にURLやタイトルなどの可変値を入れない。入れるとXSSの検査範囲が広がる

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする（単体3件＋統合3件、正常系の回帰含む）
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて — E2Eは既存fixture流用で追加なし、統合・単体は新規6件でカバー）
- [ ] コードレビュー完了（GitHub PR での approve を必須とする。セキュリティに関わる変更は CLAUDE.md「For Security Review Agents」節の観点確認をPR説明に明記）
- [x] リファクタリング完了（グリーン後 — wrapper構造の重複は意図的に維持し単一化による回帰を避けた）
- [x] ロールバック手段の検討（表示層のみの変更のため、`buildMissingReductionBarHtml` 分岐をrevertすれば従来表示に戻る）
- [ ] ドキュメント更新済み

## 実装記録
- `src/dashboard/panels/asyncData/sqliteHistoryPanelView.ts`: `buildCleansingProgressBarHtml` の null 分岐を `buildMissingReductionBarHtml` へ委譲。`classifyDiagnosticMissing` の3分類を再利用し、既存wrapper/track/label構造のまま理由ラベルを表示。`formatDiagnosticMetadataHtml` の条件分岐を除去（常に非空のため）
- `entrypoints/options/dashboard.css`: `.cleansing-progress-bar-missing` を追加（透明fillでトラックのみ表示）
- テスト: `sqliteHistoryPanelView.test.ts` の空文字期待2件を新仕様に更新＋legacy partial 1件追加、`sqliteHistoryPanel-formatDiagnosticMetadata.test.ts` に統合3件追加
- 検証: type-check PASS / asyncData 24 files 281 tests PASS / 全体 780 files 12253 tests PASS

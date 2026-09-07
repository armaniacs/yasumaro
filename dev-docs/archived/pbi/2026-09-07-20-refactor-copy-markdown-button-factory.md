# PBI: Copy-Markdown ボタンの dashboard ↔ popup 重複を factory に畳む

## ユーザーストーリー
clipboard 経由の entry 保存体験を保守する開発者として、entry → markdown 変換 → clipboard コピー → ✓/✗ 2 秒表示 → aria-label 更新という同一 4 ステップのボタン組み立てが dashboard と popup の 2 実装で重複しているのを 1 つの factory（深いモジュール）に畳みたい、なぜならコピー失敗時の表示・タイムアウト値・aria 更新の仕様変更が 2 箇所の同時更新になり、seam が存在しないため「clipboard ボタンの振る舞い」を 1 箇所で検証できないから

## 優先度
- 順位: 01 / 6（本ラウンド）
- RICEスコア: **20.0**（Reach=2 / Impact=0.5 / Confidence=100% / Effort=0.05人週）
- 根拠: 重複は 2 箇所のみで小粒だが、`copyTextToClipboard` の本番呼び出しは dashboard・popup のこの 2 箇所だけ（grep 11 ヒット中残りはテスト）。振る舞い不変で機械的に畳め、リスクが極小。本ラウンドのウォームアップ兼パイロット。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ 2 実装が重複したのか | dashboard（PBI 2026-09-05-14 由来）と popup（旧来）が別タイミングで同じ UX を実装し、共有 factory を作る seam が一度も設計されなかった |
| なぜ seam がないのか | 共通依存（`formatEntryToMarkdown` + `copyTextToClipboard`）は utils にあるが、ボタン組み立て（成功表示・復帰タイマー・aria）は呼び出し側に散在 — locality 欠如 |
| なぜ畳むべきか | deletion test で合格: factory を削除すると try/catch + setTimeout + aria 更新の定型約 30 行 ×2 が戻る = 本体の稼ぎがある |
| なぜ今か | 2026-09-07 round 2 診断で「dashboard↔popup 重複」として指摘。PBI 23（sqliteHistoryPanel 描画統合）と PBI 24（popup StatusStore）が同じファイル群を触るため、**先に小さな抽出を着地させておくと後続 2 PBI の競合面が減る** |
| 解の粒度 | `createCopyMarkdownButton(entry, { labelKeys, timeoutMs? })` factory を `src/utils/` に置き、dashboard は `📋` ボタン、popup は `Copy Markdown` を引数差分として生成 |

## BDD受け入れシナリオ

### Scenario: factory が clipboard コピーの 4 ステップを所有する
  Given `src/utils/copyMarkdownButton.ts` の `createCopyMarkdownButton` が存在する
  When entry を渡して生成したボタンをクリックする
  Then `formatEntryToMarkdown(entry)` の結果が `copyTextToClipboard` に渡され、成功時ボタン表示が成功表示（✓）に変わり `aria-label` が更新され、既定 2000ms 後に元の表示へ戻る

### Scenario: コピー失敗時に失敗表示へ切り替わる
  Given `copyTextToClipboard` が reject する環境（モック）
  When ボタンをクリックする
  Then 失敗表示（✗）に切り替わり、例外が呼び出し側に漏れず、タイマー後に元の表示へ戻る

### Scenario: dashboard と popup の両方が factory を使う
  Given 本番コードで `copyTextToClipboard` を直接呼ぶ箇所を grep する
  Then ヒットは `src/utils/copyMarkdownButton.ts` のみで、`sqliteHistoryPanel.ts` と `recordSession.ts` の直呼びは消えている

## 受け入れ基準
- [x] `src/utils/copyMarkdownButton.ts` に `createCopyMarkdownButton` factory が新設され、markdown 変換 + clipboard + 成功/失敗表示 + 復帰タイマー + aria 更新を所有する
- [x] `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:76-106`（`createCopyButton`）が factory 経由に置き換わり、`copyTextToClipboard` / `formatEntryToMarkdown` の直 import が消える
- [x] `src/popup/recordCurrentPage/recordSession.ts:290-329`（`showCopyMarkdownButton` + `buildEntryFromSaveResult` のボタン部分）が factory 経由に置き換わる
- [x] ラベル差（dashboard `📋` / popup `Copy Markdown`）と aria キー差が引数（`labelKeys`）で吸収されている
- [x] dashboard・popup の既存テスト（`sqliteHistoryPanel` 系、`recordSession` 系）が無修正で green（振る舞い不変）
- [x] factory の新規単体テストが成功/失敗/タイマー復帰の 3 ケース以上を覆盖
- [x] `npm run type-check` / `npm run lint` / dashboard + popup 関連テストが green

## テスト戦略
- 単体: factory の新規テスト（`src/utils/__tests__/copyMarkdownButton.test.ts`）— 成功・失敗・タイマー復帰・aria 更新
- 回帰: 既存の dashboard sqliteHistoryPanel テストと popup recordSession テストが無修正で green（import 経路変更のみ許容）
- 非対象: クリップボード API 自体のモック方式変更、markdown 形式の変更

## 実装アプローチ
1. `src/utils/copyMarkdownButton.ts` を新設。`createCopyMarkdownButton(entry, opts)` は HTMLButtonElement を返す純粋な DOM factory（chrome 依存なし → Layer 0/1 相当。`@layer` コメント付与）
2. dashboard 側: `createCopyButton` を factory 呼び出しに置換（entry → ボタン生成 → 既存コンテナへの append は現行のまま）
3. popup 側: `showCopyMarkdownButton` を factory 呼び出しに置換。`buildEntryFromSaveResult` は entry 生成ロジックとして残す（ボタン生成のみ移動）
4. 既存テストの import 経路を確認し、振る舞いが不変であることを vitest で検証

## 見積もり
0.5 pt（0.05 人週相当）

## 未解決事項
1. 成功/失敗表示の文案は現行どおり ✓/✗（絵文字）か、i18n キー化するか → 実装時に現行の文言を維持する方針で結論（i18n 化は既存キーがある場合のみ。新規キー追加はしない）
2. 復帰タイムアウト 2000ms を factory 引数にするか定数にするか → 定数（`COPY_FEEDBACK_RESET_MS`）として factory 内に置き、両呼び出し側の差がないことを確認してから固定

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `copyTextToClipboard` の本番直呼びが factory 1 箇所に集約されている（grep で確認）
- [x] 既存テスト無修正で green（import 変更のみ）
- [ ] コードレビュー完了（未実施：本タスクのスコープ外、別途レビュー依頼が必要）
- [x] `npm run type-check` / `npm run lint` / dashboard+popup テスト green

## 実装メモ
- 未解決事項 1（文案）: 現行文言を維持。新規 i18n キーなし。dashboard は `📋`/`✓`/`✗` + aria 3 種、popup は `Copy Markdown`/`Copied!`/`Copy failed`（aria なし、現行どおり）を解決済み文字列で注入
- 未解決事項 2（タイムアウト）: `COPY_FEEDBACK_RESET_MS = 2000` を factory 内定数化。両呼び出し側に差がなかったため固定値 + `timeoutMs?` 上書き可
- 引数設計: PBI 案の `labelKeys` ではなく解決済み文字列 `labels` + `className` で差分吸収。factory を chrome 依存なし（Layer 1）に保つため i18n 解決は呼び出し側に残す
- 検証: type-check パス、lint エラー 0（変更ファイルの警告なし）、`src/utils` 226 ファイル 4332 テスト・`src/popup` + `src/dashboard/panels/asyncData` 57 ファイル 1087 テスト green（既存テスト無修正）

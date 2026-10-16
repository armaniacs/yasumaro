# PBI: 設定インポートの単位不一致と返却・保存の strip 不一致を直す

## ユーザーストーリー
設定バックアップの利用者として、サイズ上限が文字種で素通ししたり、承認状態の表示と保存が食い違うことがあってほしくない。なぜなら前者は巨大ファイルの KDF 到達を許し、後者は原因不明の表示差になるから。

## 優先度
- 順位: 04 / 08
- RICEスコア: 36（Reach=15 / Impact=1.5 / Confidence=0.8 / Effort=0.5）
- 根拠: 日本語要約を多く含む輸出で単位差が効く。修正は2箇所の小変更。依存なし。

## 背景
adversarial-code-review (2026-10-16) の検証通過指摘 (保守 #12/#14)。反証で到達確認済み。
- `jsonData.length` (UTF-16 単位) を `DEFAULT_IMPORT_SIZE_CAP_BYTES` (バイト) と直接比較 (`src/utils/settingsExportImport.ts:261,651`, 上限定義 `src/utils/limits.ts:117`)。非ASCII 多用でバイト超過が素通しし VULN-034 の事前 cap 前提が崩れる。
- `setAll` には strip 済みを保存しながら返却は strip 前の `merged` / `parsed.settings` のまま (`:387-388,:715-716,:391-392`)。呼出元が見た `CONFIRMED_PROVIDER_ORIGINS` が実保存に存在しない。
- 却下済み関連: 未来版キー喪失（merge のため不成立）、v1 無署名（旧互換＋暗号認証あり）、ログ詳細なし（PII 設計）、privacy_mode 以外未検証（fail-open は privacy のみ）、undefined 上書き（到達不能）のため対象外。

## BDD受け入れシナリオ
Scenario: 非ASCII 巨大ファイルはバイト換算で拒否される
  Given 上限超のバイト数だが文字数では上限内の JSON
  When インポートする
  Then KDF 前にサイズ超過で拒否される

Scenario: 返却値と保存値が一致する
  Given `CONFIRMED_PROVIDER_ORIGINS` 付き設定のインポート
  When 完了する
  Then 返却値にも保存値にも承認状態が含まれない（両方 strip 済み）

## 受け入れ基準
- [x] サイズ判定がバイト換算（`TextEncoder` 等）で行われる
- [x] 3箇所の返却が保存値と一致する
- [x] `npx vitest run src/utils/__tests__/settingsExportImport` 系全緑

## テスト戦略
- 単体: 上記2シナリオの Red→Green
- 既存: import/export 系テストで回帰確認

## 見積もり
0.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）

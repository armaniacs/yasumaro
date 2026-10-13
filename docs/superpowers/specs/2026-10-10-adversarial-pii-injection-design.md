# adversarial指摘（PIIバイパス2件＋Markdown注入1件）是正デザイン

- 日付: 2026-10-10
- 出所: adversarial-code-review（全体レビュー、高リスク3領域×2視点の6並列発見＋5並列反証検証）
- 承認: §A（全体構成）/ §B（#1）/ §C（#2）/ §D（#3＋テスト戦略）すべてユーザー承認済み
- 台帳: `pbi/2026-10-10-01-backlog-adversarial-1010.md`

## 背景

adversarial-code-reviewの反証検証を通過（SURVIVES）した3件のみを対象とする。却下（REJECTED）された指摘（リダイレクト漏洩、DNSリバインディング、senderTrust、confirmToken等）は起票対象外。保守バッチ約130件は個別反証未実施のため不採用。

## 対象finding（いずれも配線を目視確認済み）

### #1: save経路の未マスク本文がクラウドAIへ送信される

- `src/background/handlers/recordingHandlers.ts:316-323` — SAVE_RECORDが生contentを`buildRecordRequest('save', …)`に渡す
- `src/background/recordRequestBuilder.ts:73` — saveポリシーが`alreadyProcessed: true`を付与
- `src/background/privacyPipeline.ts:185-186` — `_buildSanitizedSettings`は`useMasking`だけ`&& !alreadyProcessed`で落とし、`useCloudAi(mode !== 'local_only')`は残る
- `src/background/privacyPipeline.ts:162-164` — 未マスク`processingText`が`generateSummary`へ
- `src/utils/storage/defaults.ts:68` — 既定`masked_cloud`のため到達可能

### #2: 長トークン中間PIIの検出回避

- `src/utils/piiSanitizer.ts:57-69` — `sampleMiddleForScan`が100文字毎に末尾1文字を`#`に置換
- `src/utils/piiSanitizer.ts:287,305` — 検出は`scanText`上で実行
- `src/utils/piiSanitizer.ts:322` — 値は原文から切り出すため`#`を跨ぐPIIは未検出のまま素通り
- コメント（`:320-321`）の「影響しない」は境界跨ぎを見落とした誤読

### #3: タイトル改行によるMarkdown構造インジェクション

- `src/utils/markdownSanitizer.ts:151-160` — `sanitizeForMarkdownLinkText`は改行を処理しない
- `src/utils/markdownFormatter.ts:62-69` — `sanitizeTitle`も改行無処理（対照的にsummary `:75-81`は正規化、tag `:94`は除去）
- `src/utils/markdownFormatter.ts:174` — `- ts [title](url)`に割って入る（heading `:161`も同経路）

## 設計決定

- #1: saveポリシーから`alreadyProcessed: true`を削除する1行修正（案A）。機構自体は温存（pinテストが直接指定で回帰保護）。
- #2: `#`置換サンプリングを廃止し、原文の重なり付き分割走査（`CHUNK_SIZE=400`/`OVERLAP=200`）に置換（案A）。
- #3: `sanitizeTitle`で改行→空白に正規化（summaryと同一規則）。
- 実装順: RICE順 #1 → #3 → #2。編集ファイル非重複のため並列可、検証は`npm run validate`一括。

## 非目標

- REJECTED指摘の対応（hardening提案に留める）
- `alreadyProcessed`機構自体の削除（YAGNIに反せず温存。将来の正規「処理済み」呼び出し余地）
- PIIパターン自体の追加・変更

## テスト戦略

- 各PBIに再現テスト1件追加。既存テスト更新は#1の`recordRequestBuilder.test.ts`1件のみ。
- 実時間待ち禁止（`testDir/waitPolicy.ts`遵守）。
- 検証ゲート: `npm run validate`一括green。

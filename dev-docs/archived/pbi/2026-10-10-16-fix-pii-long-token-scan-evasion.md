# PBI: PII走査を重なり付き分割走査に置換し長トークン中間の検出回避を塞ぐ（TS＋Rust WASM）

- 種別: fix
- RICE: 2.7（R3 × I2 × C0.9 / E2.0。EはTask 4で発覚したWASM移植分を繰り入れ、当初1.0→2.0）
- 依存: なし（#1・#3とファイル非重複で並列可）
- バッチ: adversarial-1010
- 台帳: `pbi/2026-10-10-01-backlog-adversarial-1010.md`
- 追記（2026-10-10）: 本番はWASM優先・TSフォールバックのため、TS修正だけではWASM経路に回避が残る。Task 4のvalidateでparity 7件失敗として顕在化したため、Rustクレート（`wasm/pii-sanitizer/`）への移植を本PBIの範囲に含める。詳細はプランTask 5・6。

## ユーザーストーリー

プライバシー重視のユーザーとして、長い空白なしトークン（base64/JWT等）の中間に埋まったPIIも確実にマスクしてほしい。なぜなら現状はサンプリングの`#`置換を跨ぐPIIが未検出のままクラウドAIへ送られるから。

## 背景（現状・証拠）

- `src/utils/piiSanitizer.ts:57-69` — `sampleMiddleForScan`が100文字毎に末尾1文字を`#`に置換
- `src/utils/piiSanitizer.ts:287,305` — 検出は`scanText`（`#`混じり）上で実行されるため`#`を跨ぐPIIは正規表現に一致しない
- `src/utils/piiSanitizer.ts:322` — 値は原文から切り出すため、未検出PIIは生のまま残りAI送信される
- コメント（`:320-321`「`#`はどのパターンにも含まれないため影響しない」）は境界跨ぎを見落とした誤読
- 再現入力（nodeで同ロジック再現済み）: `'A'.repeat(150)+'user@example.com'+'B'.repeat(150)`系の空白なし長トークン
- 反証検証SURVIVES＋目視確認済み

## BDD 受け入れシナリオ

```gherkin
Scenario: 長トークン中間のPIIが検出・マスクされる
  Given 200文字超の空白なしトークンの中間にメールアドレス等のPIIが埋まっている
  When sanitizeを実行する
  Then PIIはマスクされ、生のまま残らない

Scenario: ReDoS耐性が維持される
  Given 巨大な空白なしトークンを含む入力である
  When sanitizeを実行する
  Then タイムアウト・件数制限の防御が効き、ハングしない
```

## 受け入れ基準

- [x] `neutralizeLongNonWhitespaceRuns`＋`sampleMiddleForScan`の`#`置換サンプリングを廃止する
- [x] 原文を重なり付きチャンク（`CHUNK_SIZE=400`・`OVERLAP=200`）で走査し、マッチ位置を原文オフセットにマップする
- [x] チャンク境界重複の二重検出をdedupeする
- [x] `timeout`・`MAX_MATCH_COUNT`チェックを維持する
- [x] 前提（200字未満の実体長を持つPIIは原理的に検出。emailの理論最大254字のうち200字超の極端例は残存リスクとして受容する。現行100字ウィンドウより大幅に改善）をコードコメントに明記する。将来200字超の bounded パターンを追加する際はOVERLAPを同時に見直す
- [x] 再現テスト（長トークン中間PIIの検出）を追加する
（2026-10-10 Task 6で確認: 旧関数名の残存なし・`SCAN_CHUNK_SIZE=400`/`SCAN_CHUNK_OVERLAP=200`・dedupe分岐・`timeout`/`MAX_MATCH_COUNT`維持・前提コメント有り・`npm run validate` exit 0）

## テスト戦略

- unit（新規）: 長トークン中間PII（email等）の検出・マスクテスト、境界条件（チャンク跨ぎ）テスト
- 既存: `piiSanitizer`関連テスト群がgreen（期待値の変更が必要な場合はPII検出の改善によるものか確認）
- 性能: 既存のtimeout系テストがgreen（ReDoS耐性の回帰ピン）

## 見積もり

2.0 SP（当初1.0。WASM移植分+1.0）

## 技術的考慮事項

- チャンク長上限400がReDoS耐性の根拠。`TOKEN_EDGE_KEEP_LENGTH`・`NON_WHITESPACE_RUN`定数は削除。OVERLAP=200は bounded パターン（最長のFR/IT IBAN系23字等）および200字までのemailをカバーする
- `matchedValue`の原文切り出し（`:322`相当）は維持し、置換インデックスずれを起こさない
- プライバシー保証: 改善（検出漏れの原理的解消）

## 実装者向け注記

### 実装手順

1. サンプリング関数を削除し、チャンク分割走査に置換（オフセット加算＋dedupe）
2. 前提コメントを記載
3. 再現テストを追加し、`npx vitest run`（piiSanitizer関連）で検証

### 落とし穴

- オーバーラップ幅を削らないこと（削ると同種の境界跨ぎ漏れが再発する）
- 200字超のPIIパターンを将来追加する場合はOVERLAPを同時に見直す（コメントに明記）
- 既存テストの期待値変更は「検出改善による正当な変化」か個別に確認する

## Definition of Done

- [x] 再現入力のPIIがマスクされる（2026-10-10 Task 4: `src/utils/__tests__/piiSanitizer.test.ts` 72/72 green — full `validate` run + targeted re-run）
- [x] timeout系テストがgreen（2026-10-10 Task 4: `src/utils/__tests__/piiSanitizer-redos.test.ts` 18/18 green — full `validate` run + targeted re-run）
- [x] `npm run validate`がgreen（2026-10-10 Task 6 second run: exit 0。Test Files 1053 passed / 1 skipped、Tests 15893 passed / 21 skipped。Task 4で失敗したparity 7件を含む全件green — Task 5のRust移植＋WASM再ビルド 7e328646 による。`npm run type-check` も exit 0。Task 4のBLOCKED注記は本runで解消）

# PBI: logger のサニタイザにキー名ベースの秘匿マスキングを接続する

種別: fix
状態: 実装済み（2026-09-29）

上流: 大局的コードレビュー 2026-09-29（テーマ1）。ログの秘匿マスキングが値のパターン照合に依存し、キー名という最も確実な手がかりを_logger 側で使っていない。

## ユーザーストーリー

ログの安全性を担保する開発者として、`addLog` に設定値オブジェクトを渡す側は「API キーの値を details に載せない」という記憶に頼らずに済む状態を目指す。うっかり `openai_api_key` を渡しても、出力側で機械的にマスキングされる。

## 優先度

- 順位: 3 / 10
- RICE スコア: 16.0（Reach=4 / Impact=2 / Confidence=100% / Effort=0.5）
- 根拠: 現状の漏洩 call site はゼロだが、防御が個々の call site の記憶に依存している。API キーは本リポジトリの最優先秘匿資産であり、フォールバック（ログ経由での流出）の厚みを boosting する変更は費用 0.5 SP に対して影響が大きい。Confidence=100% は、既存の共通マスキング器（`sensitiveDataMask`）が既に正しく動いているため。

## 現状と問題（file:line 証拠付き）

- logger のサニタイズ経路 `src/utils/logger/sanitize.ts:21-92`（`sanitizeLogDetails`）は、details オブジェクトの全文字列値に対して `sanitizeRegex`（PII 正規表現）と `neutralizeLogText` のみを適用する。import は `sanitize.ts:1-2`（`piiSanitizer` と `neutralize` のみ）で、`sensitiveDataMask` を使わない
- パターン照合側にも API キーの型がない: `src/utils/piiSanitizer.ts:76-193` の `PII_PATTERNS` は email / creditCard / myNumber / phoneJp / bankAccount / driverLicense / jpPassport 等の個人識別情報のみで、API key / bearer / token のパターンが存在しない。つまり値の形が何であれ「キー名」側は一切見ていない
- 一方、`src/utils/sensitiveDataMask.ts:16-40` の `LEVEL1_FIELDS` は API キー系（`src/utils/storage/apiKeyFields.ts:15-22` に列挙された `obsidian_api_key` / `gemini_api_key` / `openai_api_key` / `openai_2_api_key` / `provider_api_key` / `github_pat` は `settingsMigration.ts:356` の `API_KEY_FIELDS` 経由で取り込まれる）に加え、`apiKey` / `fullKey` / `authToken` / `auth` / `password` / `token` / `master_password_hash` / `hmac_secret` / `private_key` / `client_secret` 等を含む
- 同じファイルの `maskValue`（`sensitiveDataMask.ts:85-107`、LEVEL1 判定は `:90`）はキー名の部分一致（`lowerKey.includes(k)`）で値を `***`（partial）/ `[REDACTED]`（full）に置換する。しかし logger からは import されていない
- したがって秘匿の保証は呼び出し側記憶に依存する。`addLog` の呼び出しは 750 超（`rg addLog src` で 752 件 / 157 ファイル）あり、漏れは 1 箇所の追加だけで起きる
- 現行の漏洩 call site は grep 上ゼロ: `src/background/ai/providers/ProviderStrategy.ts:477-479` の `logApiKeySource` はキーの値ではなく解決元（source 名）しか出さない（本 PBI の主题は「いま漏れている」ではなく「漏れる余地を残さない」）
- 二重実装の整理は済んでいる: `src/utils/logMasker.ts:1-19` は `sensitiveDataMask` への deprecated shim であり、中身は 1 つの委譲だけ。SSOT は `sensitiveDataMask` 側にある

## 改善方針（方向性）

- `sanitizeLogDetails` に「キー名ベースの秘匿マスキング」段を追加する。`sensitiveDataMask` を import し、LEVEL1 相当のキー名に一致する値は型に関わらず `***` 等へ置換する（`maskSensitiveData(details, 'partial')` の再利用を基本とし、logger では PII 段と順序を固定する）
- 既存の不変条件を壊さない: null-prototype accumulator（`sanitize.ts:58-63` の `__proto__` 注入防御、`Object.create(null)`）と `MAX_RECURSION_DEPTH` による深度制限・循環参照保護（`sanitize.ts:38-44`）を維持する。マスキング段を追加しても「返り値の prototype が外部入力で re-point されない」ことを保つ
- `src/utils/logMasker.ts` は deprecated shim のまま触らない。SSOT を増やす方向ではなく-existing SSOT へ接続する
- 配列要素（`sanitizeArray`）の扱いを明示する。キーのない配列内のオブジェクトはキー名で判定できないため、既存 PII 段と中立制御バイトの除去に委ねる

## BDD 受け入れシナリオ

```gherkin
Scenario: API キー値がログに現れない
  Given details に `openai_api_key: "sk-test-..."` が含まれる
  When addLog で出力する
  Then ログ出力にキーの値が現れず、値が `***` 等にマスキングされる

Scenario: 既存 PII マスキングと併用できる
  Given details にメールアドレスと `github_pat` のような秘密キーが同時に含まれる
  When addLog で出力する
  Then 両方がマスキングされ、既存 sanitize のテストが green のまま通る

Scenario: キー名即是認の防御が機能する
  Given details に `token` / `master_password_hash` / `clientSecret` のような LEVEL1 相当キーが含まれる
  When 値が文字列・数値・null のいずれであっても出力する
  Then 値の型に関わらず秘匿としてマスキングされる
```

## 受け入れ基準

- [x] `sanitize.ts:1-2` の import に `sensitiveDataMask` が加わり、`sanitizeLogDetails` がキー名判定のマスキング段を持つ
- [x] LEVEL1 相当キー（`API_KEY_FIELDS` 由来 + `sensitiveDataMask.ts:16-40` の追加項目）の値が `addLog` 出力に現れない
- [x] null-prototype accumulator（`sanitize.ts:58-63`）と深度制限（`sanitize.ts:38-44`）が維持され、既存 sanitize のテストが変更なしで green
- [x] PII マスキング（`piiSanitizer`）と秘匿マスキングの両方が同じ details に適用され、順序が一意に決まる
- [x] `src/utils/logMasker.ts` が変更されていない（deprecated shim として単一委譲のまま）

## テスト戦略

- 単体: `logger/sanitize` のマスキング行列テスト。LEVEL1 キー名 × 値の型（string / number / null / undefined / ネストオブジェクト）で、期待する出力を表で固定する
- 回帰: null-prototype 防御（`__proto__` キー注入が prototype を汚さない）と深度制限・循環参照の既存テストが変更なしで green であることを確認
- 静的検証: `rg "sensitiveDataMask" src/utils/logger` が import 1 箇所を示すこと、`rg -n "logMasker" src/utils/logger` が 0 件であること
- 実装方針: 追加するマスキング段は `maskSensitiveData` の再利用で済ませ、個別のキーリストを logger 側に複製しない（DRY）

## 見積もり

0.5 SP

## Definition of Done

- [x] BDD シナリオに対応するテストがパスする
- [ ] `npm run validate` が通る
- [ ] コードレビュー完了

## 実装記録

### 変更ファイル

| ファイル | 内容 |
|---------|------|
| `src/utils/logger/sanitize.ts` | `sensitiveDataMask` の import 追加。`sanitizeLogDetails` のキー走査の最初段で `maskSecretValueByKey` を適用し、null/undefined の早期 return より**前**に置くことで「値の型に関わらず」マスクする。`sanitizeArray` に配列要素にはキー名が無い旨のコメントを追加 |
| `src/utils/sensitiveDataMask.ts` | 1 値単位の公開 API `maskSecretValueByKey(key, value)` を追加。`maskValue` と共有する判定点 `isLevel1Key` を切り出し、`'***'` を `LEVEL1_PARTIAL_MASK` として 1 箇所に集約。`API_KEY_FIELDS` の import 元を `storage/settingsMigration.js` から `storage/apiKeyFields.js` へ変更 |
| `src/utils/logger/__tests__/sanitizeKeyMasking.test.ts` | 新規。Level 1 キー 24 種 × 値の型 5 種のマトリクス（125 ケース）と、PII 併存・順序固定・ネスト・配列内オブジェクト・非対象キー素通し・null-prototype 防御の回帰、`maskSecretValueByKey` の契約テスト |

### 実行コマンドと結果

| コマンド | 結果 |
|---------|------|
| `npx vitest run src/utils/logger/__tests__/sanitizeKeyMasking.test.ts src/utils/logger/__tests__/sanitize.test.ts src/utils/__tests__/sanitize.test.ts` | 3 files / 142 tests passed |
| `npx vitest run src/utils/logger/__tests__ src/utils/__tests__/logger-enhanced.test.ts src/utils/__tests__/redaction.test.ts` | 8 files / 229 tests passed |
| `npx vitest run src/utils/__tests__/errorClassification.test.ts src/utils/__tests__/errorClassification-taxonomy.test.ts src/utils/__tests__/storage-security.test.ts src/utils/__tests__/storage-keys.test.ts` | 4 files / 76 tests passed |
| `npx vitest run eslint/__tests__/utils-layer-boundary.test.ts src/__tests__` | 6 passed / 1 skipped（145 passed, 11 skipped） |
| `npx eslint src/utils/logger/sanitize.ts src/utils/sensitiveDataMask.ts src/utils/logger/__tests__/sanitizeKeyMasking.test.ts` | 指摘なし |
| `npx tsc --noEmit` | 失敗（無関係な 2 件のみ。下記「残存課題」参照） |
| 静的検証 `grep -rn "sensitiveDataMask" src/utils/logger` | import 1 箇所（+ テスト 1 箇所） |
| 静的検証 `grep -rn "logMasker" src/utils/logger` | 0 件 |

### 設計判断（改善方針からの逸脱）

- **`maskSensitiveData` の一括再利用ではなく 1 値単位の API を新設した。** 一括で details 全体に適用すると、null-prototype accumulator・深度制限・循環参照保護・Date/Error 変換のすべてが既存の再帰を飛ばして壊れるため。既存の不変条件を守るにはキー単位の差し込みが不可避だった
- **`'partial'` 戦略ではなく「Level 1 は値の型に関わらず `***`」。** `partial` は文字列以外をマスクしないため、BDD シナリオ 3（null/数値も秘匿）を満たせない。型を問わずにマスクする点だけ `full` を採り、置換文字列はログ側の `***` にした
- **Level 2 は既存の PII 段の担当のまま。** キー名段で `email` を先に潰すと `u***@example.com` の部分マスクと `*_maskedTypes` 注記が失われるため、BDD シナリオ 2 の「既存 PII マスキングとの併用」を優先した
- **循環回避のための import 変更。** `sensitiveDataMask` が `settingsMigration` 経由で API キー一覧を読むため、そのまま logger から import すると `logger/sanitize → sensitiveDataMask → settingsMigration → logger/api → logger/core → logger/sanitize` の静的循環が成立し、読み込み順によっては `API_KEY_FIELDS` の TDZ 参照で logger 全体が初期化に失敗する。依存の無い正規モジュール `storage/apiKeyFields.ts` から読むようにし、リスト内容は同一（`API_KEY_FIELDS = asStorageKeys()`）のままにした
- **`maskSecretValueByKey` はマスクされなかったとき同一参照で値を返す契約**にした。logger 側はその `!==` 判定で通過を以降の段へスキップしており、この契約はテストで固定している

### 残存課題（レビュー判断事項）

- **共有マッチャの部分一致が logger にも波及する。** Level 1 に `auth` / `token` / `github_pat` が含まれるため、`author` や `authKind` のような無害なキーの値も `***` になる。これは SSOT（`sensitiveDataMask`）の既存仕様から継承したもので、logger 側で別の判定規則を足していない。他の利用者（`redaction` / `logMasker` / `errorClassification`）にも同じ挙動があるため、規則を変えるなら SSOT 側の課題として扱うこと
- **`npm run validate` は未実行**（本作業では指示により logger 周りのテストと型チェック・lint のみ実行）
- `npx tsc --noEmit` の残存 2 エラーは変更と無関係な既存エラー: `src/background/alarmRegistry.ts:60`（`"purgeAuditLog"` が `"archiveStatus"` に割当中）、`src/background/dailyPurgeHandler.ts:31`（`number | null | undefined` が `number` に割当中）。両ファイルは本 PBI の変更モジュールを import していない

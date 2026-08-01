# Adversarial Review 対応 PBI 実装計画 サマリ

> 本ドキュメントは `pbi/2026-08-01-*.md` の12件に対する個別実装計画の概要と並列実行可能性をまとめたもの。詳細は `docs/superpowers/plans/2026-08-01-NN-<slug>-plan.md` を参照。

---

## 並列実行可能性の凡例

- **高**: 他PBIへの依存がほぼなく、独立して実装・テストできる
- **中**: 共有ファイルはあるが、介在するインターフェースが安定していれば並列可能
- **低**: 同一ファイル・同一データ構造を大きく変更するため、直列または緊密な連携が必要

---

| PBI ID | タイトル | 主要実装ステップ | 並列実行可能性 | 備考 |
|---|---|---|---|---|
| 01 | Service Worker の init() を実際に呼び出す | 1. `entrypoints/background/index.ts` で `init()` 呼び出し<br>2. `service-worker.test.ts` にアラーム登録テスト追加<br>3. alarm handler の fire-and-forget を catch 付きに修正<br>4. 実ブラウザで Alarms タブ確認 | 中 | PBI-08 と `service-worker.ts` を共有するが、変更領域は分離可能 |
| 02 | 暗号化エンベロープの入力検証を強化 | 1. `isEncryptionEnvelope` に iterations/hash 許可リスト追加<br>2. `decryptEnvelope` に version 検証追加<br>3. salt/iv/data 長さ上限を追加<br>4. 異常ケースの単体テスト追加<br>5. `encryptedBackupService.test.ts` 統合テスト | 高 | `src/utils/crypto/index.ts` 内の独立した関数群の変更 |
| 03 | HMAC 署名鍵を暗号化して保存 | 1. 鍵暗号化用の KEK 導出方針決定<br>2. `getConsentHmacKey`/`getNotificationHmacKey` の保存を暗号化<br>3. 平文旧鍵のマイグレーション<br>4. `settingsExportImport.ts` の署名検証を定数時間比較に<br>5. 偽造テスト追加 | 低 | PBI-10（crypto 保守性）、PBI-02 と `src/utils/crypto/index.ts` を共有。マスターパスワード有無で設計が変わる |
| 04 | AI プロンプトのインジェクション対策を強化 | 1. `DEFAULT_USER_PROMPT` に区切り/ガード追加<br>2. `GeminiProvider` で `systemPrompt` を送信<br>3. `promptSanitizer.ts` の safe-context 抑制を修正<br>4. 多言語パターン拡張<br>5. `promptSanitizer-refined.ts` の統合・削除判断<br>6. E2Eテスト追加 | 中 | PBI-12 と `OpenAIProvider`/`GeminiProvider` を共有。プロンプト構造変更は出力品質に影響するため A/B 検証が必要 |
| 05 | VALID_VISIT の sender 検証とレート制限を強化 | 1. `service-worker.ts` の sender ゲートに `sender.url` スキーム検証追加<br>2. `createValidVisitHandler` にレート制限追加<br>3. `extractor.ts` で人間の閲覧判定強化（オプション）<br>4. 異常 sender/レート制限のテスト追加 | 中 | PBI-01 と `service-worker.ts` を共有。PBI-08 と `recordingLogic.ts`/`RecordingPipeline.ts` を共有 |
| 06 | 長いトークン内部の PII マスク漏れを修正 | 1. `neutralizeLongNonWhitespaceRuns` の置換戦略見直し<br>2. 中央部検出の実装（または `text` への別パス検出）<br>3. 長トークン PII の単体テスト追加<br>4. ReDoS/性能テスト追加 | 高 | `src/utils/piiSanitizer.ts` 内の局所変更。ただし PBI-04 とは `privacyPipeline.ts` を共有するが独立 |
| 07 | 非冪等な POST の 5xx 再送を防止 | 1. `RetryOptions` に `method` を追加<br>2. `defaultShouldRetry` で POST/PUT/PATCH の 5xx をスキップ<br>3. `OpenAIProvider`/`GeminiProvider` のカスタム `shouldRetry` 更新<br>4. テスト追加 | 高 | `src/utils/fetch.ts` とプロバイダーのみ。PBI-12 と連携しても競合は少ない |
| 08 | 記録状態のリソース管理と永続化を修正 | 1. `urlRecordMutexes` に完了後削除または LRU 追加<br>2. `RecordingLogic` と `RecordingPipeline` の二重 Mutex 整理<br>3. SW 起床時のキャッシュ復元<br>4. `privacyCache` session fallback の TTL 検証<br>5. `SessionStore` の強制フラッシュオプション追加 | 低 | `recordingLogic.ts`/`RecordingPipeline.ts`/`sessionStore.ts` を大きく変更。PBI-01, PBI-05 と `service-worker.ts`/`recordingLogic.ts` を共有 |
| 09 | fetch ユーティリティの検証と堅牢性を向上 | 1. `fetchWithTimeout` で `options.timeoutMs` を優先<br>2. タイムアウト判定を `error.name` ベースに<br>3. `isPrivateIpAddress` に IPv6 ブラケット正規化を追加<br>4. `isLocalhostAddress` を `localhost`/`127.0.0.1` に拡張<br>5. テスト追加 | 高 | `src/utils/fetch.ts` のみ。PBI-07, PBI-11 と連携可能 |
| 10 | 暗号化モジュールの保守性と堅牢性を向上 | 1. `SubtleCrypto.timingSafeEqual` の型捏造削除<br>2. `ENVELOPE_ITERATIONS` 等の定数を先頭へ移動<br>3. `needsRehash` ロジック修正<br>4. `isEncrypted` の厳密化<br>5. 平文 API キーの検出/警告/移行<br>6. `hashUrl` 衝突リスク軽減 | 中 | PBI-02, PBI-03 と `src/utils/crypto/index.ts` を共有。PBI-03 より先に実装すると競合を減らせる |
| 11 | Obsidian クライアントの堅牢性と整合性を向上 | 1. ポート既定値を 27123 に統一<br>2. `_validateHost` の IPv6 `::1` 許可<br>3. `response.text()` にタイムアウト追加<br>4. タイムアウトログ追加<br>5. dailyPath の URL メタ文字エンコード<br>6. vault 名指定または書込後パス検証 | 中 | PBI-09 と `src/utils/fetch.ts` を共有。`_validateHost` の IPv6 対応は PBI-09 と重複する可能性あり |
| 12 | AI プロバイダー間の整合性と診断を改善 | 1. `OpenAIProvider` に `recordUsage()` 呼び出し追加<br>2. `GeminiProvider` のタイムアウトを `AI_TIMEOUT_MS` に<br>3. `testConnection` のエラーハンドリング整理<br>4. Gemini 成功結果に `providerName`/`model` 追加<br>5. テスト追加 | 高 | PBI-04, PBI-07 とプロバイダーファイルを共有するが、変更領域は分離可能 |

---

## 推奨する並列実装グループ

### グループ A（優先・独立度高）
- PBI-01, PBI-02, PBI-06, PBI-07, PBI-09, PBI-12

### グループ B（中優先・一部依存）
- PBI-04, PBI-05, PBI-11

### グループ C（後回し・影響範囲広）
- PBI-03, PBI-08, PBI-10

### 依存関係に基づく順序
1. PBI-10 を先に完了させる（crypto モジュールの基盤整理）
2. PBI-02, PBI-03 を実装（crypto 強化）
3. PBI-01 を実装（SW 起動フロー）
4. PBI-08 を実装（recording 状態管理）
5. 残りを並列で実装

# PBI 2026-09-23-11 — Deprecated HMAC twins の削除

**優先度**: 順位 11 / RICE 25.0（Reach 5 × Impact 0.5 × Confidence 100% ÷ Effort 0.1 人週）
**根拠**: 生産呼び出し 0 の弱い crypto 双子の確定削除。sunset 2026-12-31 を待つ理由が blast radius ゼロで消滅。0.1 週のマイクロタスクで先に片付ける。
**種別**: refactor（非機能追加）

## 背景

`src/utils/crypto/hmacKeyStore.ts:436-479` の `generateHmacSignature` / `verifyHmacSignature`（いずれも `@deprecated`、sunset 2026-12-31）は正規 `HmacSigner`（`hmacSigner.ts`）と二重所有のままである。双子の手書き比較は length 不一致で早期 return する一方、正規 `primitives.constantTimeCompare` は `maxLength` ループで早期終了しない。`verifyHmacSignature` は全エラーを `false` に潰す一方、正規 `HmacSigner.verify` は失敗様式を区別する。grep によれば生産 importer は 0 件（`crypto/index.ts:47-48` の barrel 再 export と 4 テストファイルのみ）で、出荷呼び出しは `notificationHmacSigner` / `consentHmacSigner` に移行済み。

## 実装戦略

1. `grep` で生産 importer 0 を再確認する。
2. 2 関数と barrel 2 行を削除し、`HmacSigner` を唯一の署名 Seam にする。
3. 4 テストファイル（`crypto.test`、`hmacKeyStoreRestart`、`hmacKeyStoreConcurrency`、`service-worker` mock）を signer 移行または双子 parity ケース削除で更新する。
4. KEK 鎖（`deriveHmacWrappingKey`）・`durableKeyStore`・envelope 版語義には触れない。

## 受け入れ基準（BDD）

### シナリオ 1: 双子が消える
- **Given** crypto 層の公開署名 interface
- **When** 2 関数＋barrel 2 行を削除する
- **Then** 生産コードの参照が 0 件であり、`type-check` が緑である

### シナリオ 2: 署名の正しさは失われない
- **Given** `HmacSigner` の署名・検証テスト
- **When** 双子 parity ケースを整理する
- **Then** 正規 Seam のテスト網羅性は維持され、全テストが緑である

## DoD（Definition of Done）

- [x] 双子 2 関数と barrel 2 行が存在しない
- [x] 比較実装が `constantTimeCompare` 1 本になる
- [x] `npm run type-check` / `npm run lint` / `npm test` が緑

## 実装記録（2026-09-23）
- 生産 importer 0 を再確認して削除。4 テストファイルは HmacSigner へ 1:1 移行（ケース数維持）。KEK 鎖・durableKeyStore・envelope 版語義は不変。
- 検証: type-check / crypto 系 11 ファイル 334 テスト緑。

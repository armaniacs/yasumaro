# PBI: ループバックポート列が 3 重にリテラルで存在し相互照合テストが無い

## ユーザーストーリー

ローカル AI プロバイダを追加・保守する開発者として、ループバックポート列を 1 箇所に集約したい。manifest 権限 / CSP とランタイム検証が別のリテラルを持ち、追加方向によってはどの layer も落ちない silent break になるから。

## 優先度

- 順位: 6/32
- RICE: 8.0（R4 / I2 / C1.0 / E1）
- 根拠: 「権限はあるのに検証で拒否」（新ローカルプロバイダが動かない）もその逆も、どの層でも検出されない
- 依存: なし

## 背景（file:line 現状）

- `src/utils/cspDomains.ts:38` の `LOCAL_PORTS = [27123, 27124, 11434, 1234]`、`:50-60` の `buildLocalHostPermissions`、`:66-68` の `buildLocalConnectSrc`（manifest host_permissions / CSP connect-src を生成する列）
- `src/utils/ssrfGuard.ts:207` の `ALLOWED_LOCALHOST_PORTS = new Set([27123, 27124, 11434, 1234])`（ランタイムの URL 検証）。利用箇所は `src/utils/cspValidator.ts:285` と `:291`
- `testDir/e2e/fixtures/localServers.ts:22` の `PERMITTED_LOOPBACK_PORTS = [11434, 27123, 27124, 1234]`（E2E fixture 側の 3 コピー目）
- `src/utils/storage/providerDefaultBaseUrls.ts:13-14`: URL 文字列内に 1234 / 11434 を再記載
- テストは各リテラルを自己完結で pin するのみ: `src/utils/__tests__/cspDomains.test.ts:53`、`src/utils/__tests__/ssrfGuard.test.ts:77-82`（`ALLOWED_LOCALHOST_PORTS` 自身を反復する自己完結検証）。交差検証テストが存在しない

## BDD受け入れシナリオ

```gherkin
Scenario: ポート列の交差一致が保証される
  Given LOOPBACK_PORTS にポートが定義されている
  When buildLocalHostPermissions が生成するポート集合と ALLOWED_LOCALHOST_PORTS を比較する
  Then 両者が一致する（交差テストが green）

Scenario: 既存の公開 API が変わらない
  Given LOCAL_PORTS と ALLOWED_LOCALHOST_PORTS を import している既存コードがある
  When 集約後も同じ名前で import する
  Then 解決される値は同一で、ビルド出力も不変である

Scenario: E2E fixture も同一ソースを参照する
  Given localServers.ts の fixture
  When ポート列を参照する
  Then ハードコードではなく LOOPBACK_PORTS の import になっている
```

## 受け入れ基準

- [x] Layer 0 の `src/utils/loopbackPorts.ts`（`export const LOOPBACK_PORTS = [...] as const`）へ 1 集約されている
- [x] `cspDomains.ts` と `ssrfGuard.ts` は既存名（`LOCAL_PORTS` / `ALLOWED_LOCALHOST_PORTS`）を再エクスポートし、公開 API・ビルド出力とも不変
- [x] E2E fixture（`localServers.ts`）も import に置換されている
- [x] 交差テスト 1 本が追加されている（`buildLocalHostPermissions()` のポート集合と `ALLOWED_LOCALHOST_PORTS` の一致）
- [x] 既存 pin（`cspDomains.test.ts:53` 等）はそのまま残り green
- [x] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 交差テスト 1 本の追加。既存の個別 pin テストは維持
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: 新規 `src/utils/loopbackPorts.ts`（Layer 0、`// @layer 0` 付きで LAYERS.md 配置ルールに適合）、`src/utils/cspDomains.ts` / `src/utils/ssrfGuard.ts`（既存名の再エクスポート化）、`testDir/e2e/fixtures/localServers.ts`（import 化）、`src/utils/__tests__/cspDomains.test.ts`（交差テスト 1 本追加）
- ゲート: 対象 37 tests green（既存 36 + 交差 1）/ type-check PASS / lint 0 errors

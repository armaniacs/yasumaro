# PBI 08: limits drift ガードを吸収済み全値に拡張し 10MB 同族を解決

## ユーザーストーリー

上限を管理する開発者として、round 5 で取り込んだ約 20 値すべてが drift ガードの監視下にあり、10MB の同族 cap（import text / fetch body / AI response / envelope）の綴り揺れが 1 箇所に集約されることを望む。なぜなら現状のガードは 8 パターンのみを監視し、取り込み済みの残りが無防備だから。

## 優先度

- 順位: 08 / 9
- RICE スコア: 5.3（Reach=2 / Impact=1 / Confidence=80% / Effort=0.3 人週）
- 根拠（round 6 診断）: `limits-drift.test.ts:18-27` の CAPS は 8 パターンのみ。未吸収のまま: `systemHandlers.ts:74` MAX_FILTER_LIST_SIZE 10MB / `obsidianConfigValidator.ts:146` MAX_BODY_SIZE 10MB / `ProviderStrategy.ts:95` MAX_AI_HTTP_RESPONSE_BYTES 10MB（SSOT だが limits 未登録）/ `importPipeline.ts:12` DEFAULT_IMPORT_SIZE_CAP_BYTES 10MB（他 3 箇所の canonical）/ `crypto/envelope.ts:27` MAX_ENVELOPE_BASE64_LENGTH 10MB（暗号文 64MB と別層 — 文書化必要）。EXEMPT 各行に理由が無い箇所あり（ublockParser の同一 2 local など）。

## BDD 受け入れシナリオ

```gherkin
Scenario: 全吸収値がガード監視下にある
  Given limits.ts に取り込まれた約 20 値
  When drift ガードの CAPS 一覧を確認する
  Then 全値が pattern 登録されている

Scenario: 10MB 同族が単一来源から派生する
  Given import/fetch/body/AI response の 10MB cap
  When 消費者を確認する
  Then limits.ts（または明示的に文書化された別層）から import 参照である
```

## 受け入れ基準

- [x] CAPS を吸収済み全値に拡張
- [x] MAX_FILTER_LIST_SIZE / MAX_BODY_SIZE / MAX_AI_HTTP_RESPONSE_BYTES / DEFAULT_IMPORT_SIZE_CAP_BYTES を limits.ts へ移動（値不変・現 sites は再エクスポート）
- [x] envelope 10MB（pre-decode）vs 64MB（ciphertext）の別層をコメント明示
- [x] EXEMPT 各行に 1 行理由
- [x] check: drift ガード green

## テスト戦略

drift ガード拡張 + 全関連テスト green。

## 見積もり

S（0.3 人週）。種別: refactor。

## 実装メモ（2026-09-11 round 6）

- drift ガードの CAPS に `10MB family` パターンを追加（ガード自身が 3 件の未吸収を発見して吸収した）: MAX_FILTER_LIST_SIZE（systemHandlers）/ MAX_BODY_SIZE（obsidianConfigValidator）/ DEFAULT_IMPORT_SIZE_CAP_BYTES（importPipeline）/ MAX_ENVELOPE_BASE64_LENGTH（envelope）/ MAX_AI_HTTP_RESPONSE_BYTES（ProviderStrategy — SSOT 記載だが limits 未登録だった）/ STORAGE_QUOTA_BYTES（quota.ts）。値はすべて不変。
- envelope 10MB（pre-decode base64）vs 64MB（ciphertext）の層分離を limits.ts のコメントで明示。
- 「limits.ts actually defines」assertion を 15 定数に拡張。

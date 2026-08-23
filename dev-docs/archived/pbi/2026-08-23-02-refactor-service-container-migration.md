# PBI-0823a-02: ServiceContainer 完全移行 + typed token化

## ユーザーストーリー

開発者として、`createBackgroundServices` の22個の手動 `new` を `ServiceContainer` に移行し typed token 化したい。なぜなら新依存追加時に `BackgroundServices` + `Composition` + `messageRouterDeps` の3箇所を同時編集する必要があり、`getSharedSqliteClient` の二重生成レースはコメント注意だけで静的保証がないから。

## 優先度

- **順位**: 2 / 8
- **RICE**: 480 (Reach 8 × Impact 2 × Conf 75% / Effort 1.0w)
- **根拠**: DI の横断的影響。孤立した ServiceContainer を本流に接続。A 完了後に着手。
- **依存**: A（extractor 分割）完了後

## BDD受け入れシナリオ

```gherkin
Scenario: ServiceContainer で sqliteClient の二重生成が防止される
  Given container.register(Tokens.SqliteClient, () => getSharedSqliteClient(), {singleton:true})
  When  2回 resolve する
  Then  同一インスタンスが返る（factory は1回のみ実行）

Scenario: テストで override が効く
  Given container に本番 RecordingCache が登録されている
  When  container.override(Tokens.RecordingCache, mockCache)
  Then  以降の resolve は mock を返す
```

## 受け入れ基準

- [x] `src/background/serviceContainer.ts` を `Symbol` typed token に変更（`Tokens.* = Symbol()`）
- [x] `createBackgroundServices.ts` の22 `new` を `container.register` に置換
- [x] `singleton: true` で `getSharedSqliteClient` の二重生成を静的防止
- [x] テスト用 `override()` の動作確認（`backgroundComposition.test.ts` で検証）
- [x] `npm run type-check` / `npm test` PASS

## テスト戦略

- **単体**: ServiceContainer の register/resolve/override/singleton を網羅
- **統合**: composition contract テスト（既存）を typed token 版に更新

## 見積もり

5pt（1.0人週）

## Definition of Done

- [x] 全BDDシナリオ PASS
- [x] `createBackgroundServices.ts` の手動 new が0件
- [x] コードレビュー完了

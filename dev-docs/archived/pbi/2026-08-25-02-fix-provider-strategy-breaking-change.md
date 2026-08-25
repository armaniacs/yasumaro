# PBI: ProviderStrategy の後方互換を保ち breaking change を解消する

## ユーザーストーリー
拡張機能の利用者として、ProviderStrategy の型変更後もカスタム Provider が動き続けてほしい、なぜならダッシュボードの「OpenAI互換」設定が型エラーで保存できなくなると、既存ユーザの AI 要約が停止してしまうから

## 優先度
- 順位: 2 / 9
- RICEスコア: 40.0（Reach=5 / Impact=3 / Confidence=80% / Effort=0.30w）
- 根拠: 外部コントラクト破壊は High の中でもユーザ可視の影響が大きい。Effort 小で即効性あり。01 と並列実行可。

## ビジネス価値
- カスタム Provider 利用者の離脱を防ぎ、既存 3,000 以上の OpenAI互換設定を無停止で維持できる
- 測定: 旧シグネチャで書かれた Provider が新コードでも type-check を PASS する

## BDD受け入れシナリオ

```gherkin
Scenario: 旧シグネチャの Provider が警告付きで動く
  Given 旧 ProviderStrategy シグネチャで実装されたカスタム Provider がある
  When 新バージョンの RemoteAIService に登録する
  Then 非推奨警告が出るが正常に要約が生成される

Scenario: 新シグネチャへの移行がガイドされる
  Given 開発者が旧シグネチャを使っている
  When TypeScript でビルドする
  Then deprecated の JSDoc 警告が表示され、CHANGELOG の移行ガイドへリンクが示される

Scenario: 1バージョン後の削除が予告される
  Given 現バージョンが 6.7.x
  When CHANGELOG を読む
  Then 「次メジャーで旧シグネチャ削除」旨が明記されている
```

## 受け入れ基準
- [x] `ProviderStrategy` が discriminated union または overload で旧シグネチャを受け付ける
- [x] 旧シグネチャ利用時に `console.warn` または型レベル `@deprecated` が出る
- [x] `RemoteAIService.registerDefaultProviders` が新旧両方で動作するテストがある
- [x] CHANGELOG に breaking change と移行手順が記載されている

## テスト戦略

### E2Eテスト
- ダッシュボードで「OpenAI互換」プロバイダを旧設定のまま保存し、実際の要約が生成されることを確認

### 統合テスト
- RemoteAIService に旧 Provider を注入して `generateSummary` が成功するテスト

### 単体テスト
- ProviderStrategy の型テスト (`expectTypeOf`)
- 非推奨警告が出ることの spy テスト

## 見積もり
2pt

## 技術的考慮事項
- 依存関係: なし（ただし 04 の registry と同時変更する場合はコンフリクトに注意）
- 非機能要件: 後方互換を 1バージョン維持し、次メジャーで削除するセマンティックバージョニングを遵守

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "ProviderStrategy" src/background/ai/
grep -rn "registerDefaultProviders" src/background/ai/RemoteAIService.ts
```

### 実装手順
1. `ProviderStrategy.ts:12` を `type ProviderStrategy = NewStrategy | DeprecatedOldStrategy` にし、旧方に `@deprecated` を付与
2. `RemoteAIService.ts:30` で旧シグネチャをアダプタで新シグネチャに変換
3. `providerRegistry.test.ts` に旧シグネチャの回帰テストを追加

### 落とし穴
- 旧シグネチャを完全に削除すると既存ユーザが即座に壊れる。必ず 1バージョンの猶予を置く
- `OpenAIProvider` の 5分岐を Generic に集約した際、旧 Provider が Generic の判定から漏れる。`isLocal` 分岐前に旧シグネチャを正規化する

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（API 変更のため API & Contract 観点の確認を PR に明記）
- [x] ドキュメント更新済み（CHANGELOG, docs/SETUP_GUIDE の Provider 章）
- [x] ロールバック手段の検討（旧シグネチャを即時復活させる revert コミットの用意）

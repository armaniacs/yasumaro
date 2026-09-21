# PBI: createProviderStrategy の残留 if-chain を factory registry 化する

## ユーザーストーリー
開発者として、新プロトコルの provider を追加するときにファクトリ分岐を手編集せずに済ませたい、なぜなら catalog が 1行追加を主張する一方で createProviderStrategy に残留する if-chain が第二の編集点を強制し、追加漏れと分岐膨張の温床になるから

## 優先度
- 順位: 14 / 全体
- RICEスコア: 3.2（Reach=2 / Impact=1 / Confidence=0.8 / Effort=0.5週）
- 根拠: 種別は refactor で直接の利用者影響は小さいが、catalog 集約の仕上げとして分岐の二重所有を解消する。providerCatalog.ts を触る 2026-09-21-13・14 と同一ファイルのため直列実行が必要

## ビジネス価値
provider 追加コストが catalog への 1行追加に一致し、ファクトリ側の手編集が不要になる。分岐条件の見落としによる未知 provider の誤生成や特殊 provider の取り違えが構造的に起きなくなる (locality)

## BDD受け入れシナリオ

```gherkin
Scenario: 全7 provider が registry 経由で同一型を生成する
  Given PROVIDER_CATALOG に登録された全 providerId
  When registry 経由の factory と現行の createProviderStrategy で生成する
  Then 両者の生成インスタンス型が全 id で一致する

Scenario: 未知 provider は UnknownProviderError で失敗する
  Given catalog に存在しない providerId
  When createProviderStrategy を呼び出す
  Then UnknownProviderError が送出され generic provider は生成されない

Scenario: 新プロトコル追加が registry 登録のみで完了する
  Given 新プロトコル用の factory を registry に登録した状態
  When createProviderStrategy で該当 providerId を解決する
  Then if-chain への追記なしに対応する factory のインスタンスが返る
```

## 受け入れ基準
- [x] `createProviderStrategy` 内の `if (providerId === 'gemini')` / `if (providerId === 'built-in-ai')` 分岐が解体される
- [x] `PROVIDER_CATALOG` と同じ場所に `providerId → factory` の registry が置かれる
- [x] generic fallback が既定挙動として registry に組み込まれる
- [x] 全7 id が同一インスタンス型を生成することがテストで pin される
- [x] 未知 providerId は `UnknownProviderError` となり誤生成しない
- [x] 既存の catalog 解決と RemoteAIService の登録経路が green のままである

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善)

### 統合テスト
- catalog 全 id に対する factory 解決の型一致テスト: registry 経路と旧分岐経路の生成型を比較する pin テスト
- RemoteAIService の `registerDefaultProviders` 経由で全 provider が解決できること

### 単体テスト
- 特殊 factory (`gemini` / `built-in-ai`) が正しい具象型を返すこと
- generic id (`openai` / `openai2` / `lm-studio` / `ollama` / `openai-compatible`) が `GenericOpenAICompatibleProvider` を返すこと
- 未知 id で `UnknownProviderError` が送出されること

## 実装アプローチ
- **Outside-In**: 全7 id の生成型を pin するテストを先に書き、Red で registry を導入する
- `gemini` と `built-in-ai` の factory を registry 行に移し、残りを generic fallback の既定挙動にまとめる
- `createProviderStrategy` 本体は registry 参照のみに痩せさせる

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 2026-09-21-13・14 と対象ファイルが同一のため実行順は 14 の後(直列チェーンの最後)
- 遵守すべき方針: catalog を SSOT とし、provider 分岐知識を `providerCatalog.ts` の1箇所に集約する
- 非機能要件: 生成型の等価性を保ち、SSRF guard や truncation-limit key の受け渡し挙動を変更しない

## 実装者向け注記

### 現状の証拠
- 残留 if-chain: `src/background/ai/providerCatalog.ts:224-234` — `createProviderStrategy` が `if (providerId === 'gemini')` / `if (providerId === 'built-in-ai')` / fallback `new GenericOpenAICompatibleProvider(...)` の2分岐ファクトリ(コメント自身が if-switch を隠すと認識)
- 先行 registry パターン: `src/background/ai/RemoteAIService.ts:44-52` — catalog から Map registry を構築する `registerDefaultProviders` / `registerProvider`
- catalog 本体: `src/background/ai/providerCatalog.ts:63-187` — 全7 id (`gemini` / `openai` / `openai2` / `lm-studio` / `ollama` / `openai-compatible` / `built-in-ai`) の SSOT
- 乖離点: catalog 先頭コメント `src/background/ai/providerCatalog.ts:1-3` の 1行追加主張に対し、ファクトリ側の手編集が必須な状態

## Definition of Done
- 全BDDシナリオが実装されパスしている
- コードレビューが完了している
- 統合検証が green である

# PBI: 旧名エイリアスの新規利用を禁止し sunset を明記する

## ユーザーストーリー
開発者として、非推奨の旧名を新規コードで使えないようにしてほしい、なぜなら旧名のまま書き続けると移行が終わらず影響見積もりが曖昧になるから

## 優先度
- 順位: 10 / 13
- RICEスコア: 12（Reach=10 / Impact=1 / Confidence=80% / Effort=0.67）
- 根拠: 工数極小で移行完了への道筋が立つ。破壊なしの予防策

## ビジネス価値
将来の破壊的変更時の影響見積もりが正確になる

## BDD受け入れシナリオ

```gherkin
Scenario: 新規コードでの旧名 import は検出される
  Given 旧名での import を含む新規コード
  When lint を実行する
  Then 禁止として検出される

Scenario: 既存の旧名利用は動作し続ける
  Given 既存の旧名 import
  When ビルド・テストする
  Then 従来通り動作する
  And sunset 日がコメントで分かる
```

## 受け入れ基準
- [x] 旧名 import の新規利用が CI 検査で禁止されている（scripts/check-deprecated-aliases.mjs＋npm run check-deprecated-aliases、既存利用は grandfather 化）
- [x] ProviderStrategy・OpenAIProvider の @deprecated に sunset 日（2026-12-31 再評価）が明記されている
- [x] 既存利用の挙動が変わらない（type-check green、ガード OK）
- [x] 他の @deprecated（rateLimiter・crypto系）にも sunset 記載方針が適用されている（rateLimiter.removeTab・primitives.signWithHmac・hmacKeyStore.generateHmacSignature/verifyHmacSignature に sunset 追記）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要

### 統合テスト
- lint ルールが旧名サンプルを検出する

### 単体テスト
- 不要（静的検査のため）

## 実装アプローチ
- **Outside-In**: 検出テストから開始
- **Red-Green-Refactor**: 既存を壊さずに追加する

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: eslint カスタムルールまたは grep CI で検証
- 非機能要件: 既存コードの動作変更なし

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "@deprecated" src/background/ai/providers/ src/background/rateLimiter.ts src/utils/crypto/ | head -20
```

### 実装手順
1. 旧名サンプルの検出テストを書く
2. eslint ルールまたは CI 検査を追加する
3. 各 @deprecated に sunset 日を追記する

### 落とし穴
- 既存の旧名利用を一斉置換しないこと（本PBIは新規禁止＋期限明記のみ）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

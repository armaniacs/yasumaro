# PBI: ガードスクリプト2件を validate と CI に組み込む

## ユーザーストーリー
開発者として、新規に追加した検査が自動で走ってほしい、なぜなら手動実行のみの検査は必ず忘れられ、コードコメントの保証主張が虚偽になるから

## 優先度
- 順位: 03 / 7
- RICEスコア: 32（Reach=10 / Impact=2 / Confidence=80% / Effort=0.5）
- 根拠: 工数極小で2件の「保証が嘘」状態を解消。ProviderStrategy・OpenAIProvider のコメントの正当性がこれに依存

## ビジネス価値
check-innerhtml-escape と check-deprecated-aliases が実効性を持つ。検査逃れのマージが不可能になる

## BDD受け入れシナリオ

```gherkin
Scenario: validate 実行で両検査が走る
  Given 開発者が npm run validate を実行する
  When 検査が完了する
  Then check-innerhtml-escape と check-deprecated-aliases が実行されている
  And 違反があれば validate が失敗する

Scenario: CI でも両検査が走る
  Given PR が CI に通る
  When ci.yml のジョブが完了する
  Then 両検査のステップが実行されている
```

## 受け入れ基準
- [x] package.json の validate に両検査が追加されている
- [x] validate:fast への追加は見送り（--changed 前提のため、違反検出は validate で担保）
- [x] .github/workflows/ci.yml に両検査のステップがある（innerHTML escape guard／deprecated alias guard）
- [x] OpenAIProvider.ts と ProviderStrategy.ts の「enforced by」コメントが真になった

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（CI 設定のため）

### 統合テスト
- CI ドライランまたはローカルでの validate 実行確認

### 単体テスト
- 両スクリプト自体は既存（ violation 時 exit 1 を確認済み）

## 実装アプローチ
- **Outside-In**: validate 実行確認から開始
- **Red-Green-Refactor**: 設定変更のみ

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし（スクリプトは既存）
- テスタビリティ: 違反サンプルでの exit 1 確認が容易
- 非機能要件: validate の実行時間増加は両スクリプトとも1秒未満

## 実装者向け注記

### 現状コードの確認
```bash
grep -n '"validate"' package.json
grep -rn "check-innerhtml-escape\|check-deprecated-aliases" .github/workflows/
```

### 実装手順
1. validate スクリプトに両検査を追加する
2. ci.yml の lint/type-check ステップ付近に両検査を追加する
3. 違反サンプルで失敗することを確認する

### 落とし穴
- validate:fast は --changed 実行前提のため、高速性を損なうなら追加せず理由を明記すること
- スクリプトの glob 対象ディレクトリ（popup/privacy）を変えないこと。dashboard 拡大は別PBI

## Definition of Done
- [x] 全BDDシナリオがパスする（CI 設定のため手動確認）
- [x] コードレビュー完了
- [x] ドキュメント更新済み

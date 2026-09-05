# PBI: 閲覧履歴記録のデフォルト状態を検証・明示

## ユーザーストーリー
利用者として、閲覧履歴の記録が初回起動時はOFFであり記録中は常時可視であってほしい、なぜなら意図しない継続的記録はプロファイリングと受け取られ信頼を損なうから

## 優先度
- 順位: 10 / 26
- RICEスコア: 2,000（Reach=1000 / Impact=2 / Confidence=0.5 / Effort=0.5日）
- 根拠: 中核機能の倫理リスク全量がデフォルト状態と可視性に依存し、低工数で炎上リスクを低減できるため

## BDD受け入れシナリオ
```gherkin
Scenario: 初回起動時は記録がOFFである
  Given 新規インストール直後の状態である
  When  閲覧行動を行っても
  Then  明示的な開始操作があるまで記録が保存されない

Scenario: 記録中であることが常時可視である
  Given 記録が有効な状態である
  When  記録中にツールバーを確認する
  Then  actionバッジ等で記録中であることが分かる

Scenario: オンボーディングで記録範囲が説明される
  Given 初回起動でオンボーディングを表示した
  When  ウィザードの説明を確認する
  Then  記録範囲と開始方法が説明されている
```

## 受け入れ基準
- [ ] 初回起動時の記録ON/OFF状態が検証され、OFFでない場合はOFFに修正される
- [ ] 記録中はactionバッジ等で常時表示される
- [ ] オンボーディングで記録範囲の説明有無が確認され、不足時は説明が追加される
- [ ] 既存利用者の明示的な設定が意図せず上書きされない

## テスト戦略
- E2E: 新規プロファイルで初回起動し記録が保存されないこと、記録開始後にバッジが表示されること、オンボーディングに記録範囲の説明があることを確認する
- 単体: 記録関連のデフォルト値がOFFであること、バッジ更新条件分岐を検証する

## 実装アプローチ
記録ゲートのデフォルト値を確認し初回OFFを保証した上で、記録中のバッジ常時表示とオンボーディングでの記録範囲説明の不足分を補う

## 見積もり
0.5日

## 実装者向け注記
- 対象は`src/background/pipeline/RecordingOrchestrator.ts`周辺の記録ゲート、`src/popup/`（domainFilter等）の表示、`src/utils/storage/defaults.ts`の記録関連デフォルト値、`src/popup/onboardingWizard.ts`の説明文のみ
- 調査済み現状: `RecordingOrchestrator`自体にON/OFF状態を持たず記録可否は設定ゲートに委譲、`defaults.ts`では`PRIVACY_CONSENT=false`・`OBSIDIAN_ENABLED=false`・`CONTENT_STORAGE_ENABLED=false`・`AUTO_CONTENT_FETCH_ENABLED=false`・`ALLOW_ALL_URLS_OPT_IN=false`でOFF傾向だが初回起動時の実効OFFは未検証、`onboardingWizard.ts`に記録範囲の説明はなし、バッジは同意・フィルタ状態の表示のみで「記録中」の常時表示かは未検証
- 新規の記録方式追加や保存先の変更は含まない

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了

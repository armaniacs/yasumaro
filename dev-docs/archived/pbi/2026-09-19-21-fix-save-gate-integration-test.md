# PBI: 保存ゲート http_non_loopback_blocked の統合テストを追加する

## ユーザーストーリー
開発者として、保存ゲートの新規エラー経路がテストで守られてほしい、なぜなら配線ミス（host 未渡し・分岐順序）は isLoopbackHost の単体テストでは検出できず、TEST_RULE.md が UI 変更のテストを必須としているから

## 優先度
- 順位: 21 / 全候補3件中2位
- RICEスコア: 24（Reach=10 / Impact=1 / Confidence=80% / Effort=0.33）
- 根拠: TEST_RULE 違反の解消。ゲートは直前の実装であり回帰防止の価値が高い

## ビジネス価値
保存ゲートの回帰が CI で検出される。フィールドエラー表示の結合も検証される

## BDD受け入れシナリオ

```gherkin
Scenario: http＋LANホストの保存は拒否される
  Given protocol=http、obsidianHost=192.168.1.10
  When saveDashboardSettings を実行する
  Then 'http_non_loopback_blocked' で失敗する
  And 確認ダイアログは表示されない
  And host フィールドにエラーが設定される

Scenario: http＋loopback はゲートを通過する
  Given protocol=http、obsidianHost=127.0.0.1
  When saveDashboardSettings を実行する
  Then ゲートはエラーにならず確認ダイアログに進む
```

## 受け入れ基準
- [x] settingsPipeline.test.ts に非loopback拒否のテストがある（拒否・ダイアログ未表示・setFieldError 呼び出しを検証）
- [x] loopback 通過の既存テスト（http_confirm_cancelled）がゲート通過を担保していることを確認
- [x] fieldValidation モックに setFieldError を追加（未登録だと TypeError になる）
- [x] 全テストが green（16 passed）＋Red/Green 検証済み（ゲート破壊時に FAIL を確認）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（settingsPipeline の既存方針に従う）

### 統合テスト
- 保存経路のゲート分岐（本PBIの本体）

### 単体テスト
- isLoopbackHost は obsidianProtocolLoopback.test.ts で既存

## 実装アプローチ
- **Outside-In**: 保存結果アサーションから開始
- **Red-Green-Refactor**: ゲートを一時的に壊して Red を確認

## 見積もり
1ストーリーポイント未満（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: PBI 15 の前提
- テスタビリティ: setupInputs(protocol, host) が既存
- 非機能要件: 実装の obsidianConfigValidator はモックしない（実 isLoopbackHost を通す）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "http_non_loopback" src/dashboard/__tests__/settingsPipeline.test.ts
grep -n "setFieldError" src/dashboard/__tests__/settingsPipeline.test.ts
```

### 実装手順
1. fieldValidation モックに setFieldError を追加
2. 拒否テストと setFieldError アサーションを追加
3. Red/Green 確認（ゲートの hostValue 行を一時削除して Red）

### 落とし穴
- fieldValidation モックに setFieldError がないと、ゲート経路が TypeError で落ちる。テスト追加時に必ずモックを拡張すること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

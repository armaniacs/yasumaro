# PBI: import後処理（merge→strip→保存）の単一化とpipeline方針決定

## ユーザーストーリー
設定引っ越しの利用者として、device-localな承認状態が他端末へ持ち込まれてほしくない。なぜなら持込みは黙って送信先を信頼させるから。

## 優先度
- 順位: 01 / 12
- RICEスコア: 64（Reach=40 / Impact=2 / Confidence=0.8 / Effort=1.0）
- 根拠: trust持込みはsecurityに直結。依存なし。B2・C1と並列可。

## 背景
arch診断D1。`stripDeviceLocalSecurityState`が4箇所手呼び出しで順序が記憶頼み。`mergeWithExistingApiKeys`はsingleton直読み。`importPipeline.ts`は順序を標榜するが利用はテストのみで、暗号flowにdecryptの居場所がなく死んだ抽象。

## BDD受け入れシナリオ
Scenario: 持込み排除が1関数で保証される
  Given CONFIRMED_ORIGINS付きpayloadのimport
  When 後処理を実行する
  Then 保存・返却のどちらにも承認状態が残らない

Scenario: repoは注入できる
  Given fake repoを渡す
  When importする
  Then settingsRepositoryのmockなしに検証できる

Scenario: pipeline方針が文書化される
  Given 暗号flowの4段階 dehors
  When 方針を決める
  Then 拡張か格下げかがコードとコメントで一致する

## 受け入れ基準
- [x] merge→strip→保存が1関数に集約され、個別呼出しが残らない
- [x] repo/HMAC署名が注入可能で、持込み排除が純粋テストできる
- [x] pipelineの処遇が決定し文書化される

## テスト戦略
- 単体: 持込み排除の表テスト（Red→Green）
- 既存: settingsExportImport系で回帰確認

## 見積もり
2.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）

# PBI: migrationのPort一本化（裏口直叩きの撤去）

## ユーザーストーリー
鍵・salt形式変更の実装者として、storageへの触り方を一本化したい。なぜなら裏口が残るとPort差替だけではlegacy経路を試験できないから。

## 優先度
- 順位: 12 / 12
- RICEスコア: 5（Reach=15 / Impact=1 / Confidence=0.5 / Effort=1.5）
- 根拠: 最も将来向け。PBI 01・06と同領域だが引数化で独立。

## 背景
arch診断D3。Repositoryの動的import循環回避と、migrationのchrome直叩きが対になっている。

## BDD受け入れシナリオ
Scenario: 読むのはPortだけ
  Given legacy fallback
  When 実行する
  Then salt/secretは引数で渡り直叩きが残らない

Scenario: chrome mockなしで分岐再現
  Given InMemoryPort＋注入鍵
  When migration/decryptを実行する
  Then 分岐が再現できる

## 受け入れ基準
- [x] migrationのstorage直叩きがPort経由または引数化される
- [x] Repositoryの動的importの理由が減る（削減できた分）
- [x] migration系テスト全緑

## テスト戦略
- 単体: InMemoryPortによる分岐テスト
- 既存: migration系で回帰確認

## 見積もり
3.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）

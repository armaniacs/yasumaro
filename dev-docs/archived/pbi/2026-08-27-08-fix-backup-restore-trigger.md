# PBI: backupHandlers restore トリガー検証強化

## ユーザーストーリー
開発者として、DB 復元時に悪意あるトリガーが仕込まれた DB を検出したい、なぜなら `handleRestore` が `sqlite_master` 件数のみで検証し `CREATE TRIGGER` で永続的 RCE が可能になるから。

## 優先度
- 順位: 4 / 7
- RICEスコア: 270（Reach=20 / Impact=3 / Confidence=90% / Effort=0.20）
- 根拠: 永続的 RCE は重大 (Impact=3) だが restore は稀 (Reach=20)。検証ロジック追加で Effort 0.2。

## なぜなぜ分析
- なぜ検証が甘いか: `SELECT count(*) FROM sqlite_master` のみでトリガー有無を見ない
- なぜ気づかなかったか: 復元は正常 DB 前提でテストし、悪意ある DB を想定しなかった
- 解: `sqlite_master` で `type='trigger'` が 0件であることを検証し、存在すれば拒否

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常 DB は復元される
  Given トリガーなしの正当な DB ファイルを渡す
  When `handleRestore` を呼ぶ
  Then 検証を通過し DB が置換される

Scenario: 攻撃 — トリガー付き DB は拒否される
  Given `CREATE TRIGGER evil AFTER INSERT ON browsing_logs BEGIN ... END` を含む DB を渡す
  When `handleRestore` を呼ぶ
  Then `trigger detected` エラーで拒否される

## 受け入れ基準
- [x] `backupHandlers.ts` で `SELECT name FROM sqlite_master WHERE type='trigger'` が 0件であることを検証する
- [x] トリガー検出時に `validationError` で拒否される
- [x] 一時ファイルのサイズ検証が追加されている

## テスト戦略
- 単体: トリガーなし/ありの DB ファイルで `handleRestore` の成否を検証
- 統合: `restoreDb` → `insert` でトリガーが発火しないことを検証
- E2E: 不要

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

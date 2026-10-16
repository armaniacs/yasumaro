# PBI: headerDetector の生 URL ログを urlHash に寄せる

## ユーザーストーリー
プライバシー検出の利用者として、閲覧 URL（クエリ・トークン含む）が診断ログに素通しで残ってほしくない。なぜなら他経路は全てハッシュ化しているのに2箇所だけ生なのは不整合だから。

## 優先度
- 順位: 05 / 08
- RICEスコア: 32（Reach=10 / Impact=0.5 / Confidence=0.8 / Effort=0.125）
- 根拠: 発火は badge 失敗時のみで稀、外部送信の証跡なし。修正は2行。依存なし。

## 背景
adversarial-code-review (2026-10-16) の検証通過指摘 (ハッカー E)。反証＋自前配線確認済み。
- `logError('Failed to set privacy badge', { tabId, url: normalizedUrl, ... })` (`src/background/headerDetector.ts:206-210`) が `chrome.storage.local` の `sanitization_logs` に永続化される。`url` キー・URL 値はサニタイズ対象外のため素通しで残る。
- 同ファイルの他経路は全て `hashUrl` (`:86-87,105-107,120,142-143,148-153,259-260`)。`:192-195` の `logDebug` も生だが本番 no-op のため実害なし（ついでに寄せる）。
- 却下済み関連: evict 非同期・cap 全件取得・modelKey 番兵・badge クリア・log 形式等の保守指摘は意図動作・テスト pin のため対象外。

## BDD受け入れシナリオ
Scenario: badge 失敗ログに生 URL が残らない
  Given badge 更新が失敗する条件
  When 処理が走る
  Then 記録されるのは urlHash であり、生 URL 文字列は含まれない

Scenario: 正常系は従来通り
  Given 通常のヘッダー受信
  When 処理が走る
  Then 既存テスト緑（ログ内容の urlHash 方針不変）

## 受け入れ基準
- [x] 2箇所が生 URL でなく urlHash（または URL なし）を記録する
- [x] `npx vitest run src/background/__tests__/headerDetector` 系全緑

## テスト戦略
- 単体: ログペイロードに生 URL が含まれないことの Red→Green
- 既存: headerDetector 系テストで回帰確認

## 見積もり
0.25 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）

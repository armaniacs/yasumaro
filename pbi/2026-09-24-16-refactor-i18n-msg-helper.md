# PBI: msg() フォールバックヘルパーの集約

## ユーザーストーリー
パネル開発者として、i18n プレースホルダ付きフォールバックのヘルパーを1箇所で共用してほしい、なぜなら6パネルが同一実装を複製し、置換ルールの修正が6箇所に及ぶから。

## 優先度
- 順位: 8 / 8（着手順 16）
- RICEスコア: 6.0（Reach=6 / Impact=0.5 / Confidence=100% / Effort=0.5pt）
- 根拠: `msg(key, subs, fallback)`（getMessage + {name} 置換）が domainAnalysis/visitDuration/timeline/timeSlider 等6箇所に複製。依存: PBI 10/11/14 完了後の直列6番手（同一パネルファイル群の最終パス）。

## BDD受け入れシナリオ
Scenario: 翻訳キーが存在する
  Given キーが両 locale に定義されている
  When msg(key, subs, fallback) を呼ぶ
  Then 翻訳済み文字列に {name} が置換されて返る

Scenario: 翻訳キーが欠落する
  Given getMessage が空を返す
  When msg を呼ぶ
  Then fallback テンプレートの {name} が置換されて返る

## 受け入れ基準
- [ ] ヘルパーを src/utils/i18n.ts（Layer 適合位置）に export（getMessage と同居）
- [ ] 6パネルのローカル msg を削除して import に置換
- [ ] src/utils/i18n.ts の Layer 分類を確認（既存分類を維持・変更不要なら触れない）
- [ ] 既存テスト green（挙動不変の移動）

## テスト戦略
- 単体: ヘルパーの新規テスト（翻訳あり/なし・未知プレースホルダの扱い）
- 回帰: 対象パネルの lifecycle テスト（文言アサーション不変）

## 実装メモ
- 置換ルール: 未知の {name} はそのまま残す現行挙動を維持
- Layer 0 の i18n は chrome.i18n 参照のため分類に注意（既存 getMessage と同じファイルに置くため新規分類判断は発生しない想定、発生したら LAYERS.md を更新）

## 見積もり
0.5 SP（要チームでの見積もり）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（文書要件がある場合のみ適用）

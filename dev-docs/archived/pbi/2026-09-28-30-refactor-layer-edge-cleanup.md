# PBI: 層 edge 整備（protocol 値の中立層引き上げ・content reader・offscreen proof）

種別: refactor
状態: 実装済み（2026-09-28）

上流: 大局的コードレビュー 2026-09-28 テーマ4。層の向きを崩す直接依存を中立層へ寄せる。

## ユーザーストーリー

background の内部を restructuring する開発者として、dashboard が壊れる心配なくファイルを移動でき、content が契約外の読みをしなくて済む状態を目指す。

## 優先度

- 順位: 7 / 7
- RICE スコア: 4.0（Reach=5 / Impact=1.5 / Confidence=80% / Effort=1.5）
- 根拠: 現状動いており、壊れたときの影響は開発効率にとどまる。他の実害系 PBI の後に着手する

## 現状と問題（file:line 証拠付き）

- dashboard から background 実装への値 import: `src/messaging/dashboardGateway.ts:13` の `CURRENT_PROTOCOL_VERSION`（`../background/messageTypes.js` から）。`src/dashboard/dashboardSqliteService.ts:8` の protocol import も同型。background 側のファイル移動が dashboard を壊す
- content の blob 生読み: `src/content/contentKernel.ts:157-159` が `storage.get(['settings'])` で blob を直接読み、migration と default 補完をバイパスする。専用 World 制約で `SettingsRepository` の復号経路が通せないための迂回だが、PBI 28 の既定値分散の原因になっている
- offscreen 認可の形骸化: `src/offscreen/offscreen.ts:91` が認可 proof を同一スコープで手書き生成し（「型で強制する」とコメント）、`:35` の `_authorized` 引数は未使用。plain literal 型ゆえ任意の呼び出し側が生成でき、将来の迂回が既存パターンとして正当化される

## BDD 受け入れシナリオ

```gherkin
Scenario: dashboard が background 実装を import しない
  Given protocol 値などを `src/messaging/` の中立層へ引き上げる
  When `rg "from '\.\./background/" src/dashboard src/messaging` を実行する
  Then 値 import がゼロである（type-only は許容し、明示する）

Scenario: 認可 proof が生成箇所に限定される
  Given proof の生成を `authorizeSqliteSender` の戻り値に限定する（または主張コメントを削る）
  When offscreen の dispatch 経路を読む
  Then 手書き生成が存在しない、または「型強制しない」ことが正直に書かれている
```

## 受け入れ基準

- [x] dashboard/background 間の値 import が中立層経由になる（`messaging/protocol.ts` の活用を含む）
- [x] content 用の薄い設定 reader（migration 適用済み・復号なしの読み専用）を `storage/` 側が提供し、`contentKernel.ts:157-159` がそれを使う
- [x] offscreen proof の生成箇所限定または主張コメントの誠実化のいずれかが実施される

## テスト戦略

- 単体: content reader の migration 適用・既定値テスト。offscreen dispatch の既存テストが green
- 検証: 上記 BDD の `rg` による不存在確認

## 見積もり

1.5 SP

## Definition of Done

- [x] BDD シナリオに対応する確認が通る
- [x] `npm run validate` が通る

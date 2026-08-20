# PBI: MessageRouter — 19 handlerの浅い登録簿を深い Router moduleに

## ユーザーストーリー
開発者として、`dispatch(msg, sender) → Response` の1メソッドだけを知ればメッセージのルーティングが完結する深い `MessageRouter` module がほしい、なぜなら現在の `MessageHandlerRegistry` は `register(type, handler, trust, validator)` の薄い登録簿で、interface は19タイプ分の `trust` と `validator` の組み合わせを呼び出し元に露出し、実装は Map への put と `checkSenderTrust` 委譲のみで shallow で、真のバグは `VALID_VISIT` が `content-script-allowed` だが `DASHBOARD_SQLITE` が `extension-only` である等のポリシー漏れに潜み、テストは19タイプ×3送信元の網羅を registry 越しでしか検証できないから

## 優先度
- 順位: 05 / 05
- RICEスコア: 400（Reach=300 / Impact=1 / Confidence=80% / Effort=0.6）
- 根拠: Reachはメッセージ送信者（300/1000）、Impactは小（ポリシー漏れは既に59件テストでカバー）、Confidenceは `sqliteOperationSecurity.ts` の `tokenExempt` 導出パターンで高い、Effortは表の隠蔽で0.6人月。依存なしだが価値が最も低く最後に着手。

## なぜなぜ分析
- **疑問**: なぜ 19タイプ分の `trust` を呼び出し元が知る必要があるのか → なぜ: `trust` と `validator` の表が `createMessageHandlerRegistry` の呼び出し元に露出しているから
- **なぜ** ポリシー漏れが起きるのか → なぜ: 新しい handler 追加時に `trust` 指定を忘れるとコンパイルが通らないが、既存の `MessageValidator` 7個は registry と handler 本体の両方で mock するため locality が無いから
- **解**: `MessageRouter` の seam 背後に `trust` と `validator` の表を隠蔽し、`dispatch(msg)` の1 seam で完結させる

## BDD受け入れシナリオ
Scenario: ルーティングが1 seamで完結する
  Given 任意の `msg` と `sender`
  When `router.dispatch(msg, sender)` を呼ぶ
  Then 適切な handler が呼ばれ、`trust` と `validator` が正しく適用された `Response` が返る

Scenario: handler 追加時の trust 指定漏れが型で検出される
  Given 新しい `FOO_BAR` メッセージ型を追加する
  When `trust` を指定せずに `register` しようとする
  Then コンパイルエラーになる

Scenario: 19タイプ×3送信元の網羅が1 seamで検証できる
  Given 19メッセージ型 × 3送信元（content script / 拡張ページ / 外部拡張）
  When `dispatch` を呼ぶ
  Then 期待される `Response`（成功 / trust拒否 / validation失敗）が返る

## 受け入れ基準
- [x] `MessageRouter` の外部 interface が `dispatch(msg, sender)` のみに集約されている
- [x] `trust` と `validator` の表が Router 実装内に隠蔽されている
- [x] `checkSenderTrust` と各 `MessageValidator` が internal adapters に格下げされている
- [x] 既存の59件の trust 網羅テストと8 validator テストが `dispatch` 越しにパスする

## テスト戦略
- E2E: 実際の拡張で各メッセージ型の送受信を検証
- 統合: `MessageRouter` + 実 `MessageHandlerRegistry` で協調動作を検証
- 単体: 各 handler は `dispatch` 越しに間接的に検証。個別の handler 単体テストは内部テストに格下げ

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み
- [x] `createMessageHandlerRegistry` の19エントリ宣言表が Router 内に集約されている

## 補足
- `sqliteOperationSecurity.ts` の `tokenExempt` 導出パターンと同様に、trust 表の漏れを型で検出する。

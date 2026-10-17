# PBI: フォーカストラップのモーダル外 escape を塞ぐ

## ユーザーストーリー
確認ダイアログの利用者として、フォーカスが一度外に出たらトラップも Escape も効かなくなってほしくない。なぜなら閉じる手段を失ったモーダルに閉じ込められるから。

## 優先度
- 順位: 07 / 08
- RICEスコア: 10（Reach=20 / Impact=0.5 / Confidence=0.5 / Effort=0.5）
- 根拠: 発火には外側へのフォーカス移動が必要で、利用面は拡張ページ内ダイアログに限定。修正は束縛範囲の変更で影響確認が必要。依存なし。

## 背景
adversarial-code-review (2026-10-16) の指摘 (ハッカー contentUI 2件)。自前配線確認済み。
- `keydown` ハンドラを `modalElement` にだけ束縛 (`src/utils/ui/focusTrap.ts:167`) するため、外側フォーカス時の Tab/Escape は届かず、trap も `closeCallback` も発動しない。
- `handleFocusCycle` (`:57-83`) に再捕捉がなく、外側起点の Tab は素通しする（条件が `activeElement===first/last` の一致のみ）。
- 制約: 利用面は popup/dashboard の拡張ページ内ダイアログ（page JS は到達不能）のため深刻度は低。a11y 含みの hardening として扱う。

## BDD受け入れシナリオ
Scenario: 外側フォーカスでも Escape で閉じられる
  Given trap 成立後にフォーカスが外へ移動
  When Escape を押す
  Then `closeCallback` が呼ばれ、フォーカスが復元される

Scenario: 外側フォーカスの Tab はモーダルへ戻る
  Given 同条件
  When Tab を押す
  Then フォーカスがモーダル内の先頭へ戻る（背景を移動し続けない）

Scenario: 通常 trap は従来通り
  Given 既存の trap テスト
  When 実行する
  Then 全緑

## 受け入れ基準
- [x] 外側起点の Escape/Tab が処理される（document 束縛または focusin 再捕捉）
- [x] `npx vitest run src/utils/ui/__tests__/focusTrap.test.ts` 全緑（新規ケース含む）

## テスト戦略
- 単体: 上記シナリオの Red→Green（jsdom フォーカス操作）
- 既存: focusTrap 系テストで回帰確認

## 見積もり
1.0 SP（束縛範囲変更の影響確認を含む）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）

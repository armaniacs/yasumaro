# PBI: `#status`→`#statusTop` ミラー処理の重複を共通化

## ユーザーストーリー
コード保守者として、`showStatus` / `clearStatus` のミラー処理が1箇所にまとまっていてほしい。なぜなら同一ロジックの二重実装は片方だけ変わる乖離リスクであり、WHY コメントまで複製されているから。

## 優先度
- 順位: 09 / 11
- RICEスコア: 2.0（Reach=2 / Impact=0.5 / Confidence=1.0 / Effort=0.5）
- 根拠: 振る舞い不変のリファクタ。既存テスト緑で閉じる。

## 背景
`src/utils/ui/settingsUiHelper.ts:104-111` と `:141-147` に `#status`→`#statusTop` ミラー（`try { syncStatusToTop(); } catch {}` ＋ WHY コメント）が重複している。レビュー指摘 Low #1（Maintainability）。

## BDD受け入れシナリオ
Scenario: ミラー処理は1箇所に集約される
  Given `#status` への書き込み・クリア
  When `showStatus` / `clearStatus` を呼ぶ
  Then `#statusTop` へのミラーが従来どおり行われる（振る舞い不変）

Scenario: 例外時の沈黙方針は維持される
  Given ミラー処理で例外が発生する
  When 呼び出す
  Then 例外は握りつぶされ、呼び出し側の処理は継続する（WHY 方針維持）

## 受け入れ基準
- [x] 重複ブロックが共通ヘルパーに集約される（WHY コメントはヘルパー側に1箇所）
- [x] `src/utils/ui/__tests__/settingsUiHelper.test.ts` が全緑

## テスト戦略
- 単体: 既存テストで振る舞い不変を確認（ミラー呼び出しの spy があれば継続）
- 既存: `npx vitest run src/utils/ui/` 全緑

## 見積もり
0.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（不要ならその旨を記録）

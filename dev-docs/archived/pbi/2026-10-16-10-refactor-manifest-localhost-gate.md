# PBI: manifest ゲートの localhost「存在必須」を将来の権限削除と両立させる

## ユーザーストーリー
将来の権限削減を行う開発者として、localhost 権限の正当な削除がテストゲートに誤ってブロックされないでほしい。なぜなら「存在必須」のままだと、最小権限化のたびにゲートと戦うことになるから。

## 優先度
- 順位: 10 / 11
- RICEスコア: 1.6（Reach=2 / Impact=1 / Confidence=0.8 / Effort=1.0）
- 根拠: 将来リスクの軽減。ゲート再設計の判断が残るため Confidence 0.8。

## 背景
`src/__tests__/manifest.test.ts:285` が localhost / 127.0.0.1 の「存在」を必須化している。将来これらの権限を正当に削除する変更がゲートに誤検知される。レビュー指摘 Low #15（DX）。

## BDD受け入れシナリオ
Scenario: 正当な権限削除はゲートを素通りできる
  Given localhost 系権限を意図的に削除した manifest（宣言付き）
  When ゲートを実行する
  Then 「意図的削除」として受理される、または削除理由の宣言とセットで検証される

Scenario: 無断の権限削除・改ざんは今までどおり検出される
  Given 宣言なしに権限を削った manifest
  When ゲートを実行する
  Then 失敗する（red-side の検出力は維持、`:397-410` の改ざん検出を含む）

## 受け入れ基準
- [x] 存在必須の断定が「宣言付き削除を許す」形に緩和される（または緩和しない場合は不変の根拠が記録される）
- [x] 改ざん検出の red-side テストが緑のまま
- [x] `npx vitest run src/__tests__/manifest.test.ts` 全緑

## テスト戦略
- 単体: 意図的削除の受理テスト＋無断削除の拒否テスト
- 既存: manifest.test.ts 全緑

## 見積もり
1.0 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：テスト内のみ、red-side維持）
- [x] ドキュメント更新済み（不要ならその旨を記録）

## 実装メモ（2026-10-16）
- 解：テスト内ゲートに `DeclaredPermissionRemoval { permission, reason }` 宣言を導入。
  `expectedHostPermissionsAllowingDeclaredRemovals()` が SSOT 構成から宣言分を差し引き、
  理由空・非localhost・SSOT外・重複の宣言は throw。宣言なし削除は従来どおり失敗。
  `DECLARED_LOCALHOST_REMOVALS` は既定で空のため現行 manifest は無変更で全緑。
- 変更：`src/__tests__/manifest.test.ts` のみ（本番 manifest・権限に触れない）。
  新規4テスト：宣言あり受理1＋拒否3（宣言なし・理由なし・非localhost）。
  既存 red-side（SSOT外追加の拒否、ローカル削除の拒否）は原文のまま維持・緑。
- 検証：`npx vitest run src/__tests__/manifest.test.ts` → 21 passed（既存17＋新規4）。
- ドキュメント：利用者向け docs の更新は不要（テスト内ゲートの緩和のみで仕様変更なし）。
  なぜなぜ分析は `/tmp/whywhy-nn10.md` に記録。

# PBI: gateway 応答の形状検証と失敗文の既定化

## ユーザーストーリー

利用者として、裏側の応答が壊れても空の失敗表示を見たくない。なぜなら bare の失敗応答が素通しして空トーストになるから。

## 優先度

- 順位: 03 / 全11件
- RICE スコア: 10（Reach = 5 / Impact = 2 / Confidence = 1.0 / Effort = 1.0人日）
- 根拠: 同一ガード関数の本体・テスト・呼出し側既定を束ねた縦スライス。NN05・NN04 と同 gateway 群に触れるため本 PBI を先に実施する。

## ビジネス価値

壊れた応答の素通しは、空表示・未検出の不整合としてユーザーと運用の双方に返る。形状検証で失敗が可視化される。

## BDD受け入れシナリオ

```gherkin
Scenario: 壊れた応答は失敗として扱われる
  Given `{success:true}` の空形や `{success:false}` の error 欠落が返る
  When gateway が正規化する
  Then 失敗として扱われ、空でない失敗文が返る

Scenario: 正常応答は素通しする
  Given 正形の成功・失敗応答が返る
  When gateway が正規化する
  Then 変更前と同一に処理される
```

## 受け入れ基準

- [ ] ガードが `success` 以外（error の string 性など）を検証する、または失敗文の既定化で空表示が出ない
- [ ] bare・配列・非 string の素通し分岐テストがある
- [ ] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- panel 呼出し側の空失敗文が出ないテスト

### 単体テスト
- 共有ガードの table 拡張（bare 形・配列・非 string error）

## 実装アプローチ

- **Outside-In**: 素通しケースの失敗テストを先に書き、赤を確認してから直す

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: NN05・NN04 は本 PBI の後に実施（同 gateway 群）
- 非機能要件: 正常応答の処理は不変。エラー文の既存 pin は意図的に更新してよい（理由を記録する）

## 変更点の概要

共有ガードの検証を強め、失敗文が空にならない既定を足し、素通し分岐のテストを埋める。

## 現状と問題（file:line 付き）

- `src/messaging/normalizeGatewayResponse.ts:22-33` ― `success` boolean のみ検査し残りを素通し
- `src/messaging/__tests__/normalizeGatewayResponse.test.ts:34-47` ― 素通し分岐のカバーが正常形2例のみ
- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts:594` ― `error ?? ''` が空の利用者向けエラーになる

## 変更の理由（エラーハンドリング）

同一ガード関数の検証・テスト・呼出し側既定が同じ理由（応答形状の変更）で同時に変わる関係。

## 提案コード（骨子のみ）

```typescript
// ガード: error の string 性まで見る方向。または呼出し側で空失敗文の既定メッセージを足す。
// いずれも正常応答の素通しは保つ。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -rn "asSuccessResponse\|translateHistoryError" src/messaging/ src/dashboard/panels/asyncData/sqliteHistoryPanel.ts | grep -v __tests__
```

### 落とし穴

- 正常応答の素通しを壊さない（既存テストが緑のままであること）
- 文言 pin の更新は理由付きで行う

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過 + 素通し分岐テスト新規通過
- [ ] コードレビュー完了
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み

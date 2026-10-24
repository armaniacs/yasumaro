# PBI: tab lifecycle操作の1 module化

## ユーザーストーリー

保守担当者として、tabのlifecycle操作を1 moduleに深めたい。なぜなら同一形状のportが3 moduleに独自定義され、仮説のseamが3つあるから。

## 優先度

- 順位: 06 / 全8件
- RICE スコア: 5.3（Reach = 5 / Impact = 2 / Confidence = 0.8 / Effort = 1.5人日）
- 根拠: listener修正の再発防止（1箇所の修正で全経路に効く）。Confidence 0.8 は共有範囲の設計判断残り。

## ビジネス価値

新規のtab経由取得が方針値1点で再利用でき、lifecycle不具合の修正が1箇所になる。

## BDD受け入れシナリオ

```gherkin
Scenario: lifecycleが1 moduleで動く
  Given tab経由の取得がある
  When 開く・待つ・読む・閉じる
  Then 変更前と同一に動作する

Scenario: timeout意味論が方針値で変わる
  Given 経路ごとのtimeout方針がある
  When 方針値を渡す
  Then 各経路の意味が保たれる
```

## 受け入れ基準

- [x] open/wait/closeが1 moduleに集まり、timeout意味論だけ方針値になる
- [x] 読取経路差（GET_CONTENT ask vs innerText shortcut）は残る
- [x] 既存テスト全緑

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- なし

### 統合テスト
- 各取得経路のテスト維持

### 単体テスト
- lifecycleのtable（方針値×経路）

## 実装アプローチ

- **Outside-In**: lifecycleの失敗テストを先に書き、赤を確認してから寄せる

## 見積もり

1.5pt（🟡中）

## 技術的考慮事項

- 依存関係: なし（取得路の独立領域）
- 非機能要件: timeout意味論の差異を保つ（best-effort vs reject）

## 変更点の概要

lifecycle操作を1 moduleに深め、意味論差だけ方針値にする。

## 現状と問題（file:line 付き）

- `src/popup/contentFetchGateway.ts:22-62` ― TabSendTransport＋innerText取得
- `src/background/manualContentFetcher.ts:17-52` ― ManualTabPorts 6操作
- `src/background/regenerateContentFetcher.ts:34-43` ― Deps 5操作（`:10-25` に非共有の意思決定記録）
- 各portの本番adapterはchrome直結1つのみ

## 変更の理由（depth）

仮説のseam×3。差異はtimeout 1点に局在するはずでport全体の重複を正当化しない。

## 提案コード（骨子のみ）

```typescript
// tab open/wait/closeの単一module＋timeout方針値。
// 読取経路の差は残す。lifecycleだけ統一する。
```

## 実装者向け注記

### 現状コードの確認

```bash
grep -n "open\|wait\|close\|timeout" src/background/manualContentFetcher.ts src/background/regenerateContentFetcher.ts src/popup/contentFetchGateway.ts | head -20
```

### 落とし穴

- timeout意味論の差異（best-effort vs reject）を潰さない
- regenerate側headerの意思決定記録を先に読む

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 既存テスト全通過 + tableテスト新規通過
- [x] コードレビュー完了
- [x] `npm run validate` 通過
- [x] ドキュメント更新済み

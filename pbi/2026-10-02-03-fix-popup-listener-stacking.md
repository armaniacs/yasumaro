# PBI: popup リスナー多重登録の解消（`statusPanel.ts:329-377` を `wireOnce` へ）

優先度: C6 / RICE #1 / SP S（0.5、small）
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「ハンドラ足場のコピー群」）
親 PBI: なし（新規・C6 系統の先頭）
依存: なし（`src/popup/statusPanel.ts` のみ。`domUtils.ts:11` の `wireOnce` seam を再利用し新規 seam 追加なし）

## ユーザーストーリー

popup を保守する開発者として、`statusPanel.ts:329-377` の素の `addEventListener` を共有 seam `wireOnce` へ寄せてほしい、なぜなら再 init 時にリスナーが積み上がると whitelist 書き込みが重複し、popup 再表示のたびに副作用が倍増するから。

## 背景（現状）

- 対象区間: `src/popup/statusPanel.ts:329-377` — `statusAddDomain` / `statusAddPath` ボタンへの素の `addEventListener`（再 init で重複登録される）。
- 兄弟箇所は既に `wireOnce` 済み: `src/popup/statusPanel.ts:88`、`src/popup/statusPanel.ts:157`、`src/popup/statusPanel.ts:398`、`src/popup/statusPanel.ts:423`。
- 共有 seam: `src/popup/domUtils.ts:11`（`export function wireOnce`）。再利用のみで seam 自体の変更はしない。
- 既存テスト（変更なしで green を保つ対象）:
  - `src/popup/__tests__/statusPanel` 系 suites
  - `src/popup/__tests__/domUtils` 系 suites（`wireOnce` の既定挙動）

## BDD シナリオ

```gherkin
Scenario: 再 init でも whitelist 書き込みは 1 回
  Given statusPanel が 2 回 init される
  When statusAddDomain / statusAddPath が 1 回クリックされる
  Then whitelist 書き込みは 1 回だけ発生する

Scenario: 兄弟箇所と同一の wireOnce 意味論
  Given statusAddDomain / statusAddPath ボタン
  When wireOnce 経由で配線される
  Then :88,157,398,423 と同一の重複排除意味論（再配線で旧リスナー無効化）である
```

## 実装宣言

- 挙動維持: クリック 1 回あたりの whitelist 書き込み内容・成功時表示・エラー表示は不変。変えるのは配線の重複排除のみ
- `domUtils.ts:11` の `wireOnce` 本体には触らない（呼び出し側寄せのみ）
- 新規の振る舞い・文言変更・足場抽出はしない（純粋な listener sweep、Size S）

## 受け入れ基準

- [ ] A1: `src/popup/statusPanel.ts:329-377` の `statusAddDomain` 配線が `wireOnce` 経由になる
- [ ] A2: `src/popup/statusPanel.ts:329-377` の `statusAddPath` 配線が `wireOnce` 経由になる
- [ ] A3: init を 2 回以上呼んでボタンを 1 回押しても whitelist 書き込みが 1 回だけである（重複登録なし）
- [ ] 対象区間内に素の `addEventListener` が残存しない（兄弟 `:88,157,398,423` と同一パターンに統一）
- [ ] parity テストが存在し、再 init + 1 クリックで書き込み 1 回を固定する
- [ ] `npm run type-check` と popup 配下の vitest が green（既存テスト群を変更なしで通過、または配線置換に伴う最小限の mock 差し替えのみ）

## テスト戦略

- parity テスト必須: 旧配線（素の `addEventListener` × 2 回 init）と新配線（`wireOnce` × 2 回 init）の入出力 parity を固定する。最低 2 系統:
  1. `statusAddDomain`: 2 回 init + 1 クリックで書き込み 1 回
  2. `statusAddPath`: 同上
- 既存 conformance は変更なしで green（`statusPanel` suites、`domUtils` suites）

## 実装内容

1. A1/A2: `statusPanel.ts:329-377` の素の `addEventListener` 2 件を `domUtils.ts:11` の `wireOnce` 経由に置換する（兄弟 `:88,157,398,423` と同一呼び出し形）
2. parity テストを追加し、既存テスト群で green を確認する

## 設計メモ（open design point・実装者が選択）

- **wireOnce の引数形**: 兄弟 4 箇所のうちどれに合わせるか（`id` 渡し vs `element` 渡し）は実装者の選択とする。選択と理由を実装記録に 1 行残す

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録

- （未着手）

# PBI: markdown export の固定タイマー revoke 解消（`markdownExport.ts:285` の 1s timer）

優先度: C4 / RICE #2 / SP S（0.5、small）
backlog: [2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)（holistic-code-review テーマ「非同期・タイミング」）
親 PBI: なし（新規・C4 系統の先頭）
依存: なし（`src/dashboard/markdownExport.ts` のみ。対照ファイルへの変更なし）

## ユーザーストーリー

dashboard を保守する開発者として、`markdownExport.ts:285` の固定 1s タイマーによる object URL revoke を完了シグナル駆動に直してほしい、なぜなら固定待ちはダウンロード完了前に revoke して失敗させるか、逆に URL を漏らすかのどちらかに静かに傾くから。

## 背景（現状）

- 対象: `src/dashboard/markdownExport.ts:285` — object URL revoke を固定 1s タイマー（`setTimeout(..., 1000)`）で行う。
- 対照パターン A（推奨）: `src/dashboard/panels/connectionTests.ts:464-470` — `finally` での確定クリーンアップ。
- 対照パターン B（変種）: `src/dashboard/exportLogsService.ts` の 60s revoke 変種 — 保持理由が記録対象（本 PBI の実装記録で対比すること）。
- 既存テスト（変更なしで green を保つ対象）:
  - `src/dashboard/__tests__/markdownExport.test.ts`、`src/dashboard/__tests__/markdownExport-seam.test.ts`、`src/dashboard/__tests__/exportDateSsot.golden.test.ts`

## BDD シナリオ

```gherkin
Scenario: ダウンロード完了後に revoke される
  Given markdown export が object URL を発行する
  When ダウンロードが完了シグナルを返す
  Then revoke は完了シグナル駆動で 1 回だけ行われる（固定 1s 待ちに依存しない）

Scenario: 失敗時も URL が漏れない
  Given export が途中で失敗する
  When エラー経路に入る
  Then revoke（または同等のクリーンアップ）が確定実行される
```

## 実装宣言

- 挙動維持: 生成される markdown 内容・ファイル名・ダウンロード触发の UX は不変。変えるのは revoke のタイミング決定方式のみ
- 固定タイマーを残す選択をする場合は、証拠（計測・仕様根拠）付きで保持理由を実装記録に残す（無根拠の維持は不可）
- 新規の振る舞い・文言変更・足場抽出はしない（Size S）

## 受け入れ基準

- [x] A1: `src/dashboard/markdownExport.ts:285` の固定 1s タイマーが、完了シグナル駆動の revoke（または `finally` 確定実行）に置換される。または保持理由が証拠付きで実装記録に残される
- [x] A2: 成功経路で revoke が 1 回だけ確定実行される（重複 revoke なし・URL 漏れなし）
- [x] A3: 失敗経路でもクリーンアップが確定実行される（`connectionTests.ts:464-470` の `finally` パターンと同等の確定性）
- [x] A4: `exportLogsService` の 60s 変種との対比（なぜ 60s でなく完了シグナルか／なぜ 60s が許容されるか）が実装記録に残される
- [x] parity テストが存在し、成功 / 失敗の両経路で旧タイマー経路と同一のダウンロード結果 + 新 revoke タイミングを固定する
- [x] `npm run type-check` と変更ディレクトリ配下の vitest が green（上記既存テスト群を変更なしで通過、または revoke 置換に伴う最小限の mock 差し替えのみ）

## テスト戦略

- parity テスト必須: 旧固定タイマー経路と新完了シグナル経路の入出力 parity を固定する。最低 2 系統:
  1. 成功系: 同一ファイル内容のダウンロード + revoke 1 回
  2. 失敗系: 同一エラー表示 + クリーンアップ確定実行
- 実時間待ちの禁止（AGENTS.md）: 固定 `setTimeout` 待ちでテストを通さない。完了イベントの await / `waitForMock` / inject 可能な sleep で駆動する
- 既存 conformance は変更なしで green（`markdownExport.test.ts`、`markdownExport-seam.test.ts`、`exportDateSsot.golden.test.ts`）

## 実装内容

1. A1: `markdownExport.ts:285` の固定 1s タイマーを完了シグナル駆動（または `finally` 確定実行）に置換する。保持選択時は証拠を記録
2. A4: `connectionTests.ts:464-470` と `exportLogsService` 60s 変種との対比を実装記録に残す
3. parity テストを追加し、既存テスト群で green を確認する

## 設計メモ（open design point・実装者が選択）

- **完了シグナルの取り方**: click 後の明示完了コールバックか `finally` 確定実行かは実装者の選択とする。ダウンロード完了前に revoke しないことをテストで証明し、選択と理由を実装記録に 1 行残す

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test が通る
- [ ] コードレビュー完了

## 実装記録

- 2026-10-02 実装済み。固定 1s タイマーを `try/finally` の確定 revoke に置換（`src/dashboard/markdownExport.ts:285` 付近）。`chrome.downloads.download` の settle 駆動でありタイマー不使用。
- 完了シグナルの取り方: `finally` 確定実行を選択。download promise の settle は Chromium が blob fetch を開始した時点で解決し、進行中 fetch は File API が blob を保持するため revoke が後続 fetch を阻害しない。タイマーは早すぎる revoke か失敗経路の漏れのいずれかに傾く。
- A4 対比: `exportLogsService` の 60s 変種は anchor-click 経路に await 可能な完了シグナルが無いため timer 維持が許容される。本経路は完了シグナルがあるため settle 駆動が正しい。対比理由はソース内コメントにも記録。`exportLogsService` 自体は無変更。
- 新規テスト `src/dashboard/__tests__/markdownExport-revoke.test.ts`（2 tests: 成功 settle で revoke 1 回・タイマー不使用 / reject 時に revoke + エラー伝搬）。
- ゲート: `npx tsc --noEmit` 0 errors、`npm run lint` 0 errors、全 suite 15397 passed。

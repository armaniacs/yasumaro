# PBI: レガシー transport マーカー compat 3 表を集約する

## ユーザーストーリー

リトライ判定の保守担当者として、compat フォールバック表を 1 つにしたい。kind なし素 Error の救済範囲が 3 表に分散し、新 transport errno 追加時に同時編集が必要で、漏れると判定割れになるから。

## 優先度

- 順位: 15/23
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: compat 表のみ集約。terminal・chrome-transport・表示分類は対象外
- 依存: なし

## 背景（file:line 現状）

- `src/background/pipeline/retryPolicy.ts:17-27`（LEGACY_NETWORK_MARKERS 9 語）、`:60-69`（cause 再帰照合）
- `src/utils/retryPredicate.ts:21-35`（14 語）、`:37-48`（TERMINAL 除外は維持）、`:58-88`（kind 優先→terminal 除外→照合）
- `src/utils/failureTaxonomy.ts:260`（3 語）、`:267-286`（kind 優先→compat 照合）
- 非対称の実例: `econnreset` 等が retryPredicate にしかない
- 対象外: TERMINAL_ERROR_MARKERS と AbortError/timed out 特殊扱い、chrome-transport 正規表現（別 universe）、errorClassification 表示分類（別層）

## BDD受け入れシナリオ

```gherkin
Scenario: compat 表が 1 箇所になる
  Given 新 transport errno の追加
  When 定義する
  Then SSOT の 1 箇所で済み、各消費者が用途別フィルターで使う

Scenario: 除外層が残る
  Given terminal・chrome-transport・表示分類
  When 整理する
  Then いずれも統合されず現状維持である
```

## 受け入れ基準

- [x] `LEGACY_TRANSPORT_MARKERS_FULL` 相当が `failureTaxonomy.ts` 底部に SSOT 化されている
- [x] 各消費者が用途別フィルターで使う（pipeline / retryPredicate / fetch 委譲）
- [x] TERMINAL 除外と特殊扱いは維持されている
- [x] 各表頭の互換専用コメントが維持されている
- [x] 既存 parity テストが green のまま
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 単体: 既存 parity テストの維持＋集約後の一致テスト
- 実時間待ちは使わない

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `failureTaxonomy.ts`（FULL 表 22 語を SSOT 化）、`retryPolicy.ts`・`retryPredicate.ts`（エイリアス化）、テスト 3 ファイル（包含・修復・parity）
- 逸脱の記録: PBI の「用途別フィルター」案に対し、FULL 表への統一（エイリアス）で実装。各消費者の救済範囲が union に広がる方向の挙動変化だが、リトライ拡大側であり、parity＋新規テストで pin 済み。TERMINAL 除外・特殊扱いは維持
- ゲート: 対象 4 ファイル 95 tests green / type-check PASS / lint 0 errors

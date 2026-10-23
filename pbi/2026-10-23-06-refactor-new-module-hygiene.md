# PBI: 新設モジュールの型・衛生残差整理

## ユーザーストーリー

保守担当者として、10-22/10-23 新設コードの小衛生残差を一掃したい。なぜなら到達不能ガード・未参照定数・型アサーションは静的検査のノイズになり、将来の真の警告を埋もれさせるから。

## 優先度

- 順位: 06 / 全12件
- RICE スコア: 13.3（Reach = 8 / Impact = 1 / Confidence = 1.0 / Effort = 0.6人日）
- 根拠: 全件主スレッドが実読で裏取り済み。いずれも単一ファイル内の純粋整理であり、束ねても「変わる理由」（新設コードの静的衛生）は同一。

## BDD 受け入れシナリオ

```gherkin
Scenario: 実行時挙動が変更前と同一
  Given 各対象モジュールの正常・境界入力がある
  When 整理後のコードを実行する
  Then 変更前と同一の結果が返る

Scenario: 静的衛生
  Given 整理後のツリーがある
  When 型検査と該当テストを実行する
  Then 警告・失敗なく緑になる
```

## 受け入れ基準

- [ ] 下記5件が整理され、既存テスト全緑（更新が必要な pin は理由付きで書換え）
- [ ] `npm run validate` 通過

## テスト戦略（t_wada スタイル）

- E2E: なし
- 統合: なし（各変更は単一ファイル内）
- 単体: 既存テスト維持 + `tokenizeTitle(unknown)` の非文字列 pin 新規 + `slice` 定数の値 pin 維持

## 見積もり

1pt（🟢低）

## 技術的考慮事項

- 依存関係: なし
- 非機能要件: 実行時挙動不変。テスト pin の書換えは最小限にし、理由を各テストに残す

## 変更点の概要

新設モジュール5箇所の小整理を束ねて行う（いずれも同一ファイル内の純粋整理）。

## 現状と問題（file:line 付き）

1. `src/dashboard/similarityClusterAggregate.ts:56-58` ― `tokenizeTitle(title: string)` 直後の `typeof title !== 'string'` ガードは到達不能（型）。非文字列実行時入力には現状 empty-set を返している。
2. `src/dashboard/sessionTimelineAggregate.ts:50` ― `REMINDER_MAX_PER_DAY = 1` が製品コードから未参照（`shouldFireReminderToday:120-123` は定数不使用）。テスト `:115` が値を pin。
3. `src/dashboard/tagsPanel.ts:243` ― filter 直後の `r.id as number`（`r.id !== undefined` で絞った直後のアサーション）。
4. `src/dashboard/panels/asyncData/researchSessionsPanel.ts:297` ― `.slice(0, 3)` の素数リテラル（削除詳細の表示ドメイン数）。
5. `src/dashboard/onboardingBanner.ts:55` ― 同一 ID `obsidianEnabled` の二重 `getElementById`（scroll と focus で別取得）。
- 前回 PBI 2026-10-20-20（型安全性）・2026-10-20-12（命名整備）と同一主題の残差

## 変更の理由（型安全性・命名・可読性）

1. 引数を `title: unknown` に広げガードを到達可能にする（実行時意味は不変：非文字列 → empty-set）。
2. 未参照 export 定数は削除する（テスト pin も更新。「1日1件」の意味は `shouldFireReminderToday` のコメントに残す）。
3. `flatMap` 等の narrowing でアサーションを消す。
4. `TOP_DOMAINS_IN_DELETE_DETAIL = 3` 等の名前付き定数に置換する。
5. 要素を const に束ねて二重取得を消す。

## 提案コード（骨子のみ）

```typescript
// 1: export function tokenizeTitle(title: unknown): Set<string>
// 2: REMINDER_MAX_PER_DAY の export 削除 + shouldFireReminderToday のコメントに「1日1件」を明記
// 3: .filter((r): r is { id: number; ... } => r.id !== undefined).map(...)
// 4: const TOP_DOMAINS_IN_DELETE_DETAIL = 3;
// 5: const obsidianToggle = document.getElementById('obsidianEnabled'); 二箇所で共用
```

## 実装者向け注記

```bash
grep -rn "REMINDER_MAX_PER_DAY\|as number\|slice(0, 3)\|getElementById('obsidianEnabled')" src/dashboard/ --include='*.ts' | grep -v __tests__
```

- 2 の定数削除は export 契約の変更であり、外部参照がテスト以外にないことを grep で確認してから消す
- 1 の `unknown` 化で呼び出し元の型エラーが出たら呼び出し側を狭める（実行時は変えない）

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] 既存テスト全通過（pin 書換えは理由付き）
- [ ] `npm run validate` 通過
- [ ] ドキュメント更新済み

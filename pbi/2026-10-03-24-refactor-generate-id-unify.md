# PBI: ID 生成の共有 generateId() 統一と toCalendarDate 委譲

## ユーザーストーリー

保守者として、randomUUID フォールバック付き ID 生成を utils の共有 generateId() に統一し、dailyPurgeHandler の toCalendarDate を utils/localDate.ts へ委譲したい。ID 生成が 4〜5 箇所に重複し、フォールバック形式が分岐しているため、ID の一意性と形式の保証が場所ごとにばらつくからだ。

## 優先度

- 種別: refactor
- 順位: 09 / 20
- RICEスコア: 8.0（Reach=4 / Impact=1 / Confidence=1.0 / Effort=0.5 SP）
- 根拠: 重複解消によりフォールバック形式の不整合と ID 形式の逸脱を構造的に防げる。動作非変更のため Confidence は高い。
- 依存: なし

## 背景

- randomUUID フォールバック付き ID 生成の重複（フォールバック形式が不一致）:
  - `src/background/offlineNetworkQueue.ts:35-42`
  - `src/background/pipeline/RecordingOrchestrator.ts:119-127`
  - `src/background/confirmTokenManager.ts:53-56`
  - `src/utils/logger/core.ts:104` 周辺
- `src/background/dailyPurgeHandler.ts:38-43` — `toCalendarDate` が `src/utils/localDate.ts:40-53` とバイト等価で重複。

## BDD受け入れシナリオ

```gherkin
Scenario: 共有 generateId() が全呼び出し元で同一の形式を返す
  Given ID 生成が utils の共有 generateId() に統一されている
  When 各呼び出し元が ID を生成する
  Then 生成される ID は randomUUID を優先し、フォールバック形式が全呼び出し元で同一である

Scenario: crypto.randomUUID が利用できない環境でも ID が生成される
  Given crypto.randomUUID が利用できない
  When generateId() を呼び出す
  Then フォールバック形式の ID が返り、衝突しにくい形式が維持される

Scenario: toCalendarDate の重複は utils への委譲で解消される
  Given dailyPurgeHandler が toCalendarDate を utils/localDate.ts に委譲している
  When 日次パージが日付変換を行う
  Then 変換結果は変更前と同一である
```

## 受け入れ基準

- [x] utils に共有 generateId() が定義されている。
- [x] offlineNetworkQueue / RecordingOrchestrator / confirmTokenManager / logger core の ID 生成が generateId() に統一されている。
- [x] フォールバック形式が全呼び出し元で同一になり、分岐した形式が残らない。
- [x] `dailyPurgeHandler.ts` の toCalendarDate が `utils/localDate.ts` への委譲に置き換わっている。
- [x] 生成される ID の文字列形式（randomUUID 使用時）は変更前と同一である。
- [x] 日次パージの日付変換結果に回帰がない。
- [x] `npm run validate` が成功している。

## テスト戦略（t_wadaスタイル）

### 単体テスト

- generateId() の単体テストを新設し、randomUUID 使用時の形式と crypto 未対応時のフォールバック形式を検証する。
- 各呼び出し元の既存テストが新経路でも成立することを確認する。

### 統合テスト

- dailyPurgeHandler の日付変換が `utils/localDate.ts` と同一結果になることを既存テストで確認する。

## 見積もり

**0.5 SP**

共有関数の新設、4 箇所の呼び出し元置換、toCalendarDate の委譲、テスト更新を含む。

## Definition of Done

- [x] generateId() への統一が完了している。
- [x] フォールバック形式の分岐が解消されている。
- [x] toCalendarDate が委譲に置き換わっている。
- [x] ID 形式と日付変換に回帰がない。
- [x] `npm run validate` が成功している。
- [x] BDD 受け入れシナリオとテスト戦略の検証が完了している。
- [ ] コードレビューが完了している。

## 実装記録

- 新設: `src/utils/generateId.ts` — randomUUID 優先、フォールバックは hex-32（16 バイトの 16 進 32 文字）に統一。旧 offlineNetworkQueue の hex-32 フォールバックと logger core の Uint32Array base36 分岐を解消（決定事項: フォールバック形式は hex-32 に統一）。`hasSecureRandom()` を export し、confirmTokenManager 側の Math.random 由来の予測可能フォールバックは保持しない
- 統一先（6 src ファイル）: `src/background/offlineNetworkQueue.ts`、`src/background/pipeline/RecordingOrchestrator.ts`、`src/background/confirmTokenManager.ts`、`src/utils/logger/core.ts`（上記 4 か所が generateId() に統一）、`src/background/dailyPurgeHandler.ts`（toCalendarDate を `utils/localDate.ts` の `formatLocalDate` へ委譲）、`src/utils/generateId.ts`
- テスト（6 ファイル）: `src/utils/__tests__/generateId.test.ts` 新設、`src/background/__tests__/offlineNetworkQueue-id.test.ts` 新設（共有 ID ソース pin）、`confirmTokenManager.test.ts`・`RecordingPipeline.test.ts`・`orchestrator-surface.test.ts`・`core-branch.test.ts` 更新（randomUUID 伝播と統一フォールバックの pin）
- follow-up（範囲外・未実施）: `src/background/feedbackQueue.ts:36-40` に Math.random フォールバックが残存。別 PBI 化の余地あり
- ゲート: `npx tsc --noEmit` 0 エラー / `npm run lint` 0 エラー / `npm test` 15529 passed・21 skipped / `npm run validate` PASS

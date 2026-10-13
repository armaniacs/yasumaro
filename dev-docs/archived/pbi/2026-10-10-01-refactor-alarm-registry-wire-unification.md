# PBI: alarmRegistry の二重配線を DI 統合に回収する（refs 削除 + never 型 + .then() 解消）

- 種別: refactor
- RICE: 9.6（R8 × I3 × C1.0 / E2.5）
- 依存: なし
- バッチ: W1

## ユーザーストーリー

保守担当者として、alarm 配線が composition root の単一参照に集約されていてほしい。なぜなら module-level refs と評価順序保証は「無音の no-op」という失敗モードを持ち、全タイマージョブ（review summary・session timeout）の信頼性を暗黙的に損なうから。

## 背景（現状）

- `src/background/alarmRegistry.ts:40` — `AlarmHandlerDeps.reviewSummaryGenerator?` は宣言のみで注入・参照ゼロの死んだ dep
- `src/background/alarmRegistry.ts:152-170` — 実フックは module-level `reviewSummaryGeneratorRef` / `sessionTimeoutInstallRef` / `sessionTimeoutRunRef` を optional-chain で読む。破綻モードは「無音、no error、no log」で :160-166 に 30 行近いコメントで文書化
- `src/background/alarmRegistryRefs.ts:12-21` — mutable module state（exported let）+ setter 2 本
- `src/background/compositionManifest.ts:210-224` — alarmRegistry factory。`as AlarmRegistry` 冗長キャスト（:223）。`getOfflineNetworkQueue` は同じファイルで静的 import 済みの `offlineNetworkQueue.js`（:34）を `import('./offlineNetworkQueue.js').then(m => m.sharedOfflineNetworkQueue)` で再 import（.kilorules 絶対規則3「.then() チェーン禁止」違反）
- `src/background/alarmRegistry.ts:38,102` — `retryPendingChromeStorageWrite: (write: never)` の `never` パラメータが使用箇所に `as never` キャストを強制。正しい型 `QueuedChromeStorageWrite` は `src/background/pendingChromeStorageQueue.ts` に実在
- `src/background/service-worker.ts:216-229` — `setSessionTimeoutRefs` / `setReviewSummaryGeneratorRef` 呼び出し + 評価順序保証コメント。`sessionAlarmService` / `reviewSummaryGenerator` はいずれもコンテナ登録済みエントリなので、ref を経由する理由が成立しない

DESIGN_SPECIFICATIONS.md §2.2「Long-lived collaborators are wired in createBackgroundServices() so every message path observes the same shared references」からの逸脱。interface が implementation より複雑な shallow seam（ref 経路 + deps 経路 + 死んだ dep の 3 重）。

## BDD 受け入れシナリオ

```gherkin
Scenario: review summary ジョブが deps 経由で発火する
  Given alarmRegistry がコンテナから正規 deps（reviewSummaryGenerator 含む）で構築されている
  When yasumaro-review-weekly アラームが発火する
  Then table の run は deps.reviewSummaryGenerator.generateWeeklySummary() を呼ぶ
  And module-level refs への参照はゼロである

Scenario: ref 注入が欠けても構造的に失敗しない
  Given service-worker.ts が alarmRegistryRefs.ts を import しない
  When 拡張が起動する
  Then refs ファイルは削除済みで、評価順序保証コメントも存在しない
  And session timeout ジョブは deps.sessionAlarmService 経由で install/run する
```

## 受け入れ基準

- [x] `AlarmHandlerDeps.reviewSummaryGenerator?` を削除し、`reviewSummaryGenerator: ReviewSummaryGenerator` を必須 deps にする
- [x] `AlarmHandlerDeps` に `sessionAlarmService: SessionAlarmService` を追加し、check_session_timeout の install/run が `deps.sessionAlarmService.startTimeoutChecker()` / `checkTimeout()` を呼ぶ
- [x] `alarmRegistryRefs.ts` を削除（`git rm`）し、setter / ref 参照を全消去
- [x] `service-worker.ts` の `setSessionTimeoutRefs` / `setReviewSummaryGeneratorRef` 呼び出しと評価順序保証コメントを削除
- [x] `compositionManifest.ts` の alarmRegistry factory に `reviewSummaryGenerator` / `sessionAlarmService` を `c.resolve` で注入
- [x] `retryPendingChromeStorageWrite` の型を `(write: QueuedChromeStorageWrite) => Promise<boolean>` に修正し、alarmRegistry.ts の `as never` と compositionManifest.ts の `as AlarmRegistry` を削除
- [x] `getOfflineNetworkQueue` を静的 import 済み `sharedOfflineNetworkQueue` の同期 getter（`() => sharedOfflineNetworkQueue`）に変更し、dep 型を `() => OfflineNetworkQueue` に
- [x] 既存 alarmRegistry テストが更新後の deps で green

## テスト戦略

- unit: `src/background/__tests__/alarmRegistry*.test.ts` — deps 注入後のテスト更新（fixture: 既存テストのモック構成を再利用、実時間待ちは `testDir/waitPolicy.ts` のヘルパーに従う）
- integration: service-worker 起動経路の `src/background/__tests__/service-worker.test.ts` — refs import が消えたことを構造的に pin（alarmRegistryRefs.ts の存在検査は不要、import 消失で十分）
- 挙動不変: 各ジョブの発火パスは変更しない（table の run 経路は deps 参照先が変わるだけ）

## 見積もり

2.5 SP

## 技術的考慮事項

- 循環 import: alarmRegistry.ts は `ReviewSummaryGenerator` / `SessionAlarmService` の型 import のみで済む（値は manifest が resolve）。reviewSummaryGenerator.ts → alarmRegistry.ts の import 辺は存在しないことを `rg` で確認済み
- `getOfflineNetworkQueue` の live binding: `sharedOfflineNetworkQueue` は exported `let` なので静的 import の getter で同一の新鮮さを持つ
- プライバシー保証: 変更なし（配線のみ）

## 実装者向け注記

### 実装手順

1. `alarmRegistry.ts`: deps 型修正（reviewSummaryGenerator 必須化 + sessionAlarmService 追加 + never → QueuedChromeStorageWrite）→ table の run/install を deps 参照に書き換え → refs import 削除
2. `compositionManifest.ts`: factory に `c.resolve<ReviewSummaryGenerator>('reviewSummaryGenerator')` / `c.resolve<SessionAlarmService>('sessionAlarmService')` を追加、getOfflineNetworkQueue を同期 getter 化
3. `service-worker.ts`: refs 呼び出しとコメント削除
4. `alarmRegistryRefs.ts`: `git rm`
5. テスト更新 → `npx vitest run src/background/__tests__/alarmRegistry` で検証

### 落とし穴

- `flushPendingWrites(deps.retryPendingChromeStorageWrite as never)` の `as never` 削除時、`pendingChromeStorageQueue.ts` の `QueuedChromeStorageWrite` 型 import が必要
- service-worker.test.ts が module refs の存在を前提にしている場合は pin を deps 注入に張り替える

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] `alarmRegistryRefs.ts` がリポジトリから消滅
- [x] `as never` / `as AlarmRegistry` キャストが 0 件
- [x] `npx vitest run src/background` が green
- [x] ドキュメント更新: LAYERS.md の alarmRegistry 行に refs への言及があれば更新
- [x] ロールバック不要（配線のみ・挙動不変）

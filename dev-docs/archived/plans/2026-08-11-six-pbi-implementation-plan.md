# 6 PBI 統合実装計画 — 2026-08-11

## 1. 概要

本計画は、2026-08-11時点で `pbi/` に残存する6つのPBIを実装するための統合計画である。

- PBI-09: fallback検索失敗時のover-fetch漏れ解消
- PBI-07: SQLite history panelのstate変更をreducerへ統一
- PBI-08: metadata patch queueのpayload容量制御
- PBI-01: Architecture Deepening Epicの完了条件整理
- PBI-08 (2026-08-07): AIClient/AIServiceの委譲化
- PBI-17: マスターパスワード未設定時の暗号化鍵をsession storageへ移行

事前に `pbi/dig-findings-2026-08-11.md` で35回以上のwhy-why分析を実施し、各PBIの根本原因、未解決の疑問、追加調査結果を整理済みである。本計画はその分析結果に基づく。

---

## 2. 対象PBI一覧

| # | PBIファイル | 難易度 | 副作用 | 種別 | 主要リスク |
|---|------------|--------|--------|------|-----------|
| 1 | `2026-08-11-09-fix-history-fallback-failure-contract.md` | 🟡中 | 🟡軽微 | 🔧fix | UI表示契約の変更 |
| 2 | `2026-08-11-07-fix-sqlite-history-panel-reducer-consistency.md` | 🔴高 | 🟡軽微 | 🔧fix | state遷移の網羅的移行 |
| 3 | `2026-08-11-08-fix-metadata-patch-queue-capacity.md` | 🔴高 | 🔴あり | 🔧fix | queue肥大化、content喪失 |
| 4 | `2026-08-11-01-architecture-deepening-epic.md` | 🔴高 | 🔴あり | 🔧refactor | スコープ再定義 |
| 5 | `2026-08-07-08-refactor-ai-client-service-unification.md` | 🔴高 | 🔴あり | 🔧refactor | AI要約の中核変更 |
| 6 | `2026-08-01-17-fix-encryption-key-session-storage.md` | 🔴高 | 🔴あり | 🔧fix | UX変更、セキュリティ |

---

## 3. 前提と制約

- **MV3準拠**: Service Workerはエフェメラル。状態は `chrome.storage` 経由で永続化。
- **型安全**: TypeScript ESM、`.js` import、strict type checking。
- **テスト**: `npm run validate`（type-check + test）が最終ゲート。
- **最小権限**: 新たなmanifest権限は追加しない。
- **PII保護**: content、APIキー、生パスワードをログに出力しない。
- **既存機能維持**: 記録、履歴表示、SQLite移行、AI要約、Obsidian書き込みを壊さない。

---

## 4. 各PBIの詳細設計

### 4.1 PBI-09: fallback検索失敗時のover-fetch漏れ解消

#### 4.1.1 根本原因（why-why 5回）

1. なぜfallback失敗時に未フィルタ行が返されるのか？
   - `sqliteHistoryQuery.ts:295-300` で fallback 全文検索が失敗すると、`rows = queryResult.data.rows` に fallback するため。
2. なぜ未フィルタ行にfallbackするのか？
   - 「何か表示する方が良い」という防御的な実装だったため。
3. なぜ「何か表示する方が良い」実装が誤りなのか？
   - tag filter条件を満たさない行まで表示され、ユーザーに誤った成功印象を与えるため。
4. なぜtag filter条件を満たさない行が表示されるのか？
   - tag filterはクライアント側で適用され、fallbackの全文検索は別のマッチングロジックだから。
5. なぜ別のマッチングロジックが問題なのか？
   - ユーザーは「tag AIで検索した」と認識しているが、実際は無関係な行が混在するため。

**根本原因**: fallback失敗時にエラー表示を避けるために、不正確な中間結果を成功として返していた。

#### 4.1.2 解決策

- `sqliteHistoryQuery.ts` の fallback 全文検索失敗時に `searchResult`（ServiceError）をそのまま返す。
- 未フィルタ行を `rows` に代入する既存パスを削除。
- panel側は既存の `loadFailure` action を使ってerror stateに遷移。
- `tagFallback` は fallback 成功時のみ付与。失敗時は `null`。

#### 4.1.3 変更箇所

- `src/dashboard/panels/asyncData/sqliteHistoryQuery.ts:295-300`
- `src/dashboard/panels/asyncData/sqliteHistoryPanelState.ts:loadSuccess`（tagFallbackの扱いは維持）

#### 4.1.4 テスト

- 単体: `sqliteHistoryQuery.test.ts` に fallback success / empty / failure の3分岐を追加。
- 境界: 短いtag名（<3文字）、offset/limit、同一bucket。
- 統合: fallback失敗時にpanelのerror stateへ伝播することを検証。

---

### 4.2 PBI-07: SQLite history panelのstate変更をreducerへ統一

#### 4.2.1 根本原因（why-why 6回）

1. なぜstate変更が直接mutationとreducerの二重経路にあるのか？
   - reducerを後から導入したが、listener closure内の書き換えが移行されていないため。
2. なぜlistener closure内の書き換えが移行されていないのか？
   - DOM操作とstate更新が同じクロージャ内で密結合しているため。
3. なぜ密結合しているのか？
   - panelの初期設計でstate seamを分離していなかったため。
4. なぜstate seamを分離していなかったのか？
   - 当時はDOM依存のテストのみで十分と判断していたため。
5. なぜDOM依存のテストだけでは不十分なのか？
   - jsdomの制約と再現性の低さにより、state遷移の網羅的検証が困難だから。
6. なぜ再現性が低いのか？
   - DOMイベントの順序や非同期fetchの応答タイミングがテストごとに変動するため。

**根本原因**: panel closureがstate更新とDOM更新を同じスコープで管理していた。

#### 4.2.2 解決策

- listener closure内の直接state mutationを `historyStateReducer` action dispatchに置き換える。
- `updateDynamicRegions()` と `renderState()` の重複listenerは、同じcallback setを参照するように共通化。
- `retryInitialLoad` 内の `state.loading = true`/`state.error = null` を `loadStart` actionに置き換え。
- `unmount` 内の `state.selectedIds.clear()` を `clearSelection` actionに置き換え。
- `refresh()` の呼び出し位置は維持し、state変更後に再描画をトリガー。

#### 4.2.3 変更箇所

- `src/dashboard/panels/asyncData/sqliteHistoryPanel.ts`
  - lines 512-535, 831-849 の listener closure
  - lines 922-923, 934 の直接代入
  - line 986 の `unmount` 内 `selectedIds.clear()`
- `src/dashboard/panels/asyncData/sqliteHistoryPanelState.ts`
  - 必要に応じて `rangeSelect` actionの扱いを見直し

#### 4.2.4 テスト

- 単体: `sqliteHistoryPanelState.test.ts` で全actionの正常系・境界値・error遷移を網羅。
- 統合: panel操作からreducer actionとquery呼び出しが連携することを検証。
- E2E: 履歴画面で検索、tag filter、pagination、selectionを操作。

---

### 4.3 PBI-08: metadata patch queueのpayload容量制御

#### 4.3.1 根本原因（why-why 6回）

1. なぜmetadata patch queueが肥大化するのか？
   - `saveMetadataStep` が content/AI summary を含むpatchをqueueに保存するため。
2. なぜcontentをqueueに保存するのか？
   - storage障害時にretryで同じpatchを再現するため。
3. なぜretryで同じpatchを再現する必要があるのか？
   - `saveSavedUrlEntryMetadata` はcontentを含む完全なmetadata更新を期待しているため。
4. なぜ完全なmetadata更新が必要なのか？
   - 部分的な更新を許すと、既存のsaved URL entryのデータ整合性が崩れるため。
5. なぜデータ整合性が崩れるのか？
   - mergeTags等のフィールド統合ロジックがあり、部分的更新が想定されていないため。
6. なぜ部分的更新を避けられないのか？
   - 大容量contentを含むpatchはstorage quotaを超える可能性があるため。

**根本原因**: retryのためのqueue永続化と、完全なmetadata更新の要求が矛盾している。

#### 4.3.2 解決策

- `PendingMetadataPatchWrite` に `createdAt` と `retryCount` を追加し、`RetryableItem` として扱う。
- `pendingChromeStorageQueue.ts` で `PersistentRetryQueue` 作成時に `maxPayloadBytes` を設定（例: 100KB）。
- enqueue前に同一URLの未処理patchをcoalescing（field merge、最新timestamp優先）。
- payloadがbyte上限を超える場合:
  - contentフィールドを分離して `contentOmitted: true` フラグを付与。
  - URL、timestamp、contentOmittedフラグを保持。
  - retry時にcontent欠落を検知し、部分的な更新（contentを除くfieldのみ）を試みるか、エラーログを残す。
- queue満杯時は最古itemをdropする `PersistentRetryQueue` の挙動を維持し、dropをログに記録。

#### 4.3.3 変更箇所

- `src/background/pendingChromeStorageQueue.ts`
  - `PendingMetadataPatchWrite` に `createdAt`, `retryCount` 追加
  - `PersistentRetryQueue` オプションに `maxPayloadBytes`, `maxRetryCount`, `ttlMs` を設定
- `src/background/pipeline/steps/saveMetadataStep.ts`
  - enqueue前にcoalescingロジックを呼び出し
  - 大容量content分離時のpatch構築
- 新規: `src/background/metadataPatchCoalescer.ts`（同一URL patch統合）

#### 4.3.4 テスト

- 単体: payload byte計算、上限境界、UTF-8文字列、coalescing、timestamp優先。
- 統合: queue追加、保存、flush、retryのbyte上限契約。
- E2E: storage障害後のretryが通常サイズ・大容量contentで期待した復旧状態になること。

---

### 4.4 PBI-01: Architecture Deepening Epicの完了条件整理

#### 4.4.1 根本原因（why-why 5回）

1. なぜEpicが部分実装のまま残っているのか？
   - handler registry移設が範囲外とされたため。
2. なぜhandler registry移設が範囲外とされたのか？
   - 影響範囲が大きく、子PBIの依存関係に含まれていなかったため。
3. なぜ影響範囲が大きいのか？
   - service workerのcomposition rootとhandlerの関係が複雑だから。
4. なぜcomposition rootとhandlerの関係が複雑なのか？
   - handlerが独自の依存を持ち、registryがそれらを解決しているため。
5. なぜhandlerが独自の依存を持つのか？
   - 各handlerが異なるclient/storage/設定にアクセスしているため。

**根本原因**: handlerの依存解決が分散しており、composition rootへの集約が当初のスコープに含まれていなかった。

#### 4.4.2 解決策

- Epicの完了条件を再定義する。
- 「handler registry移設」のスコープを明確化:
  - 候補A: `createMessageHandlerRegistry` の呼び出しを `createBackgroundServices` に移動し、`service-worker.ts` の責務を減らす。
  - 候補B: 現状の `service-worker.ts` 内構成を維持し、handler registry移設は別PBIとして切り出す。
- 推奨は **候補B**: 現時点では `createMessageHandlerRegistry` は既に抽象化されており、`service-worker.ts` 内の呼び出しも明確。移設は独立したリスクを持つため、Epicの完了を先に宣言し、移設は別PBIにする。
- PBI-01を完了扱いにするため、`pbi/00-INDEX.md` と `pbi/2026-08-11-01-architecture-deepening-epic.md` を更新。

#### 4.4.3 変更箇所

- `pbi/2026-08-11-01-architecture-deepening-epic.md`
- `pbi/00-INDEX.md`
- 新規PBI（任意）: `2026-08-XX-move-message-handler-registry-to-composition-root.md`

#### 4.4.4 テスト

- 既存テストがパスすることを確認。
- `createMessageHandlerRegistry` の composition test が維持されること。

---

### 4.5 PBI-08 (2026-08-07): AIClient/AIServiceの委譲化

#### 4.5.1 根本原因（why-why 6回）

1. なぜAIClientとAIServiceが二重にあるのか？
   - AIServiceへの段階的移行が完了していないため。
2. なぜ段階的移行が完了していないのか？
   - AIClientの削除は中核パスであり高リスクだから。
3. なぜ高リスクなのか？
   - 多くのテストと既存のフォールバック動作がAIClientに依存しているため。
4. なぜテストがAIClientに依存しているのか？
   - AIService経由のテストが未整備だから。
5. なぜAIService経由のテストが未整備なのか？
   - `RemoteAIService` がまだ `AIClient` を注入しているため、AIService単体では完全なカバレッジが取れないため。
6. なぜRemoteAIServiceがAIClientを注入しているのか？
   - 移行第一弾で既存ロジックを再利用するための橋渡し実装だったため。

**根本原因**: 移行の橋渡しとして `RemoteAIService` が `AIClient` に依存したまま固定化された。

#### 4.5.2 解決策

- `RemoteAIService` 内に `AIClient.generateSummaryInternal` / `testConnection` と同等のスロットループを再実装する。
- スロット解決、モデル適用、プロバイダーfactory呼び出しを `RemoteAIService` または新しい `RemoteAIServiceImpl` に集約。
- `AIClient` は `RemoteAIService` の薄い委譲ラッパーに縮小:
  - `generateSummary` → `RemoteAIService.generateSummary`
  - `testConnection` → `RemoteAIService.testConnection`
- `createAIService` / `aiServiceFactory.ts` から `AIClient` への依存を除去。
- 既存テスト `aiClient.test.ts`, `aiClient-timeout.test.ts`, `aiClient-priority-fallback.test.ts` は当面 `AIClient` 経由で動作するため、ラッパー化後もそのままパスする。
- 型ドリフト（model/modelName）は既に解消済み。`ProviderStrategy.ts` の `AIProviderConnectionResult.debug` と `AIService.ts` の `AiProviderTestResult.debug` を統一。

#### 4.5.3 変更箇所

- `src/background/ai/RemoteAIService.ts`
  - スロットループ、プロバイダーfactory呼び出し、progress通知を実装
- `src/background/aiClient.ts`
  - 薄い委譲ラッパー化
- `src/background/ai/aiServiceFactory.ts`
  - `AIClient` 依存を除去
- `src/background/ai/AIService.ts`
  - `AiProviderTestResult.debug` 型を `AIProviderConnectionResult.debug` と統一
- `src/background/ai/providers/ProviderStrategy.ts`
  - 必要に応じて型調整

#### 4.5.4 テスト

- 単体: `RemoteAIService` のフォールバック順序（成功/全失敗/built-in含む）。
- 統合: 各プロバイダーが `AIService` 経由で正しくディスパッチされること。
- 回帰: 既存 `aiClient*.test.ts` がパスすること。

---

### 4.6 PBI-17: マスターパスワード未設定時の暗号化鍵をsession storageへ移行

#### 4.6.1 根本原因（why-why 7回）

1. なぜ暗号化鍵がstorage.localに平文保存されているのか？
   - マスターパスワード未設定時のフォールバック方式だから。
2. なぜフォールバック方式が必要なのか？
   - 暗号化・復号に鍵が必要で、マスターパスワードが設定されていないユーザーもいるため。
3. なぜマスターパスワードが設定されていないのか？
   - デフォルトでは未設定であり、設定フローが追加のユーザー操作を要求するため。
4. なぜデフォルトが未設定なのか？
   - オンボーディングを簡易にし、利便性を優先していたため。
5. なぜ利便性を優先していたのか？
   - マスターパスワードは再起動ごとの再入力が必要で、ユーザー負担が大きいため。
6. なぜ再入力が必要なのか？
   - マスターパスワード自体を永続化しない設計だから。
7. なぜマスターパスワードを永続化しないのか？
   - パスワードを保存するとセキュリティが低下するため、メモリキャッシュのみにするため。

**根本原因**: 利便性のためのデフォルト未設定が、鍵の永続化を強いてしまい、セキュリティと利便性のトレードオフを生んでいる。

#### 4.6.2 解決策

- マスターパスワード未設定時のderived keyを非抽出 `CryptoKey` として `chrome.storage.session` に保持する。
- `ENCRYPTION_SECRET` / `ENCRYPTION_SALT` の storage.local 平文保存を停止。
- ただし、ブラウザセッション維持中は `chrome.storage.session` がSW再起動をまたいで保持される（`headerDetector.ts:161` 注記）。したがって、再設定要求は「ブラウザプロセス終了時」または「拡張機能再読み込み時」に発生する。
- 鍵がsessionに存在しない状態でAPIキーへアクセスしようとした場合:
  - ユーザーにマスターパスワード設定を促す通知を表示。
  - または、APIキー再入力を求める。
- マスターパスワード設定時のフローは変更しない（メモリキャッシュのみ、永続化なし）。
- `docs/PRIVACY.md` と `public/PRIVACY.md` を更新し、両ファイルを同期。

#### 4.6.3 変更箇所

- `src/utils/storage/encryptionSession.ts`
  - `getOrCreateEncryptionKey` のマスターパスワード未設定パスを修正
  - 非抽出CryptoKeyのsession storage保存/取得
  - storage.local からの `ENCRYPTION_SECRET`/`ENCRYPTION_SALT` 削除（移行処理）
- `src/utils/storage/types.ts`
  - 必要に応じてstorage key定数の整理
- `src/popup/` または `src/dashboard/`
  - 鍵不在時の再設定導線UI
- `docs/PRIVACY.md`, `public/PRIVACY.md`
  - 新しい挙動への更新

#### 4.6.4 テスト

- 単体: `encryptionSession.test.ts` で session storage への書き込み、local への非書き込みを検証。
- 統合: 暗号化→保存→取得のフルフローで鍵が local に書き込まれないことを確認。
- E2E: ブラウザセッション終了後の再設定導線を手動確認（Chrome実機）。

---

## 5. 実装順序と依存関係

```text
PBI-09 (fallback失敗契約)
   |
   v
PBI-07 (reducer統一) ─────┐
   |                       |
   v                       v
PBI-08 (queue容量)    PBI-01 (Epic完了整理)
   |                       |
   v                       v
PBI-08 AI (AIClient委譲化)
   |
   v
PBI-17 (encryption session storage)
```

### 5.1 順序の理由

1. **PBI-09を最初**: 範囲が狭く、副作用が軽微。`sqliteHistoryQuery.ts` の変更は PBI-07 にも影響するため先に完了させる。
2. **PBI-07を次**: panelのstate基盤を整備。PBI-08のUI影響を最小化。
3. **PBI-08を並行**: queue容量は独立して実装可能。
4. **PBI-01の整理**: 他のPBIに依存しない管理作業。
5. **PBI-08 AI**: `createBackgroundServices` やテスト構成に影響。他の中核変更後に実施。
6. **PBI-17を最後**: UX影響が大きく、独立している。実機検証が必要。

---

## 6. テスト戦略

### 6.1 共通ゲート

- 各PBI実装後に `npm run type-check` を実行。
- 各PBI実装後に関連テストを実行。
- 全PBI完了後に `npm run validate` を実行。

### 6.2 PBI別テスト重点

| PBI | 単体テスト | 統合テスト | E2E/手動 |
|-----|-----------|-----------|----------|
| 09 | fallback 3分岐 | panel error state伝播 | 履歴画面のerror表示 |
| 07 | 全reducer action | panel操作連携 | 検索/tag/pagination/selection |
| 08 | byte計算/coalescing | queue flush/retry | storage障害後の復旧 |
| 01 | 既存テスト回帰 | composition test | 不要 |
| 08 AI | FallbackAIService/RemoteAIService | AIService dispatch | AI接続テスト/要約 |
| 17 | session storage書き込み | 暗号化フルフロー | ブラウザ終了後の再設定 |

---

## 7. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| PBI-07でpanel動作が壊れる | 高 | 段階的に移行。各actionごとにcommit。E2Eで全操作を確認。 |
| PBI-08でcontentが失われる | 高 | content分離時に明示的なフラグを付与。retry時にエラー記録。 |
| PBI-08 AIで既存テストが失敗 | 中 | AIClientを薄いラッパーとして維持。段階的にテスト移行。 |
| PBI-17でUXが著しく悪化 | 高 | 実機でブラウザセッション維持中の動作を確認。マスターパスワード推奨フローを追加。 |
| 複数PBIの変更が競合 | 中 | 各PBIを独立したcommitに分ける。git diffをこまめに確認。 |

---

## 8. スケジュール見積もり

| PBI | 見積もり | 備考 |
|-----|---------|------|
| 09 | 0.5pt | 範囲狭、テスト追加程度 |
| 07 | 2pt | reducer移行、listener共通化、テスト |
| 08 | 2pt | coalescing、byte上限、content分離、テスト |
| 01 | 0.5pt | ドキュメント整理、INDEX更新 |
| 08 AI | 2pt | RemoteAIService拡張、AIClientラッパー化、テスト |
| 17 | 2pt | session storage移行、再設定導線、PRIVACY更新、テスト |
| **合計** | **9pt** | リスクバッファ含む |

---

## 9. Definition of Done

- [ ] すべてのPBIのBDDシナリオがテスト化されパスする
- [ ] `npm run type-check` が成功する
- [ ] `npm run test` が成功する
- [ ] `npm run build` が成功する
- [ ] `npm run validate` が成功する
- [ ] 各PBIの対象ファイルに直接mutation/重複コードが残っていない
- [ ] PRIVACY.md（docs/public両方）が同期されている
- [ ] `pbi/00-INDEX.md` が最新の状態に更新されている
- [ ] コードレビューが完了している

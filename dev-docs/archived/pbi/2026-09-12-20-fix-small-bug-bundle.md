# PBI 2026-09-12-20 — 小型バグバンドル（6 件）

- **種別**: 🔧非機能追加（fix）
- **優先度**: 4 位 / RICE **9.6**（R12 × I1 × C80% / E1.0人日）
- **出典**: round 11 診断 候補 20（サブエージェント探索・file:line は各項に記載）

## 背景（なぜ）

探索で見つかった小型の欠陥群。単独 PBI 化するほどではないが、放置すると顕在化時に追跡コストが高い。全件「最小 fix」で実施する。

## スコープ（6 件）

- [ ] **context menu の URL-blind drop**: `contextMenuHandlers.ts:41,51-55` — グローバル slot で 2 クリック目を URL に関係なく黙って捨てる（notificationHandlers.ts:42,74-78 は keyed で正しい）。tabId キー化に修正
- [ ] **recovered ログが負値になり得る**: `pendingChromeStorageQueue.ts:82-91` — `queue.load()` スナップショット後に flush が再 load するため `writes.length - stillPending.length` が負になり得る。in-lock 計測に修正（VULN-056 seam の二重活用）
- [ ] **checkDomainWithRetry の backoff 契約**: `visitAdmission.ts:102-118` — sleep が catch のみで、resolved だが空応答の場合は即時リトライになる（200ms linear backoff が 3 連射）。falsy 応答でも sleep
- [ ] **statusPanel の console.log**: `statusPanel.ts:316-321` — popup を開くたび cache headers を出力
- [ ] **wireOnce 紀律の共有化**: statusPanel 内 dataset.wired が 3 箇所コピペ（:145-147,:454-456,:476）→ domUtils に `wireOnce(el, fn)` を抽出
- [ ] **withTransaction の越境解消**: `IdbVfsBackend.ts:24` が opfsWorker/handlers.js から import（host → worker internals の逆流・isHandlerContext runtime 分岐で 2 interface を 1 署名に密輸）→ 中立 `sqliteTransaction.ts` へ抽出、handlers.ts は再 export

## 受け入れ基準（BDD）

### シナリオ 1: 各 fix が欠陥を解消する（ハッピーパス）
```gherkin
Given 上記 6 項目の欠陥がある
When 各 fix を適用する
Then context menu は tabId 毎に並行実行され、recovered は非負で、空応答でも backoff し、console.log はなく、wireOnce で二重配線せず、IdbVfsBackend は opfsWorker を import しない
```

### シナリオ 2: 最小 fix の原則（境界）
```gherkin
Given withTransaction の抽出
When 依存方向を検査する
Then 振る舞いは不変で、既存 transaction テストは import 先変更のみで green
```

## DoD

- [ ] 6 件実装 + 各 pin/回帰テスト
- [ ] 関連テスト green
- [ ] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟢なし

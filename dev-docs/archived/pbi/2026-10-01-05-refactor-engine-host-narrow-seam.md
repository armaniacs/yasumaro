# PBI: SqliteEngineHost の状態 accessor 縮小

## ユーザーストーリー

保守担当の開発者として、engine host の約 10 の get/set 透過を狭い seam に畳みたい、なぜなら共有 mutable 状態への素通しが各 backend から全 rung へ到達でき、init/degrade 順序の知識が host 外に漏れるから。

## 優先度

- 順位: 5 / 7（2026-10-01 arch-delivery-loop ラウンド。全体像は [00-backlog-archloop-1001](2026-10-01-00-backlog-1001.md)）
- RICEスコア: 8.5（Reach=8 / Impact=2 / Confidence=0.8 / Effort=1.5）
- 根拠: init/degrade 順序の locality を host に戻す。依存なし。

## 背景

- `src/offscreen/sqliteEngineHost.ts`（512 行、init ladder・degrade ladder・mutex・backend cache）、`src/offscreen/sqliteEngineContext/`（4 module が同一 state 交差型を操作）、`src/offscreen/sqliteEngine.ts`（worker 側と host 側で 2 つの engine 生成 seam）、`src/offscreen/backendResolver.ts`、`src/offscreen/sqliteBoot.ts`。

## BDD受け入れシナリオ

```gherkin
Scenario: backend 取得が狭い seam で完結する
  Given 未 init の host
  When ensureBackend を呼ぶ
  Then init ladder が 1 回だけ走り backend が返る

Scenario: OPFS 障害で degrade する
  Given OPFS rung 稼働中の host
  When OPFS 障害を検出する
  Then degradeFromOpfs が IDB rung へ一段だけ落とす
```

## 受け入れ基準

- [x] 公開状態 accessor を除去し seam を `init()`・`ensureBackend()`/`getBackend()`・`execWithCache()`・`tryOpfsProxy()`/`sendToOpfsWorker()`・`degradeFromOpfs()` に限定する（11 の get/set pair を削除。IdbVfsBackend は construction 時の live view（`idbBackendView`）を受け取る。`terminateOpfsWorker`/`resetBackend` は private 化）
- [x] degrade ladder と `resolveBackend` 優先順位を host に寄せ、`backendResolver.ts` は純粋な判定 table にする（BACKEND_FACTORIES + createBackend を host の private `createBackendFor` へ移設。IDB rung の init 前置は init 順序の知識として host に帰属。backendResolver は resolveBackend + BackendType + capability 検出のみ）
- [x] WASM boot（`wasmUrlOverride`・`useOpfsStorage`/`useIdbStorage`・拡張登録）を `sqliteBoot.ts` の単一生成 seam に寄せる（wrapDb + wasmUrlOverride + set/get + createEngine/createIdbEngine を sqliteBoot.ts へ移設。sqliteEngine.ts は型定義 + wrapDb 境界テスト群向けの互換 re-export のみ）
- [x] ADR-014 の 3 段 fallback（OPFS Worker → IDB VFS → chrome.storage.local）を維持する

## テスト戦略

- 単体: init/degrade 順序を host seam 越しに検証（fake backend adapter）→ 既存の coverage 系テストを host seam 経由に移行（state 観測は context module が受ける state オブジェクトのキャプチャに統一）+ `engineHostSeam.test.ts`（公開表面 pin）
- 既存: `sqliteEngine-comprehensive` 系テストは不変で通ること（sqliteEngine.ts の互換 re-export で維持）
- 統合: `npm run validate` が通ること

## 見積もり

1.5 SP（要チームでの見積もり）

## 実装記録（2026-10-01）

- host: 11 の get/set accessor pair を削除。IdbVfsBackend は duck type（`IdbVfsBackendHost`: execWithCache + idbEngine/fts5Available/cachedCompileOptions の live getter）を host の private `idbBackendView` 経由で受ける。OpfsWorkerBackend は既に sanctioned seam（tryOpfsProxy/sendToOpfsWorker/degradeFromOpfs）のみ
- backendResolver: BACKEND_FACTORIES + createBackend を host の private `createBackendFor` へ移設（switch 4 rung + NoopBackend）。backendResolver.ts は resolveBackend（純粋判定）+ BackendType + detectOpfsCapabilitiesForResolver のみに
- sqliteBoot: wrapDb + wasmUrlOverride + setSqliteWasmUrlOverride/getSqliteWasmUrlOverride + createEngine/createIdbEngine を移設（単一生成 seam）。sqliteEngine.ts は型 + 互換 re-export。production consumer（opfsWorker・archive/backup handler 5 ファイル・idbEngineLifecycle・opfsWorkerProxy・service-worker の動的 import）は sqliteBoot.js 経由に更新
- テスト: state 観測を「context module が受ける state オブジェクトのキャプチャ（wrapped initOpfsWorker の call-through）」に統一（opfsDegradation.integration・sqliteEngineContext/coverage）。backendResolver-coverage の createBackend ブロックは host の getBackend seam 経由に書き換え（到達不可の none/unknown factory ケースは resolveBackend の純粋テストで担保）。`engineHostSeam.test.ts` 新設（accessor 不在 + seam 存在の表面 pin）。生成関数を mock するテストの vi.mock path を sqliteBoot.js へ更新（importOriginal スプレッドで他 export を保持）
- 検証: `npm run validate` green（991 ファイル / 15,256 tests passed）

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] type-check / lint / test / build が通る
- [x] コードレビュー完了

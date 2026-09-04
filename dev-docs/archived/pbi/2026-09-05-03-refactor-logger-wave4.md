# PBI 03: Logger Wave 4 — core 配線の注入化と barrel 分割

優先度: 3 位 / RICE 20.0 = (15 × 1 × 80%) / 0.6w / Strength: Strong
backlog: [2026-09-05-00-backlog-arch3.md](2026-09-05-00-backlog-arch3.md)
依存: なし（他 6 件と独立。LAYERS.md Wave 4 の計画実行）

## ユーザーストーリー
ログ基盤を保守する開発者として、`logger/core.ts` が adapter と scheduler を注入で受け取り、`logger.ts` barrel が分割されてほしい。なぜなら `logInfo/logWarn/…` は薄い pass-through である一方、配線（`new ChromeStorageLogAdapter` / `new ChromeAlarmFlushScheduler` のモジュールグローバル :20-22）が hard-wire され、fakes（`InMemoryLogAdapter` / `ImmediateFlushScheduler`）が存在するのに core が使わず、chrome モックなしにテストできないから。

## BDD受け入れシナリオ

```gherkin
Scenario: in-memory 配線で chrome なしにログの書き込みと取得ができる
  Given InMemoryLogAdapter + ImmediateFlushScheduler を注入した core
  When  addLog → flushLogs → getLogs を実行する
  Then  chrome モックなしに書き込んだエントリが取得できる

Scenario: 本番配線は従来どおり chrome に永続化する
  Given デフォルト配線（ChromeStorageLogAdapter + ChromeAlarmFlushScheduler）
  When  addLog を実行する
  Then  chrome.storage.local に永続化され、alarm で flush される

Scenario: 新規コードは barrel を経由しない
  Given 新規の import
  When  logger/* から直接 import する
  Then  lint が警告せず、旧 `utils/logger.ts` 経由は shim として残る
```

## 受け入れ基準
- [x] `core.ts` のモジュールグローバル 3 点（buffer/storage/scheduler :20-22）が init パラメータ化され、デフォルトは本番配線・テストは in-memory 配線
- [x] `typeof chrome` 分岐（:35-40）が adapter 側に隠蔽される（offscreen の console フォールバック含む）
- [x] `logger.ts` barrel が shim 化し、新規 import は `logger/*` 直接（storage.ts 分割 PBI 2026-08-21-04 と同方式、eslint 制限付き）。既存約120箇所は warn のまま残し、直接 import 移行は別 PBI 化（本 PBI の対象外）
- [x] logger → storage の循環回避（`storageTransaction.ts` の logger-free 方針）が維持される
- [x] 既存 logger suite が green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- in-memory 配線で `addLog/getLogs/clearLogs/flushLogs` を interface 経由で駆動（flush ウィンドウの決定的アサーション）
- adapter 交換テスト: Chrome adapter と InMemory adapter の振る舞い等価性
### 統合テスト
- 既存の logger テストは配線差し替えのみで green（chrome モックの削減を確認）
### 例外ハンドリング
- flush 失敗時の console.error フォールバック（:44）は維持

## 実装アプローチ
- **Outside-In**: init パラメータの型（ports.ts 式の adapter 形状）から設計 → core 置換 → barrel 分割

## 見積もり
0.6w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: `adapter` + `scheduler` を注入可能に（`Clock` / `StoragePort` と同形状）
- 非機能要件: `MAX_PENDING_LOGS=100` / `BATCH_FLUSH_SIZE=10` 等の定数は不変。約120箇所の呼び出し側は無修正
- `Mutex.ts` の `safeAddLog` ガードは本 PBI の対象外（循環を壊さないこと）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "new (ChromeStorageLogAdapter|ChromeAlarmFlushScheduler|LogBuffer)" src/utils/logger/core.ts
rg -n "InMemoryLogAdapter|ImmediateFlushScheduler" src/utils/logger/*.ts
grep -rn "from.*utils/logger.js" src/ --include="*.ts" | wc -l
```
2026-09-05 時点: core.ts 133 行、api.ts 176 行、storageAdapter.ts 65 行、flushScheduler.ts 73 行、buffer.ts 38 行。fakes は存在するが core が使わない。barrel（43 行）経由が約120箇所。

### 実装手順
1. `core.ts` に `initLogger({ adapter, scheduler })`（または同等）を追加し、グローバルを注入化
2. デフォルト配線を composition 側（background root）に寄せ、テストは in-memory 配線に
3. `logger.ts` を shim 化し、新規直接 import を許可・旧経路を lint 制限（storage.ts 前例に準拠）
4. 全テスト green（chrome モック削減の差分を確認）

### 落とし穴
- `scheduler.onFlushRequested(() => persistPending())`（:54）の登録タイミング — init 化で二重登録しないこと
- offscreen の console フォールバック（:35-40）は adapter の責務に移すが、振る舞いは変えないこと
- `storageAdapter.ts` の `runSerialized` 依存は維持（logger-free の storageTransaction 側を汚さない）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] logger 全テスト green（chrome モック削減を確認）
- [x] コードレビュー完了
- [x] ドキュメント更新（LAYERS.md の Wave 4 を完了にし、logger/* の層注記を同期）

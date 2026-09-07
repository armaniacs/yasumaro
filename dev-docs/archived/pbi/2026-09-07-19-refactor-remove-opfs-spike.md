# PBI: OPFS feasibility spike（`opfsSpike.ts` / `runOpfsSpikeA` / `SQLITE_OPFS_SPIKE`）の撤去

## ユーザーストーリー
SQLite / OPFS 周辺を保守する開発者として、一次検証としての役目を終えた OPFS feasibility spike（`opfsSpike.ts` / `runOpfsSpikeA` / メッセージタイプ `SQLITE_OPFS_SPIKE`）を製品コード・メッセージ経路・診断 UI・ロケール・テストから取り除きたい、なぜなら ADR-014 の実装完了（コミット `a1f60007`、2026-06）から 1 年以上が経過し案A は正規実装として稼働しているのに、discriminated union の 1 分岐に 13 ファイルの型・配線・UI・ロケールが張り付いたまま残り、`SqliteMessage` union と `InMemoryTransport` の exhaustive `never` チェックを読み解くコストを恒常的に発生させているから。診断価値は既存の OPFS 移行状態表示と divergence 警告と重複しており、過去の GitHub issue 全 4 件に OPFS / SQLite / spike / fallback 関連はゼロで、"Run OPFS Spike" ボタンがサポートで使われた形跡もない。

## 優先度
- 順位: 07 / 7（2026-09-07 architecture review round の候補群）
- RICEスコア: 1.17（Reach=2 / Impact=0.5 / Confidence=70% / Effort=0.6人週）
- 根拠: ADR-014 実装完了から 1 年以上（コミット `a1f60007` は 2026-06）、案A は正規実装として稼働。スパイクの本来目的（実現性確定）は終了。診断価値は既存の OPFS 移行状態表示・divergence 警告と重複。**過去の GitHub issue（全 4 件）に OPFS / SQLite / spike / fallback 関連はゼロ** = "Run OPFS Spike" ボタンがサポートで使われた形跡なし。discriminated union の分岐 1 つに 10 ファイル超が張り付き、保守コストが機能価値に見合わない。Confidence が 70% に留まるのは、完全削除と「開発スクリプトへの格下げ」のどちらを採るか（未解決事項 4）と、`@subframe7536/sqlite-wasm` バージョンアップ時の回帰確認フロー（未解決事項 3）が未確定なため。

## BDD受け入れシナリオ

```gherkin
Scenario: 診断パネルから "Run OPFS Spike" ボタンが消える
  Given OPFS spike を撤去した dashboard
  When  options ページの診断パネルを開く
  Then  "Run OPFS Spike" ボタン（#diagOpfsSpikeBtn）と結果表示欄（#diagOpfsSpikeResult）が存在しない

Scenario: OPFS 移行状態表示は引き続き機能する
  Given OPFS spike を撤去した dashboard
  And   offscreen が OPFS バックエンドで稼働している状態
  When  診断パネルを開く
  Then  OPFS 移行状態（offscreen / dashboard それぞれのバックエンド検出結果）が従来どおり表示される

Scenario: divergence 警告は引き続き機能する
  Given OPFS spike を撤去した dashboard
  And   offscreen がフォールバック、dashboard が OPFS を検出している状態
  When  診断パネルを開く
  Then  offscreenUsesFallback / dashboardDetectsOpfs の乖離警告が従来どおり表示される

Scenario: SQLite メッセージ union から SQLITE_OPFS_SPIKE が外れてもコンパイルが通る
  Given SqliteMessage union から SQLITE_OPFS_SPIKE を削除した状態
  When  npm run type-check を実行する
  Then  InMemoryTransport の exhaustive never チェックを含め型エラーが 0 件になる

Scenario: SQLITE_MESSAGE_TYPES から opfsSpike 相当が除去されている
  Given 撤去後の src/messaging/sqliteMessages.ts
  When  SQLITE_MESSAGE_TYPES 配列を検査する
  Then  'SQLITE_OPFS_SPIKE' が含まれず、sqliteMessages.test.ts の該当アサーションも更新されている

Scenario: ロケールから opfsSpike ボタンキーが消え i18n チェックが通る
  Given 撤去後の public/_locales/{ja,en}/messages.json
  When  npm run check-i18n を実行する
  Then  diagOpfsSpikeBtn キーが ja / en 双方から削除され、チェックが PASS する

Scenario: 製品 Worker（opfsWorker.js / WASM チャンク）は残る
  Given OPFS spike を撤去して npm run build した dist/chromium-mv3
  When  出力を検査する
  Then  opfsWorker のチャンクと WASM は従来どおり存在し（案Aの正規経路）、opfsSpike-*.js チャンクのみが消えている

Scenario: validate が通る
  Given OPFS spike を撤去した状態
  When  npm run type-check / npm test / npm run build / npm run check-i18n を実行する
  Then  すべて PASS する
```

## 受け入れ基準
- [x] `src/offscreen/opfsSpike.ts`（全 87 行）が削除される（縮退案を採る場合は製品バンドルの到達グラフから切り離したスタンドアロン手動スクリプトに格下げ）
- [x] `runOpfsSpikeA` / `runSpikeSteps` / 型 `SpikeStep` / `SpikeStepResult` / `OpfsSpikeReport` への参照が製品コードから消える
- [x] メッセージタイプ `SQLITE_OPFS_SPIKE` が `SqliteMessage` union（`src/messaging/sqliteMessages.ts:33`）と `SQLITE_MESSAGE_TYPES`（同 :77）から削除される
- [x] offscreen レスポンス型 `OffscreenOpfsSpikeResponse` と `import type { OpfsSpikeReport }`（`sqliteMessages.ts:123,182-183,312`）が削除される
- [x] RPC クライアントの `MaintainOp` から `{ type: 'opfsSpike' }`（`src/messaging/sqliteRpcClient.ts:10,129,167`）が削除される
- [x] バリデータ `OpfsSpikeStepResult` / `OpfsSpikeReportView` / `decodeOpfsSpikeReport()`（`src/messaging/sqliteValidators.ts:115-123`）が削除される
- [x] offscreen ハンドラ `handleOpfsSpike()` とハンドラテーブルの `SQLITE_OPFS_SPIKE: handleOpfsSpike`（`src/offscreen/sqliteMessageHandlers.ts:296-298,498`）が削除される
- [x] background gateway の `maintain({type:'opfsSpike'})` → `callInternal('SQLITE_OPFS_SPIKE', ...)` 経路（`src/background/sqlite/offscreenGateway.ts:21,50,121,151,220`）が削除される
- [x] background handler deps の `runOpfsSpike`（`src/background/handlers/dashboardSqlite/deps.ts:44,168`）と read-only handler の `opfs_spike` 分岐（`readOnlyHandler.ts:80`）が削除される
- [x] protocol 型の `S extends 'opfs_spike' ? ...`（`src/background/handlers/dashboardSqliteProtocol.ts:14,133`）が削除される
- [x] `src/background/inMemoryTransport.ts:162` の `case 'SQLITE_OPFS_SPIKE'` が削除され、exhaustive `never` チェックが通る
- [x] dashboard サービスの `runOpfsSpike(): Promise<ServiceResult<OpfsSpikeReportView>>`（`src/dashboard/dashboardSqliteService.ts:24,192,198-203`）が削除される
- [x] HTML `entrypoints/options/index.html:1967` の `#diagOpfsSpikeBtn` / `#diagOpfsSpikeResult` が削除される
- [x] 配線（`src/dashboard/panels/diagnostic/diagnosticsPanel.ts:479,487`）とハンドラ（`diagnosticsActions.ts:221-245`）が削除される
- [x] ロケールキー `diagOpfsSpikeBtn` が `public/_locales/ja/messages.json` と `public/_locales/en/messages.json` の双方から削除され、`npm run check-i18n` が PASS する
- [x] 依存テストが削除・修正される（テスト戦略節の一覧すべて）。`src/offscreen/__tests__/opfsSpike.test.ts` は削除
- [x] `testDir/vitest.config.ts:53` のカバレッジ対象から `opfsSpike.ts` の明示が外れる
- [x] E2E `testDir/e2e/dashboard-diagnostics.spec.ts:25,31` と `dashboard-ui.spec.ts:311,320` の `#diagOpfsSpikeBtn` / `#diagOpfsSpikeResult` 存在 assert が削除される
- [x] ADR-014（`dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md`）の Consequences か注記に「実機確認用スパイク（`runOpfsSpikeA`）は 2026-09 に削除、案Aの継続的健全性確認は診断パネルの OPFS 移行状態表示 / divergence 警告で代替」を追記
- [x] 製品 Worker `opfsWorker.ts`（363KB WASM チャンク）は無修正
- [x] `wxt.config.ts`（CSP）は無修正
- [x] `npm run type-check` / `npm test` / `npm run check-i18n` / `npm run build` がすべて PASS
- [x] 振る舞いが変更前と同一（デッドコード撤去 + 診断機能の縮退。OPFS 状態表示 / divergence 警告は不変）

## テスト戦略
### 単体テスト
- `SQLITE_MESSAGE_TYPES` に `'SQLITE_OPFS_SPIKE'` が含まれないことを `src/messaging/__tests__/sqliteMessages.test.ts` で検証（:56 のアサーション更新）
- `InMemoryTransport` の `switch` が exhaustive `never` チェックを含め型エラー 0 でコンパイルされること（`npm run type-check`）
- `handleOpfsSpike` を参照していた `src/offscreen/__tests__/sqliteMessageHandlers-coverage.test.ts:42-43,76,100,175-177` を該当ケース削除で修正
- `runOpfsSpike` を参照していた `src/background/__tests__/sqliteClient.test.ts:265-282` を削除
- `runOpfsSpike` deps を参照していた `dashboardSqliteHandlers.test.ts:23,123-125` / `dashboardSqliteHandlers-lastError.test.ts:244` を修正
- dashboard サービスの `src/dashboard/__tests__/dashboardSqliteService-extra.test.ts:25,87-109` を削除
- `diagnosticsActions.test.ts:11,27,37,45,214-230`（spike アクション）を削除
- `diagnosticsPanel.lifecycle.test.ts:49-50` / `diagnosticsPanel.migration.test.ts:74-75`（`#diagOpfsSpikeBtn` 前提）を修正
- 撤去後、`opfsSpike` / `OpfsSpikeReport` / `SQLITE_OPFS_SPIKE` / `opfs_spike` を製品コードが import していないことを grep ベースのガードテストで固定

### 統合テスト
- 診断パネル経路で OPFS 移行状態表示（`diagnosticsPanel.ts:250-330`）が撤去後も機能することを検証
- `DiagnosticsCollector` の divergence 検知（`offscreenUsesFallback` / `dashboardDetectsOpfs`、`diagnosticsPanel.ts:429-434`）が撤去後も機能することを検証

### E2E
- 診断パネルに `#diagOpfsSpikeBtn` / `#diagOpfsSpikeResult` が存在しないこと（`dashboard-diagnostics.spec.ts` / `dashboard-ui.spec.ts` の該当 assert を「存在する」から「存在しない」へ、または削除）
- 診断パネルを開き、OPFS 移行状態表示が引き続き見えること（DoD の実機確認に対応）
- Playwright の既知の注意点（`waitForSelector('.hidden')` は `{ state: 'hidden' }`、StorageKeys は snake_case、storage 注入は popup オープン前 / background page 経由）に留意

### 例外ハンドリング
- 撤去対象は「実際に一連の DB 操作を走らせてステップ単位の失敗箇所を出す」再現手段のみ。OPFS 状態表示 / divergence 警告の既存アサーションは診断パネル経路の契約テストとして維持

## 実装アプローチ

`SqliteMessage` は discriminated union + `InMemoryTransport` の exhaustive `never` チェックがあるため、union から外すと全 `switch` を同時に直さないとコンパイルが通らない。逆に言えばコンパイルエラーを潰しきれば漏れは機械的に検出できる。

1. **縮退案の可否を確定**（未解決事項 3, 4）。完全削除か「メッセージ経路・UI・ロケールは削除、`opfsSpike.ts` は開発時のみ実行するスタンドアロン手動スクリプトに格下げ（製品バンドルの到達グラフから切り離す）」か。`@subframe7536/sqlite-wasm` の更新フローで実機疎通確認を残す必要があるなら格下げ案を採る
2. **UI 導線の撤去**。`entrypoints/options/index.html:1967` の `#diagOpfsSpikeBtn` / `#diagOpfsSpikeResult` を削除、`diagnosticsPanel.ts:479,487` の配線と `diagnosticsActions.ts:221-245` のハンドラを削除。ロケール `diagOpfsSpikeBtn` を ja / en 双方から削除
3. **dashboard サービス層の撤去**。`dashboardSqliteService.ts` の `runOpfsSpike` を削除
4. **background 層の撤去**。`dashboardSqliteProtocol.ts` の `opfs_spike` 分岐、`readOnlyHandler.ts:80`、`deps.ts` の `runOpfsSpike`、`offscreenGateway.ts` の `opfsSpike` 経路を削除
5. **RPC / メッセージ層の撤去**。`sqliteRpcClient.ts` の `MaintainOp` から `opfsSpike` を削除、`sqliteValidators.ts` の `decodeOpfsSpikeReport` 系を削除、`sqliteMessages.ts` の union メンバ・`SQLITE_MESSAGE_TYPES` エントリ・`OffscreenOpfsSpikeResponse`・`OpfsSpikeReport` の import を削除
6. **offscreen 層の撤去**。`sqliteMessageHandlers.ts` の `handleOpfsSpike` とハンドラテーブルエントリを削除、`opfsSpike.ts` を削除（または格下げ）
7. **`InMemoryTransport` の `switch` を修正**。`case 'SQLITE_OPFS_SPIKE'` を削除し exhaustive `never` を通す。`inmemoryTransport.ts:162` は PBI 2026-09-07-17 と同ファイルなので順序を調整
8. **テストの同時修正**。テスト戦略節の一覧に沿って削除・修正。`vitest.config.ts:53` のカバレッジ明示を除去
9. **E2E の修正**。`#diagOpfsSpikeBtn` 存在 assert を削除
10. **ADR-014 追記**。Consequences か注記に撤去と代替手段を明記
11. **`npm run type-check` / `npm test` / `npm run check-i18n` / `npm run build` で漏れを検出**

## 見積もり
3ポイント（0.6人週相当：削除自体は discriminated union + exhaustive `never` の型連鎖でコンパイルエラーを潰せば漏れは出にくいが、13 ファイルの製品コード + 9 ファイルのテスト + HTML + ロケール 2 + E2E 2 + カバレッジ設定と横断範囲が広く、縮退案の判断と ADR 追記を含む）

## 実装者向け注記

### 定義（2026-09-07 調査）

- `src/offscreen/opfsSpike.ts`（全 87 行）: `runSpikeSteps()`（オーケストレータ、ユニットテスト済み）、`runOpfsSpikeA()`（:59〜、`new Worker(new URL('./opfsWorker.js', import.meta.url))` + `postMessage('run')` で `OpfsSpikeReport` を resolve）、型 `SpikeStep` / `SpikeStepResult` / `OpfsSpikeReport`。冒頭コメント「OPFS feasibility spike harness (PBI-10)」
- 履歴: `a1f60007 feat(opfs): PBI-10 OPFS feasibility spike` で追加 → `2990035d chore: remove unused OPFS spike function runOpfsSpikeB`（案B削除、案Aのみ残存）→ 以降は型安全化リファクタのみ

### メッセージ経路（製品コードに組み込まれている、全 13 ファイル）

| レイヤー | ファイル:行 |
|---|---|
| メッセージ型 union | `src/messaging/sqliteMessages.ts:33`（`{ type: 'SQLITE_OPFS_SPIKE'; payload?: never; traceId?: string }`） |
| 型定数配列 | `sqliteMessages.ts:77`（`SQLITE_MESSAGE_TYPES`） |
| offscreen レスポンス型 | `sqliteMessages.ts:123,182-183,312`（`OffscreenOpfsSpikeResponse`、`import type { OpfsSpikeReport }`） |
| RPC クライアント型 | `src/messaging/sqliteRpcClient.ts:10,129,167`（`MaintainOp` に `{ type: 'opfsSpike' }`） |
| バリデータ | `src/messaging/sqliteValidators.ts:115-123`（`OpfsSpikeStepResult` / `OpfsSpikeReportView` / `decodeOpfsSpikeReport()`） |
| offscreen ハンドラ | `src/offscreen/sqliteMessageHandlers.ts:296-298,498`（`handleOpfsSpike()` が `await import('./opfsSpike.js')`、ハンドラテーブル `SQLITE_OPFS_SPIKE: handleOpfsSpike`） |
| background gateway | `src/background/sqlite/offscreenGateway.ts:21,50,121,151,220`（`maintain({type:'opfsSpike'})` → `callInternal('SQLITE_OPFS_SPIKE', ...)`） |
| background handler deps | `src/background/handlers/dashboardSqlite/deps.ts:44,168`（`runOpfsSpike: () => sqliteClient.maintain({ type: 'opfsSpike' })`） |
| background read-only handler | `src/background/handlers/dashboardSqlite/readOnlyHandler.ts:80`（`opfs_spike` メッセージ → `deps.runOpfsSpike()`） |
| protocol 型 | `src/background/handlers/dashboardSqliteProtocol.ts:14,133`（`S extends 'opfs_spike' ? { success: true; report: OpfsSpikeReport } : ...`） |
| InMemoryTransport | `src/background/inMemoryTransport.ts:162`（`case 'SQLITE_OPFS_SPIKE'` — **exhaustive `never` チェックあり**、union から外すと同時対応必須） |
| dashboard サービス | `src/dashboard/dashboardSqliteService.ts:24,192,198-203`（`runOpfsSpike(): Promise<ServiceResult<OpfsSpikeReportView>>`） |

### UI 導線（本番、ユーザーがクリック可能）
- HTML `entrypoints/options/index.html:1967`（`#diagOpfsSpikeBtn` "Run OPFS Spike" ボタン、直下に `#diagOpfsSpikeResult`）
- 配線 `src/dashboard/panels/diagnostic/diagnosticsPanel.ts:479,487`、ハンドラ `diagnosticsActions.ts:221-245`
- ロケール `public/_locales/{ja,en}/messages.json` に `diagOpfsSpikeBtn` キー（en: "Run OPFS Spike"）
- 表示条件: デバッグモード限定ではない（常時表示、ただし options ページ内なので一般利用者が偶然踏むことは少ない）

### 製品ビルドへの混入
含まれている（tree-shaking されない）。`dist/chromium-mv3/chunks/opfsSpike-*.js`（554 バイト）+ `background.js` に 2 箇所 + options.html のボタン + ロケール。純粋な spike code は 554 バイトのみ、残りは型・配線・UI・ロケール。**製品 Worker `opfsWorker.js`（約 363KB WASM 同梱）は削除対象外**（スパイクは製品 Worker を流用しているだけ、バンドルサイズはほぼ減らない）。

### テスト（union / 経路に依存、削除・修正が必要）
`src/offscreen/__tests__/opfsSpike.test.ts`（削除）、`sqliteMessageHandlers-coverage.test.ts:42-43,76,100,175-177`、`src/background/__tests__/sqliteClient.test.ts:265-282`、`dashboardSqliteHandlers.test.ts:23,123-125`、`dashboardSqliteHandlers-lastError.test.ts:244`、`src/dashboard/__tests__/dashboardSqliteService-extra.test.ts:25,87-109`、`diagnosticsActions.test.ts:11,27,37,45,214-230`、`diagnosticsPanel.lifecycle.test.ts:49-50`、`diagnosticsPanel.migration.test.ts:74-75`、`src/messaging/__tests__/sqliteMessages.test.ts:56`、E2E `testDir/e2e/dashboard-diagnostics.spec.ts:25,31` と `dashboard-ui.spec.ts:311,320`（`#diagOpfsSpikeBtn` / `#diagOpfsSpikeResult` の存在 assert）、カバレッジ設定 `testDir/vitest.config.ts:53`

### ADR-014（= `dev-docs/ADR/2026-06-17-opfs-fts5-coexistence.md`）
- スパイク A が検証: 案A（offscreen document から Worker spawn、Worker 内で `createSyncAccessHandle` を使い wa-sqlite / 後に `@subframe7536/sqlite-wasm` を動かす）が MV3 offscreen 環境で成立するか（WXT / Vite の Worker バンドル、OPFS 同期アクセスハンドル取得、DB open→CREATE→INSERT→SELECT→FTS5→リロード後の永続化）
- 現状: ADR は Status: Implemented (2026-06-17)。案A は製品の正規経路（`opfsWorker.ts` + `OPFSCoopSyncVFS` + FTS5）として本実装済み。3 段フォールバックも稼働
- スパイクの一次検証としての役目は完全に終了。診断価値は診断パネルの OPFS 移行状態表示（`diagnosticsPanel.ts:250-330`）と `DiagnosticsCollector` の divergence 検知（`offscreenUsesFallback` / `dashboardDetectsOpfs`、`diagnosticsPanel.ts:429-434`）でカバー済み。スパイクの追加価値は「実際に一連の DB 操作を走らせてステップ単位の失敗箇所を出す」再現手段のみ

### 削除範囲
上記メッセージ経路 13 ファイル + テスト 9 ファイル + HTML + ロケール 2 + E2E 2 + カバレッジ設定。**CSP 変更は不要**（`wxt.config.ts:85` は `script-src 'self' 'wasm-unsafe-eval'`、Worker は同一オリジン `web_accessible_resources` 経由、製品 `opfsWorker.js` は残る）。ADR-014 の Consequences か注記に「実機確認用スパイク（`runOpfsSpikeA`）は 2026-09 に削除、案Aの継続的健全性確認は診断パネルの OPFS 移行状態表示 / divergence 警告で代替」を追記。削除は横断的だが discriminated union + exhaustive `never` で型連鎖するのでコンパイルエラーを潰せば漏れは出にくい。

### この PBI でやること
`opfsSpike.ts` / `runOpfsSpikeA` / `SQLITE_OPFS_SPIKE` を製品コードから**削除**する（上記削除範囲すべて）。
- 縮退案（選択肢として）: 完全削除ではなく「メッセージ経路・UI・ロケールは削除、`opfsSpike.ts` は開発時のみ実行するスタンドアロン手動スクリプトに格下げ（製品バンドルの到達グラフから切り離す）」

### 制約
- `SqliteMessage` は discriminated union + `InMemoryTransport` の `const exhaustive: never` チェックあり。union から外すと同時に全 `switch` を直さないとコンパイルが通らない（= 機械的に検出できるが一括対応必要）
- `src/messaging/__tests__/sqliteMessages.test.ts` が `SQLITE_MESSAGE_TYPES` の内容を検証、`testDir/vitest.config.ts` がカバレッジ対象に `opfsSpike.ts` を明示、E2E 2 本が `#diagOpfsSpikeBtn` の存在を assert — テスト側の同時修正必須
- 製品 Worker `opfsWorker.ts`（363KB WASM チャンク）は削除対象外
- CSP（`wxt.config.ts`）変更不要。触らない
- ロケールキー削除は ja / en 両方。`npm run check-i18n` PASS 必須
- 実機での「ボタン消失後に診断パネルで OPFS 状態が引き続き見えること」の確認を DoD に含める

### 依存
- `src/background/inMemoryTransport.ts:162` の変更は PBI 2026-09-07-17（InMemoryTransport DELETE 乖離明示）と同ファイル。順序は問わないが両方が同じファイルを触ることに注意

### 現状コードの確認
```bash
rg -n "opfsSpike|OpfsSpike|OPFS_SPIKE|opfs_spike|runOpfsSpike|OpfsSpikeReport" src entrypoints public testDir --glob '!**/dist/**'
rg -n "diagOpfsSpikeBtn|diagOpfsSpikeResult" entrypoints src public testDir
rg -n "SQLITE_MESSAGE_TYPES" src
git log --oneline -- src/offscreen/opfsSpike.ts
```

## 未解決事項
1. **フィールドサポート用途**: 既存の移行状態表示は「結果の状態」しか出さず「どのステップでコケたか」は出さない。この切り分け価値が実運用で使われているか → 調査: 過去 GitHub issue 全 4 件に OPFS 関連ゼロ。使用実績なし
2. **`divergence` 警告との棲み分け**: スパイクが提供する追加情報は「実際に DB 操作を走らせた時の失敗ステップ」だけ。乖離検知で十分か
3. **`@subframe7536/sqlite-wasm` バージョンアップ時の回帰確認**: ライブラリ更新（v1.1.1 → v1.3.1）のたびに実機で OPFS+FTS5 疎通を確認したい開発フローがあるなら「開発スクリプト」として残す価値がある（製品経路である必要はない）
4. **削除 vs 格下げ**: 完全削除ではなく「メッセージ経路・UI・ロケールは削除、`opfsSpike.ts` は開発スクリプト化」で保守コスト削減とサポート手段温存を両立できないか

## Definition of Done
- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] 未解決事項 1〜4 が本 PBI 内または実装時に結論付けられ、記録されている（特に「完全削除」か「開発スクリプトへの格下げ」かの決定）
- [x] `npm run type-check` / `npm test` / `npm run check-i18n` / `npm run build` がすべて PASS（`InMemoryTransport` の exhaustive `never` チェックを含む）
- [x] 製品 Worker `opfsWorker.ts`（WASM チャンク）と `wxt.config.ts`（CSP）が無修正であることを確認
- [ ] 実機確認: options ページの診断パネルから "Run OPFS Spike" ボタンが消え、OPFS 移行状態表示と divergence 警告が引き続き機能すること（注記: 実装環境で実機 Chrome による確認が実行不可のため未実施。`npm run build` 後の dist 目視と E2E の「存在しない」アサーションで代替済み。レビュー時に実機確認のこと）
- [x] コードレビュー完了
- [x] ドキュメント更新（ADR-014 の Consequences / 注記に撤去と代替手段を追記。`dev-docs/DESIGN_SPECIFICATIONS.md` / `dev-docs/ARCHITECTURE_MAP.md` の該当記述から OPFS spike を削除。`docs/i18n-guide.md` のキー数記載を更新。CHANGELOG.md に撤去を記録）

## 実装メモ（2026-09-07 実装時記録）

### 未解決事項 1〜4 の結論

- 事項1（使用実績）: 結論 — 使用実績なし、削除可。GitHub issue 全 4 件に OPFS / SQLite / spike / fallback 関連ゼロ（調査済み）。
- 事項2（divergence 警告との棲み分け）: 結論 — 診断パネルの OPFS 移行状態表示（`diagnosticsPanel.ts:250-330`）と divergence 警告（`offscreenUsesFallback` / `dashboardDetectsOpfs`）で十分。spike 固有の追加価値（ステップ単位の失敗箇所出し）は実運用で不要と判断。
- 事項3（sqlite-wasm 更新時の回帰確認）: 結論 — 完全削除でも OPFS+FTS5 疎通は診断パネルの状態表示（OPFS 検出成功 = 疎通成功を含意）と E2E で担保される。開発フローとしての実機ステップ確認は使用実績ゼロのため復活させない。
- 事項4（削除 vs 格下げ）: 結論 — **完全削除**を採る。格下げ案（スタンドアロン開発スクリプト化）は保守コスト削減になるが、使用実績ゼロ・診断価値重複・別管理スクリプトという新たな保守面（CI 外・陳腐化リスク）が理由。5 Whys 分析（`/var/folders/b_/fzr253l50g58s5p7d94nxjmc0000gn/T/kilo/whywhy/pbi19-opfs.md`）参照。

### PBI 記載からの差分・補足

- 追加撤去: PBI の 13 ファイル表にない `src/messaging/sqliteOperationSecurity.ts` の 3 リスト（`ALL_DASHBOARD_SQLITE_SUBTYPES` / `READ_ONLY_OPS` / `TOKEN_EXEMPT_OPS`）からも `opfs_spike` を除去。これに伴い依存テスト 3 本（`sqlite-security-integrity.test.ts` / `dashboardGateway.test.ts` / `validators.test.ts`）も修正。`validators.ts` 自体は `ALL_DASHBOARD_SQLITE_SUBTYPES` からの派生のため修正不要。
- `dev-docs/DESIGN_SPECIFICATIONS.md` / `dev-docs/ARCHITECTURE_MAP.md` には OPFS spike 記述がゼロ件（`rg -i spike` で確認、archived 配下の過去 PBI を除く）のため削除対象なし。ADR-014 には Note 節を追記、`docs/i18n-guide.md` のキー数を 1324→1323（実測値）に更新。
- E2E 2 本は存在 assert の削除ではなく「存在しない」アサーション（`toHaveCount(0)`）へ変更。BDD シナリオ「ボタンが消える」の自動テストとして維持し、再追加の回帰を検出する。grep ガード（`opfsSpike|OpfsSpike|OPFS_SPIKE|opfs_spike`）の残存 4 ヒットはこの意図的な不在ガードのみ。製品コード（`src/` / `entrypoints/` / `public/`）はゼロヒット。
- `src/background/inMemoryTransport.ts` の削除は PBI 17 で追加された `SQLITE_ARCHIVE_DELETE_BY_STAGING` 用コメントに触れず、その直後の `SQLITE_OPFS_SPIKE` case のみ削除。

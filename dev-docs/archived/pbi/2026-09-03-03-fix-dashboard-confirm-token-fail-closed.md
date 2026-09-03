# PBI: Dashboard confirm-token fail-closed — 破壊的操作の confirm-token 取得失敗時に IPC を送らず fail-closed で拒否する

## ユーザーストーリー
データ損失を避けたいユーザーとして、ダッシュボード発の破壊的操作（`clearAll` / `restore` / `purge` / `delete` など）が confirm-token なしで実行されないようにしたい、なぜなら現行の `dashboardGateway.ts` は `getDashboardConfirmToken` が `null` 返却やタイムアウトした際に `confirmToken` なしで `DASHBOARD_SQLITE` IPC を送出し、ユーザー同意なしにデータが破壊される fail-open downgrade が起きるから

## 優先度
- 順位: —（0902a ブランチレビュー由来のセキュリティ hotfix、単独でトラッキング）
- RICEスコア: **10.8**（Reach=1 / Impact=3 / Confidence=0.9 / Effort=0.25）
- 計算式: `(1 × 3 × 0.9) / 0.25 = 10.8`
- 根拠:
  - Reach=1 — ダッシュボード起点の手動・破壊的操作のみに影響（頻度は小さいが、影響を受ける操作は全て高インパクト）
  - Impact=3 — 圧倒的（同意なしのデータ全消去・リストア・purge / delete による不可逆なデータ損失）
  - Confidence=0.9 — `src/background/sqlite/dashboardGateway.ts:29-42` の分岐を直接確認済み。`if (confirmToken)` が falsy 時に token なしで IPC を送ることがコード上で自明
  - Effort=0.25人週 — `sendDashboard` 内の分岐を fail-closed に倒す + `SqliteResult` エラー返却 + 単体テスト追加のみ

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ破壊的操作が token なしで実行される？ | `dashboardGateway.ts:29-42` の `sendDashboard` が `requireConfirmToken=true` でも `const confirmToken = await getDashboardConfirmToken(...)` の結果が `null`（取得失敗 or タイムアウト）なら `if (confirmToken) messagePayload = { ...payload, confirmToken }` の分岐で token 付与をスキップし、そのまま `chrome.runtime.sendMessage({ type: 'DASHBOARD_SQLITE', payload: messagePayload })` を送出 → token 取得の失敗が IPC 送信の抑止になっていない |
| なぜ `null` が返る？ | `getDashboardConfirmToken:13-20` が `try/catch` 内で `sendDashboardRaw({ subtype: 'create_confirm_token' })` を呼び、`catch` でも `return null`、レスポンスに `confirmToken` がなければ `return null`。タイムアウト（`sendDashboardRaw:22-27` の `Promise.race` 10s）も `catch` で `null` に潰される → 失敗が呼び出し元にエラーとして伝播しない |
| なぜ fail-open が危険？ | `tokenExempt`（`src/messaging/sqliteOperationSecurity.ts:74-76`）に入っていない subtype は `TOKEN_REQUIRED`（`clear_all` / `restore_db` / `purge_now` / `content_purge_now` / `delete` / `update` / `toggle_star` など）がデフォルト。receiver 側のゲートがあっても、sender が token なしで送れば receiver の実装や将来の緩和で突破される → sender 側で fail-closed に倒すのが defense-in-depth の原則 |
| なぜリトライしてはいけない？ | token は `chrome.storage.session` + `confirmTokenManager` によるユーザー保持の同意トークン。取得失敗時に token なしでリトライすれば、同意なし実行を再試行することになる → 単一失敗は即座に `SqliteResult` エラーで caller に返し、再試行も fallback dispatch もしない |

### 現状コードの確認
```bash
# 該当箇所
grep -n "getDashboardConfirmToken\|requireConfirmToken\|sendDashboard" src/background/sqlite/dashboardGateway.ts
grep -n "tokenExempt\|TOKEN_REQUIRED\|TOKEN_EXEMPT" src/messaging/sqliteOperationSecurity.ts
```
- `src/background/sqlite/dashboardGateway.ts:13-20` — `getDashboardConfirmToken` が `null` を返す fail-open 源
- `src/background/sqlite/dashboardGateway.ts:22-27` — `sendDashboardRaw` の 10s `Promise.race` タイムアウト
- `src/background/sqlite/dashboardGateway.ts:29-42` — `sendDashboard` が `requireConfirmToken` でも `confirmToken` falsy 時に IPC を送出するバグ本体（~111行周辺、PBI 07 分割後の行番号では 29-42）
- `src/messaging/sqliteOperationSecurity.ts:64-82` — `tokenExempt` / `TOKEN_REQUIRED_SUBTYPES` の SSOT（read-only のみ exempt、他は token 必須が fail-safe 設計）
- `src/background/sqlite/offscreenGateway.ts:30-31` — 正常系の `SqliteResult<T>` 型（本 PBI のエラー返却型もこれに準拠）

## ビジネス価値
- ダッシュボードの破壊的操作で「同意トークンが取れなかったら実行しない」を保証し、不可逆なデータ損失インシデントをゼロにする
- 測定方法: 破壊的操作の全試行に対する `confirmToken` 取得失敗時の IPC 未送信率 100%（テストで検証）、および手動 QA でネットワーク遅延・`chrome.storage.session` 一時不調を再現してもデータが消えないこと

## BDD受け入れシナリオ

### Scenario: Happy path — confirm-token 取得成功時に破壊的操作が実行される
  Given ダッシュボードが `clear_all`（または `restore_db` / `purge_now` / `delete`）等の `TOKEN_REQUIRED` 操作を要求し、`getDashboardConfirmToken` が有効な `confirmToken` 文字列を返す
  When `DashboardGateway.callDashboard({ subtype: 'clear_all' }, ...)`（または同等の破壊的操作）が呼ばれる
  Then `chrome.runtime.sendMessage` が `{ type: 'DASHBOARD_SQLITE', payload: { subtype: 'clear_all', confirmToken: '<token>' } }` で1回呼ばれ、レスポンスが `{ success: true }` なら `SqliteResult` は `{ success: true, data }` を返す

### Scenario: Fail-closed — token 取得が null を返した場合は IPC を送らずエラーを返す
  Given `requireConfirmToken=true` の操作（例: `clear_all`）で `getDashboardConfirmToken` が `null` を返す（`sendDashboardRaw` の `catch` または `confirmToken` 不在）
  When `DashboardGateway.callDashboard` が当該操作で呼ばれる
  Then `chrome.runtime.sendMessage` は `DASHBOARD_SQLITE` で呼ばれず（`create_confirm_token` の1回を除き破壊的操作の IPC は0回）、`SqliteResult` は `{ success: false, error }` を返す。`error` は `categorizeError` 経由の `SqliteError` で `retriable: false`、メッセージは token 取得失敗を示す（例: `confirm token unavailable`）

### Scenario: Fail-closed timeout — token 取得がタイムアウトした場合も IPC を送らずエラーを返す
  Given `requireConfirmToken=true` の操作で `getDashboardConfirmToken` 内の `sendDashboardRaw({ subtype: 'create_confirm_token' })` が `DASHBOARD_SQLITE_TIMEOUT`（10s）でタイムアウトし `null` にフォールバックする
  When `DashboardGateway.callDashboard` が当該操作（例: `restore_db`）で呼ばれる
  Then 破壊的操作の `DASHBOARD_SQLITE` IPC は送出されず、`SqliteResult` は `{ success: false, error }` で caller に伝播する。タイムアウトの `create_confirm_token` 自体は `sendDashboardRaw` の `Promise.race` で reject されるが、`getDashboardConfirmToken` の `catch` で握り潰されず fail-closed の分岐で検出される

### Scenario: No retry — 単一の失敗でリトライせず token なし fallback もしない
  Given `requireConfirmToken=true` の操作で `getDashboardConfirmToken` が1回 `null` を返す
  When `DashboardGateway.callDashboard` が呼ばれる
  Then `create_confirm_token` の `sendDashboardRaw` は1回のみ呼ばれ、破壊的操作の `sendMessage` は0回。2回目の `create_confirm_token` 呼び出しや、token なしでの破壊的操作の再送は発生しない。`SqliteResult` の `error` が caller（`dashboardSqliteService` 等）にそのまま伝播し、UI はエラーを表示できる

## 受け入れ基準
- [ ] `requireConfirmToken=true`（`!tokenExempt.has(payload.subtype)`）の操作で `getDashboardConfirmToken` が `null` を返した場合、`sendDashboard` は `DASHBOARD_SQLITE` の破壊的操作 IPC を送出せず、`DashboardGateway.callDashboard` は `SqliteResult` の `{ success: false, error }` を返す
- [ ] `getDashboardConfirmToken` がタイムアウト（`sendDashboardRaw` の `Promise.race` reject）で `null` にフォールバックした場合も同様に IPC は送出されず `SqliteResult` エラーが返る。タイムアウトは `DASHBOARD_SQLITE_TIMEOUT` の既存値（10s）を維持し、追加の待機やリトライで延長しない
- [ ] 単一の `getDashboardConfirmToken` 失敗に対して `create_confirm_token` の再試行は0回、破壊的操作の fallback dispatch（token なし送信）も0回であることをテストで検証する
- [ ] Happy path では `confirmToken` が `payload.confirmToken` に付与されて IPC が1回送出され、`{ success: true }` レスポンスが `SqliteResult` の success にマッピングされる
- [ ] エラーは `SqliteResult`（`src/background/sqlite/offscreenGateway.ts:30` の `SqliteResult<T>`）で返し、例外 throw や `chrome.runtime.sendMessage` の未処理 reject で caller をクラッシュさせない。`error.retriable` は `false`
- [ ] `tokenExempt` に含まれる read-only 操作（`query` / `search` / `get_count` / `status` / `create_confirm_token` / `opfs_spike` / `audit_log_query`）は従来通り token なしで送出され、本修正の影響を受けない
- [ ] 既存の `dashboardGateway` / `dashboardSqliteService` / `sqliteOperationSecurity` 関連テストが green（`npm run validate` green）

## テスト戦略（t_wada式 Outside-In）

### E2Eテスト（最小限）
- なし（本 PBI は background ↔ dashboard 間の IPC ガードであり、E2E は既存の dashboard 手動 QA でカバー。必要なら `chrome.runtime.sendMessage` を stub した integration で代替）

### 統合テスト（中程度）
- `DashboardGateway.callDashboard` に対して `chrome.runtime.sendMessage` を stub 化し、`create_confirm_token` → 破壊的操作の2ホップを検証する contract テスト
  - stub が `create_confirm_token` で `{ success: true, confirmToken: 'tok' }` を返せば、破壊的操作の `sendMessage` payload に `confirmToken` が含まれる
  - stub が `create_confirm_token` で `null` 相当（`{ success: false }` または reject → `getDashboardConfirmToken` が `null`）を返せば、破壊的操作の `sendMessage` は呼ばれない

### 単体テスト（多数）
- `src/background/sqlite/__tests__/dashboardGateway.test.ts`（新規または既存の拡張）に以下を追加:
  - **Happy path**: `getDashboardConfirmToken` が `'tok-123'` を返す stub で `clear_all` を呼ぶ → `chrome.runtime.sendMessage` が `DASHBOARD_SQLITE` で2回（`create_confirm_token` + `clear_all` with token）呼ばれ、結果が `success: true`
  - **Fail-closed null**: `getDashboardConfirmToken` を `vi.fn().mockResolvedValue(null)` に差し替え、`delete` / `clear_all` / `restore_db` / `purge_now` の各 subtype で `callDashboard` → `sendMessage` の破壊的操作呼び出しが0回、`result.success === false`、かつ `result.error.message` が token 不在を示す
  - **Fail-closed timeout**: `sendDashboardRaw` の `create_confirm_token` 呼び出しを `vi.useFakeTimers()` + `Promise.race` タイムアウトで reject させ、`getDashboardConfirmToken` が `null` に潰れる経路でも同様に破壊的操作の `sendMessage` が0回で `success: false`
  - **No retry**: `getDashboardConfirmToken` の mock 呼び出し回数が1回、`chrome.runtime.sendMessage` の破壊的操作呼び出し回数が0回であることを `expect(mock).toHaveBeenCalledTimes(1)` / `0` で assert。2回目の `create_confirm_token` が呼ばれていないこと（リトライなし）を検証
  - **Exempt は影響なし**: `query` / `search` / `get_count` / `status` では `getDashboardConfirmToken` が呼ばれず（または `tokenExempt` でスキップ）、token なしで1回 `sendMessage` が呼ばれる
- 既存の `tokenExempt` / `TOKEN_REQUIRED_SUBTYPES` の整合性テスト（`src/messaging/__tests__/sqliteOperationSecurity.test.ts` 等）が green のままであること

### Outside-In 適用順
1. 上記単体テストを先に RED で書く（`getDashboardConfirmToken` を null にして `callDashboard` が `success: false` を返さず IPC を送ってしまうことを fail で確認）
2. `dashboardGateway.ts:29-42` の `sendDashboard` を fail-closed に修正して GREEN に
3. リファクタリング: `getDashboardConfirmToken` の `catch` で `null` を返す現行を、呼び出し元で `null` をエラーに昇格する形に整理（`getDashboardConfirmToken` 自体は `string | null` を維持しつつ、`sendDashboard` で `if (!confirmToken) return { success: false, error }`）

## 見積もり
0.25 人週（約 1pt）。`sendDashboard` の分岐修正 + `DashboardGateway.callDashboard` の早期 return + 単体テスト4ケース追加で完結。小さいがセキュリティ hotfix のため最優先で着手可能。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（happy / fail-closed null / fail-closed timeout / no retry の4シナリオ）
- [ ] `chrome.runtime.sendMessage` の呼び出し回数で「破壊的操作の IPC が送られていない」ことがテストで証明されている（`expect(chrome.runtime.sendMessage).not.toHaveBeenCalled()` または破壊的操作 subtype での呼び出し0回）
- [ ] `SqliteResult` の `error` が caller に伝播し、UI / service 層でハンドリング可能である（throw ではなく `success: false` で返却）
- [ ] `tokenExempt` の read-only 操作が回帰していない（既存テスト green）
- [ ] コードレビュー完了（セキュリティ観点: fail-closed / no retry / no fallback を PR 説明に明記）
- [ ] `npm run validate`（type-check + tests）が green
- [ ] ドキュメント更新不要（挙動変更は内部ガードのみ。外部仕様の変更があれば `dev-docs/DESIGN_SPECIFICATIONS.md` §5.4 SqliteGateway 節に fail-closed 方針を追記）

## 実装者向け注記

### 現状コードの確認
```bash
# 必須: 着手前に現行の fail-open を目視確認する
grep -n "getDashboardConfirmToken\|requireConfirmToken\|sendDashboard\|tokenExempt" src/background/sqlite/dashboardGateway.ts
grep -n "ALL_DASHBOARD_SQLITE_SUBTYPES\|TOKEN_EXEMPT_OPS\|tokenExempt" src/messaging/sqliteOperationSecurity.ts
# 期待: dashboardGateway.ts:29-42 で `if (confirmToken) messagePayload = { ...payload, confirmToken }` の後に無条件で sendMessage していること
```

### 実装手順（推奨 diff の骨子）
1. `src/background/sqlite/dashboardGateway.ts:29-42` の `sendDashboard` を fail-closed に:
   ```ts
   // Before (fail-open):
   // const confirmToken = await getDashboardConfirmToken(action, id);
   // if (confirmToken) messagePayload = { ...payload, confirmToken };
   // return Promise.race([chrome.runtime.sendMessage(...payload: messagePayload), timeout]);

   // After (fail-closed):
   if (requireConfirmToken) {
     const confirmToken = await getDashboardConfirmToken(action, id);
     if (!confirmToken) {
       // No retry, no fallback dispatch — propagate as SqliteResult error
       // error は categorizeError 経由で SqliteError に正規化し retriable: false に
       throw new Error('Dashboard confirm token unavailable'); // または categorizeError で SqliteResult に包む
       // DashboardGateway.callDashboard 側で catch し { success: false, error } を返す実装でも可
     }
     messagePayload = { ...payload, confirmToken } as T & { confirmToken: string };
   }
   ```
   - `DashboardGateway.callDashboard:44-64` の `try { response = await sendDashboard(payload) }` が既に `categorizeError` で `SqliteResult` に包むため、`sendDashboard` 内で `throw` して `callDashboard` の catch に任せるか、`sendDashboard` 自体を `SqliteResult` を返す形にして早期 return するかは実装時に選択。いずれも「IPC を送らず `SqliteResult` エラーで caller に返す」を満たすこと
   - 重要: `getDashboardConfirmToken` 内の `try/catch` で `return null` する現行を活かしつつ、呼び出し元 `sendDashboard` で `null` を検出して fail-closed に倒す。`getDashboardConfirmToken` 自体を throw に変える必要はない

2. `DashboardGateway.callDashboard` が `sendDashboard` の throw を `categorizeError` で `SqliteError` に包み `{ success: false, error: { kind, message, retriable: false } }` を返すことを確認（既存の `catch` で対応済みなら追加変更不要。新規に早期 return する場合は `retriable: false` を明示）

3. テスト追加: `src/background/sqlite/__tests__/dashboardGateway.test.ts` に上記4ケースを追加し RED→GREEN を確認

### 落とし穴
- **二重 timeout**: `getDashboardConfirmToken` 内の `sendDashboardRaw` と `sendDashboard` 内の `sendMessage` がそれぞれ `Promise.race` で10sタイムアウトを持つ。`create_confirm_token` のタイムアウトを `getDashboardConfirmToken` の `catch` で `null` に潰した後に `sendDashboard` で fail-closed しないと、破壊的操作の `sendMessage` が token なしで10s待ってから送られる二重待ちになる → 必ず `confirmToken` 取得直後に早期 return すること
- **`tokenExempt` の判定順序**: `payload.subtype` が `ALL_DASHBOARD_SQLITE_SUBTYPES` にない未知の subtype は `!tokenExempt.has(subtype)` で `true` になり token 必須になる（fail-safe）。未知 subtype を `tokenExempt` に入れないこと。新 subtype 追加時は `READ_ONLY_OPS` / `TOKEN_EXEMPT_OPS` の integrity test が fail するはず
- **No retry の厳守**: `getDashboardConfirmToken` の失敗時に `sendDashboard` 内で `await getDashboardConfirmToken` を2回呼んだり、`catch` で token なし fallback を送らないこと。1回の `null` で即 `SqliteResult` エラーに倒す
- **エラーメッセージの露出**: `SqliteError.message` は dashboard UI に表示されうる。内部スタックトレースや `chrome.storage.session` の生値を含めないこと（`categorizeError` 経由で正規化する）

## 技術的考慮事項
- 依存関係: なし（単一ファイル `dashboardGateway.ts` の分岐修正 + テスト追加。`sqliteOperationSecurity.ts` の SSOT は変更しない）
- テスタビリティ: `chrome.runtime.sendMessage` を `vi.fn()` で stub、`getDashboardConfirmToken` を export して差し替え可能にするか、`sendDashboardRaw` を DI するか、既存の `chrome` mock パターンに倣う。`vi.useFakeTimers()` で `Promise.race` タイムアウトを再現する際は `runAllTimersAsync` を使う
- 非機能要件: セキュリティ（fail-closed / no retry / no fallback）。パフォーマンス影響なし（失敗時は IPC を1回減らすためむしろ速い）
- ロールバック: 本修正は fail-closed 化のため、万一 `create_confirm_token` の一時不調で破壊的操作が全拒否される事態に備え、feature flag ではなく `chrome.storage.session` の token 発行側の健全性監視（既存の `confirmTokenManager` ログ）で切り分け。ロールバック時は本 PBI の diff を revert すれば fail-open に戻るが、セキュリティ後退のため推奨しない。代替として `confirmTokenManager` の token 発行失敗率を dashboard で可視化することを検討

## 参考資料
- `src/background/sqlite/dashboardGateway.ts:13-42` — 本 PBI の修正対象（`getDashboardConfirmToken` / `sendDashboardRaw` / `sendDashboard`）
- `src/background/sqlite/offscreenGateway.ts:30` — `SqliteResult<T>` の型定義
- `src/messaging/sqliteOperationSecurity.ts:18-82` — `ALL_DASHBOARD_SQLITE_SUBTYPES` / `READ_ONLY_OPS` / `TOKEN_EXEMPT_OPS` / `tokenExempt` / `TOKEN_REQUIRED_SUBTYPES` の SSOT
- `dev-docs/plans/2026-08-09-pbi23-phase3-senior-consultation.md §10.5–10.7` — allowlist による fail-safe 設計の経緯
- `dev-docs/archived/pbi/2026-09-03-07-refactor-sqlite-gateway-fidelity.md` — 直前の SqliteGateway 分割 PBI（本ファイルの分割元）
- ブランチ `0902a` レビュー指摘: `dashboardGateway.ts` ~111行の fail-open downgrade（本 PBI の Critical finding）


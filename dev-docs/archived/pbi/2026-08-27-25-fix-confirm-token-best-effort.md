# PBI: confirmTokenManager best-effort不整合

## ユーザーストーリー
開発者として、`confirmTokenManager` の best-effort 永続化がメモリとストレージの不整合を起こさないようにしたい、なぜなら `chrome.storage.session.set` 失敗時に `CONFIRM_TOKEN`（メモリ）だけが更新され、Service Worker 再起動後に storage から古い（または空の）トークンが読み込まれ、破壊的操作（`clear_all` / `delete` 等）の `confirmToken` 検証が不一致で失敗するから。

## 優先度
- 順位: 8 / 17
- RICEスコア: 140（Reach=20 / Impact=1 / Confidence=70% / Effort=0.1）
- 根拠: `chrome.storage.session` の set 失敗は稀（quota / 一時的エラー）だが、発生時は全破壊的操作が次回 SW 再起動まで失敗する。Reach=20（dashboard 破壊的操作利用者）。Impact=1（クリア/削除が一時的に失敗するがデータ損失なし）。Confidence=70%（best-effort の catch で不整合が残ることはコードで確実だが、実害は SW 再起動を跨いだ場合のみ）。Effort=0.1（永続化順序の入れ替えまたは再試行追加）。

## なぜなぜ分析
- なぜ不整合するか: `src/background/confirmTokenManager.ts:24-37` でトークン生成後に `try { await chrome.storage.session.set } catch {}` で失敗を握りつぶしつつ `CONFIRM_TOKEN = token` を無条件で代入するため、メモリとストレージが乖離する
- なぜ best-effort にしたか: `confirmToken` は SW 存命中はメモリで保護できれば十分という前提で、永続化失敗でも当該 SW ライフタイムは動作させたい意図だったため
- なぜ再起動後に失敗するか: SW 再起動時に `ensureConfirmToken` が `chrome.storage.session.get` から古いトークン（または undefined → 新規生成）を読み込み、dashboard 側が `chrome.storage.session` にキャッシュしたトークンと不一致になるため
- 解: 1) トークン永続化を `chrome.storage.session` のみに一本化し `CONFIRM_TOKEN` への代入は `set` 成功後のみ行う、または 2) `set` 失敗時に指数バックオフで再試行するロジックを追加。いずれかでメモリとストレージの原子性を担保

## BDD受け入れシナリオ
Scenario: ハッピーパス — 正常に永続化されたトークンは再起動後も一致する
  Given `chrome.storage.session` が正常である
  When `ensureConfirmToken()` で生成されたトークンで `clear_all` を実行する
  Then Service Worker 再起動後の `ensureConfirmToken()` が同じトークンを返し、検証が成功する

Scenario: バグ再現 — session.set 失敗時にメモリだけが更新されない
  Given `chrome.storage.session.set` が 1 回失敗する（モックで throw）
  When `ensureConfirmToken()` を呼ぶ
  Then メモリの `CONFIRM_TOKEN` と storage の値が乖離せず、再試行または set 成功後のみメモリが更新される。乖離した場合は次回 `ensureConfirmToken()` が整合なトークンを返す

Scenario: 境界 — session.get 失敗時も新規生成と再試行で復旧する
  Given `chrome.storage.session.get` が失敗する
  When `ensureConfirmToken()` を呼ぶ
  Then 新規トークンが生成され、永続化の再試行が行われる（またはエラーが適切に伝播し、呼び出し元で再試行可能である）

## 受け入れ基準
- [x] `src/background/confirmTokenManager.ts:11-38` の `ensureConfirmToken` が `chrome.storage.session.set` 成功後のみ `CONFIRM_TOKEN` を更新する、または失敗時に再試行（例: 3回指数バックオフ）を行う
- [x] `get` 失敗時と `set` 失敗時の両方でメモリとストレージの不整合が残らない
- [x] 既存の `confirmToken` 検証テスト（`confirmTokenConstantTime.test.ts` 等）がパスする
- [x] storage 失敗をモックした回帰テストが1件以上追加されている
- [x] `npm run type-check` がパスする

## テスト戦略
- 単体: `confirmTokenManager` の best-effort 不整合テスト — `chrome.storage.session.set` を `vi.fn().mockRejectedValueOnce` で失敗させ、`ensureConfirmToken()` 後の `CONFIRM_TOKEN` と `chrome.storage.session.get` の値が一致することを検証。再試行ロジックがある場合は `set` が 2 回呼ばれることを検証
- 統合: dashboard 側 `BrowsingLogRepository` / `dashboardSqliteService` の `getConfirmToken` → SW 側 `ensureConfirmToken` の往復で、SW 再起動を模擬（`CONFIRM_TOKEN = null` リセット）してもトークンが一致すること
- E2E: 不要（offscreen 不要）

## 見積もり
1pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

# PBI: コメント・デッド比較・CHANGELOG の現状整合（bundle 6 件）

## ユーザーストーリー

保守担当者として、コメントが実際に保証していないことを保証しているように読めないこと、現行プロデューサが生成しない値との比較が残らないこと、CHANGELOG の主張が現行の CI/スクリプト状態と矛盾しないことを期待する。6 件はすべて現状への実害なし（呼び出し側は読み取り専用・現行呼び出し側は安全）だが、放置は誤修正・誤実装の種になる。

## 優先度

- 順位: 15 / 15
- RICE: 0.5（R=1 / I=0.25 / C=1.0 / Effort=0.5）
- 根拠: 現状への実害はゼロで、将来の保守リスク低減のみ（Reach 1 / Impact 0.25）。全件のコード確認済み（C=1.0）で低コストの bundle。

## 背景（file:line 付き現状・6 件）

(a) ublockParser 浅いコピーのコメントが実際の保証と不一致

- `src/utils/ublockParser/index.ts:232-234` — 「ruleset を浅いコピーで返す。呼び出し側が cache 内のオブジェクトを書き換えても他呼び出しに影響しない」と主張。しかし `:240` `{ ...parseUblockFilterListWithErrors(text).rules }` と `:131` `{ ...cached, errors: cached.errors || [] }` はネストした `blockRules`/`exceptionRules`/`errors` 配列を cache と共有する。
- 現行呼び出し側はすべて読み取り専用（`src/dashboard/settings/ublockImport/rulesBuilder.ts:83-84` の `.length` 参照、`src/dashboard/settings/ublockImport/sourceManager.ts:116-117,153` の `.map()` 参照）で実害なし。

(b) settingsForm のデッド比較

- `src/dashboard/generalSettings/settingsForm.ts:193, :219` — `detail && detail !== 'Error'`。旧 display フォールバック（d2c8f27e 由来）で、現行プロデューサはちょうど `'Error'` を返さない（`src/utils/errorUtils.ts:12-13` の `errorMessage` は空メッセージで空文字を返し、`detail &&` 側で処理済み）。

(c) storageTransaction の到達不能 tail throw

- `src/utils/storage/storageTransaction.ts:170` — `throw lastError || new Error(shell.fallbackMessage)` は budget check `:164` が先に throw するため到達不能。`:137` のコメントが自己認識済み。

(d) verifyPostWrite の key/version-key 衝突の契約

- `src/utils/storage/storageTransaction.ts:180-196` — `port.get([...keys, ...keys.map((k) => \`${k}_version\`)])` は `withAtomic(['foo', 'foo_version'])` のような呼び出しでキー衝突し得る。現行呼び出し側は安全（`src/utils/storage/savedUrlRepository.ts:230, :273, :324` — いずれも `savedUrlsWithTimestamps` / `savedUrls` のみ）。

(e) session-timeout install の順序暗黙依存

- `src/background/service-worker.ts:45`（`void alarmRegistry.installAll()` 未 await）と `:187`（`setSessionTimeoutRefs`）— installAll 内の `check_session_timeout` install hook（`src/background/alarmRegistry.ts:139-143` の `sessionTimeoutInstallRef?.()`）は ref 未注入時に no-op する。installAll が未 await のため、`:187` の ref 注入との実行順はタイミングに依存し、将来 `await` に変えると黙って no-op し得る。

(f) CHANGELOG の stale 主張

- `CHANGELOG.md:1192` — 「ベースラインラッパーを撤去し、`type-check:test` は `tsc` を直接実行する。以降テストコードに型エラーを持ち込むと CI が落ちる」。現状は `package.json:36` に `type-check:test:baseline` が存在し、`validate`（`package.json:44`）は baseline 版を実行、CI（`ci.yml:133-134`）は src の `tsc --noEmit`（`npm run type-check`）のみで `type-check:test` を実行しない。主張は現状と矛盾。

## BDD受け入れシナリオ（doc-review）

### Scenario 1: コメントが実際の保証を述べる

```gherkin
Given ublockParser の浅いコピーに関するコメントが「他呼び出しに影響しない」と主張している
When 保守担当者がコメントを読んで変更の安全性を判断する
Then コメントは実際の保証（トップレベルのみコピー、ネスト配列は cache と共有）を述べる
And 読み取り専用前提であることも明記される
```

### Scenario 2: デッド比較と stale 主張が解消される

```gherkin
Given settingsForm に現行プロデューサが返さない値との比較がある
When 保守担当者がコードを読む
Then 比較が削除されているか、残置理由が明示されている
And CHANGELOG の type-check:test 関連の記述が現行の package.json と CI の状態と一致する
```

### Scenario 3: 暗黙依存が WHY コメントで復元可能

```gherkin
Given service-worker.ts の installAll 未 await と ref 注入の順序に暗黙依存がある
When 将来の保守担当者が await を追加しようとする
Then コメントから session-timeout install が ref 未注入で no-op になることと現在成立している理由が読み取れる
```

## 受け入れ基準

- [x] (a) `src/utils/ublockParser/index.ts:232-234` のコメントが実際の保証（浅いコピーはトップレベルのみ、ネスト `rules`/`errors` 配列は cache 共有、呼び出し側は読み取り専用が前提）を述べる。コード（`:131`, `:240`）は無変更。
- [x] (b) `src/dashboard/generalSettings/settingsForm.ts:193, :219` の `detail !== 'Error'` を削除するか、残置理由を明示する。表示挙動は不変。
- [x] (c) `src/utils/storage/storageTransaction.ts:170` の tail throw は保持し、`:137` コメントに identity 目的（到達不能・型確定用）が明記されていることを確認・補完する。
- [x] (d) `verifyPostWrite`（`storageTransaction.ts:180-196`）の key/version-key 衝突について、現行呼び出し側（`savedUrlRepository.ts:230, :273, :324`）が安全であることの契約コメントまたは衝突ガードを追加する。
- [x] (e) `src/background/service-worker.ts:45` + `:187` と `alarmRegistry.ts:139-143` の session-timeout install 順序の暗黙依存に WHY コメントを追加する。コードの順序は無変更。
- [x] (f) `CHANGELOG.md:1192` の記述を現状（`package.json:36,44` の baseline 版存在・validate 実行、`ci.yml:133-134` が src の type-check のみ）と一致するよう修正する。
- [x] 全件で実行時挙動は不変（`npm run validate` green、型・テストに差分なし）。

## テスト戦略

- 実行時テストは原則不要（コメント・ドキュメント変更中心）。ただし (b) で比較を削除する場合、settingsForm の onError 経路の既存単体テストが green であることを確認。
- (d) でガードを入れる場合、衝突 key で明示的に失敗することを assert する単体テストを追加。
- (f) は `npm run type-check` / `npm run type-check:test:baseline` の現行コマンドと記述の突き合わせで確認。
- `npm run validate` が green。

## 見積もり

2 SP（Effort 0.5）

## Definition of Done

- [x] 6 件 (a)-(f) がすべて処理され、各受け入れ基準を満たす
- [x] 実行時挙動が不変であることを `npm run validate` で確認
- [x] 変更対象がコメント・ドキュメント（(b) の比較削除、(d) のガードは必要な場合のみ）に限定されている
- [x] backlog（順位 15）としての完了報告が紐づく — アーカイブ/台帳更新は別ステップ

## 実装記録（2026-10-03）

- (a) `src/utils/ublockParser/index.ts:232-234` — 浅いコピーのコメントを実際の保証（トップレベルのプロパティ再代入のみ保護、`blockRules`/`exceptionRules`/`errors` 配列は cache 共有、読み取り専用前提）に修正。コード無変更
- (b) `src/dashboard/generalSettings/settingsForm.ts:193, :219` — デッド比較 `detail !== 'Error'` を削除。現行プロデューサは `'Error'` を返さないため表示挙動は不変
- (c) `src/utils/storage/storageTransaction.ts:137` — tail throw は保持、コメントに identity 目的（budget check が先に throw するため到達不能・TypeScript が loop の常時 return/throw を静的証明できないための tail throw・fallback error に呼び出し元メソッド名を記録）を補完
- (d) `src/utils/storage/storageTransaction.ts:184` — `verifyPostWrite` に key/version-key 衝突の契約コメントを追加（`${key}_version` 派生のため `_version` 接尾辞付きデータ key は衝突し動作が偶発的になる旨、呼び出し側は repository key のみで安全）。衝突ガードは不採用 — 現行呼び出し側契約で十分なため
- (e) `src/background/service-worker.ts` + `src/background/alarmRegistry.ts` — session-timeout install hook が ref 未注入時に no-op（アラーム未装着・無ログ）になることと、現在の成立条件が service-worker.ts の module-eval 順序（ref 注入が init() の `void alarmRegistry.installAll()` より前）であることを WHY コメントで復元。コード順序無変更
- (f) `CHANGELOG.md:1192` — 追加修正不要。rank-07（PBI 2026-10-03-07）の CHANGELOG 整合で「※現行（v6.9.33 以降）は素の tsc ゲートではなく `type-check:test:baseline` の pin 上限が CI の validate で合否を判定」の現状一致記述が既に存在する
- 検証: tsc 0 エラー・lint 0 エラー・test 15,476 pass・validate exit 0（実行時挙動不変・型・テストに差分なし）

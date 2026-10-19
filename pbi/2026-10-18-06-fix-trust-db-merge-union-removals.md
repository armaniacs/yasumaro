# PBI: 信頼DBの CAS merge を「純粋な和集合」から「操作種別を考慮した merge」へ（削除したドメインが復活して記録され続けるのを防ぐ）

## ユーザーストーリー

信頼設定を日常的に使う利用者として、**信頼ホワイトリスト・センシティブブラックリスト・ユーザー TLD からエントリを削除したことが、拡張機能を再起動した後もそのまま保持され続けてほしい**。画面からは消えたように見えても、記録パイプラインが判定に使うストレージには残り、ユーザーが明示的に信頼解除したドメインの記録が継続するからである。信頼設定は「どの情報を機械に読ませるか」というプライバシー設定の最終防衛線であり、UI で成功に見せかけて実際にはストレージに残ることは、その防衛線を実質的に無効化している。

## 優先度

- 順位: 06 / 25
- RICE: 4000（Reach=400 / Impact=2 / Confidence=100% / Effort=0.2）
- 根拠: 監査6位。`removeFromWhitelist` 等は in-memory の splice → `save()` で保存するが、`save()` は `withOptimisticLock` + `mergeTrustDatabase` を通り、updater が current と local の**和集合**を取るため「削除」は union に原理的に生き残れない。CAS は削除済みの値を version bump 付きで書き戻し、post-write verify はその値で成功判定する。UI からは削除成功に見えるが chrome.storage には残り、次回 dashboard 読み込みで復活する。さらに whitelist は userBlacklist より優先判定されるため（`domainVerifier.ts:130`）、削除したはずのドメインが TRUSTED のまま userBlacklist 追加を上書きし、ユーザーが明示的に信頼解除したドメインの記録が継続する。ユーザー操作の意味を永続的に覆す、`.action` の重大性から最も直接。
- 種別: 🔧非機能追加（fix）
- 難易度: 🟡中（merge 方策全体の再設計が要るため）
- 副作用: 🔴あり。信頼DB の**追加**だけなら union は実害がない（別タブで追加した要素を消さない）。しかし削除／更新の反映方式が変わるため、既存プロファイルで「以前消せたはずのエントリが復活している」状態が修正後に初めて実際に消える。UI メッセージ・ロールバック手順を伴わないと「ユーザーが別タブで追加したエントリを自分の古いスナップショットで消した」事態を黙って実行することになり得る。

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `trust-db-save:merge-union-reverts-user-removals`。監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 24番 / `findings.json`）。

根本原因（claimed root cause）: `mergeTrustDatabase` は追加と削除の区別なく user-editable リストを stored base と **union** する。base にまだ要素が残っているなら local 側の削除は union を生き延びられず、CAS がそれを version bump 付きで永続的に書き戻す。

trace（entrypoint → sink）:

| # | ファイル:行 | 役割 |
|---|---|---|
| 1 | `src/dashboard/settings/trustSettings.ts:314` | entrypoint。`removeWhitelistDomain` が per-context `TrustDbAdmin` シングルトンを解決し `db.removeFromWhitelist`。chip の onRemove は promise を fire-and-forget |
| 2 | `src/utils/trustDb/TrustDbAdmin.ts:107` | kernel の ManagedCollections へ委譲 |
| 3 | `src/utils/trustDb/ManagedCollections.ts:116` | `ManagedStringList.remove` を in-memory `db.sensitive.whitelist` 配列に対して呼ぶ |
| 4 | `src/utils/trustDb/managedStringList.ts:55` | splice 後 kernel save callback を await。splice 後に無条件 success |
| 5 | `src/utils/trustDb/TrustDbKernel.ts:214-215` | 変更済み in-memory DB を localSnapshot として `mergeTrustDatabase` updater と共に CAS に渡す。**戻り値の merged は捨てている** |
| 6 | `src/utils/storage/storageTransaction.ts:256` | CAS が current stored `trust_db` を読む。まだ削除要素が残っている |
| 7 | `src/utils/trustDb/mergeTrustDatabase.ts:57` | `union(current.whitelist, local.whitelist)` が削除要素を再追加。`userBlacklist`（:56）・`userTlds`（:48）・presets（:52-54）も同形 |
| 8 | `src/utils/storage/storageTransaction.ts:374` | sink。`performCasUpdate` が merged を version bump 付きで永続書き込み。post-write verify（:377）がその値を確認するので ConflictError は上がらない |

実害の連鎖: `domainVerifier.ts:130` は whitelist ヒットを userBlacklist より先に TRUSTED 判定する → `checkTrustDomainStep.ts:44` が `DOMAIN_NOT_TRUSTED` を投げて記録可否を決める → 復元された whitelist エントリが、後から追加したユーザー blacklist を上書きし、記録が継続する。

## BDD受け入れシナリオ

```gherkin
Scenario: 1. ホワイトリストから削除したドメインが再起動後も復活しない
  Given 信頼DBに "secret.example.com" がホワイトリスト登録済みで、記録パイプラインがそのドメインを TRUSTED と判定している
  When  ユーザーがダッシュボードの信頼設定で "secret.example.com" の削除ボタンを押す
  Then  画面に "削除しました" の成功表示が出る
  And   ブラウザストレージを読み直しても "secret.example.com" はホワイトリストに存在しない
  And   ダッシュボードを開き直してもパネルに再登場しない

Scenario: 2. 削除意図がホワイトリスト以外のユーザー編集リストにも効く
  Given センシティブブラックリストに "blocked.example.com"、ユーザーTLD に ".internal" が登録済み
  When  ユーザーが各リストから該当エントリを削除する
  Then  ブラウザストレージには "blocked.example.com" と ".internal" のいずれも残らない
  And   同じ実装が removeSensitiveDomain / removeUserTld / removeJpAnchorTld にも適用されている

Scenario: 3. 別タブとの並行追加で互いの追加が残る（既存のロック契約が壊れない）
  Given 2 つの拡張コンテキストが信頼DBに同時にアクセスできる
  When  コンテキストAが "a.example" を、コンテキストB が "b.example" を並行してホワイトリストへ追加する
  Then  最終的なストレージ上のホワイトリストには "a.example" と "b.example" の両方が残る
  And   既存の lockContract テスト（並行追加の両ライターの delta が残る）が引き続き緑

Scenario: 4. 削除と追加が競合した場合、削除されたドメインは復活しない
  Given 信頼DBの "x.example" が削除対象である一方、別コンテキストが同時に "y.example" を追加している
  When  削除と追加が同時に commit される
  Then  "y.example" は追加として残り、"x.example" は union で復活しない
  And   どちらのコンテキストも例外を投げずに完了する

Scenario: 5. 削除済みドメインへのユーザー blacklist 追加が TRUSTED で打ち消されない
  Given "privacy.example.com" が削除操作の対象で、ストレージ上に旧 merge で復活したエントリが残っていない
  When  ユーザーが同ドメインをセンシティブ blacklist へ追加し、その後そのドメインのページを閲覧して記録を試行する
  Then  判定は SENSITIVE（または非 TRUSTED）となり、記録がブロックされる
  And   判定 source は "whitelist" ではない

Scenario: 6. 初回書き込みと一括置換（tranco / bloomFilter）は既存の挙動を保つ
  Given ストレージに trust_db が未登録の状態
  When  ユーザーが初回の信頼DBを初期化する
  Then  保存は成功し、既存テスト「returns a fresh object on first write (current undefined)」「keeps the more recent tranco snapshot」が緑のまま通る
```

## 受け入れ基準

- [ ] `mergeTrustDatabase` が「追加のみ union」の純粋 union ではなく、操作種別（add / remove / 一括置換）を区別して merge し、remove intent が base に残った要素を上書き除去できる
- [ ] `removeFromWhitelist` / `removeSensitiveDomain` / `removeUserTld` / `removeJpAnchorTld` のいずれも、ストレージに書き戻した値から対象要素が消えていることをテストで pin する（3リスト × 4remove 経路）
- [ ] `TrustDbKernel.save()` が `withOptimisticLock` の**戻り値（merged）**を受け取り、in-memory `state.database` を merged に寄せる。現状（`TrustDbKernel.ts:215` は戻り値を無視）は in-memory とストレージが乖離する構造なので、その乖離が解消されていることを pin する
- [ ] 既存契約「並行追加の両ライターの delta が残る」（`lockContract.test.ts:133`）が壊れないことを維持し、remove 競合のケースを新規 pin として追加する
- [ ] `trustDb.test.ts:443` 付近の既存 remove テストは `chrome.storage.local.get` が `{}` を返すモックのままで**union 再追加が露出しない**ことを把握した上で、populated `trust_db` を返すケースを別途追加する（既存テストの書き換えによる証拠の抹消は禁止）
- [ ] `checkSensitive` の判定順序（whitelist 優先）と、`checkTrustDomainStep` の `DOMAIN_NOT_TRUSTED` ゲートの挙動を変えていない（Scenario 5 は merge 修正の副次効果として成立する）
- [ ] `npm run validate`（type-check + lint + 全テスト）が緑。競合系テストは `npx vitest run <file> --repeats=20` で安定

## テスト戦略

### 単体

- **Red を先に書く**: `InMemoryStoragePort`（`src/utils/storage/storagePort.ts:82`）に `trust_db`（`sensitive.whitelist: ['a.com','b.com']`）と `trust_db_version` を seed し、その port を使う `withOptimisticLock`（`lockContract.test.ts:138` と同じ `vi.doMock` パターン）を差し込んで `TrustDbKernel` を構築し、`removeFromWhitelist('a.com')` を呼んで**書き戻し後の** `trust_db` に `'a.com'` が無いことを assert する。`removeSensitiveDomain` / `removeUserTld` も同形。
  - 実装メモ: 現行 `trustDb.test.ts` の削除テスト（`:443` / `:452` / whitelist 側）は `chrome.storage.local.get` を `mockResolvedValue({})` に固定している。base が空だと union 再追加が原理的に発生しないため**このバグを検出できない**。既存テストは改変せず、populated base を返すテストを別 describe で追加すること。
- `mergeTrustDatabase` 単体: 「remove intent で base に含まれる要素が消える」「add 意図は base に無い要素を加える」「両引数は mutate されない」「`current === undefined` の初回書き込み」「tranco は lastUpdated の新しい側」の5系統。
- add/remove 混在ケース（Scenario 4）を表駆動で pin。
- CAS リトライ（`ConflictError` → `runCasRetryLoop` の再実行）中に intent が二重適用されないこと。updater は冪等であるべき（`storageTransaction.ts:230` の契約コメント "updateFn MUST be pure and idempotent"）。

### 統合

- `src/dashboard/settings/trustSettings.ts` の `removeWhitelistDomain` から `getTrustDbAdmin()` → `TrustDbAdmin.removeFromWhitelist` → `ManagedCollections` → `ManagedStringList.remove` → kernel `save()` → ストレージ読み戻しまでを通し、UI が `db.getWhitelist()`（in-memory）で再描画した表示と**ストレージ上の実体が一致する**ことを assert する。現状 `trustSettings.ts:319` は in-memory 由来だけを描画するので、この一致が崩れる構造をテストで暴く。
- `_resetTrustDbAdminForTest()`（`TrustDbAdmin.ts:143`）を使い、kernel 初期化 → 2 コンテキスト相当の 2 kernel を同一ストレージに対して並行 write し、並行追加（Scenario 3）と add/remove 競合（Scenario 4）を再現。

### E2E

- 展開済み拡張で (1) 信頼設定にドメインを追加 → (2) 削除 → (3) ダッシュボードを再オープンし、パネルに再登場しないこと、さらに (4) `chrome://extensions` から service worker を停止・再開し、SW 側の kernel が再初期化されても消えたままであること。
- 実ブラウザでは cross-context の verify→set window（PBI 18 / 監査25件目）が同時に開いているため、E2E は再現不能の観測用であり、決定的な Red の根拠にはしない。

## 実装メモ（実装者向け）

### 対象ファイルと該当行

| ファイル | 行 | 役割 |
|---|---|---|
| `src/utils/trustDb/mergeTrustDatabase.ts` | 16-18, 46-58 | `union()` ヘルパーと 6 箇所の union 呼び出し（`userTlds` / presets×3 / `userBlacklist` / `whitelist`）。**修正の中心** |
| `src/utils/trustDb/TrustDbKernel.ts` | 207-219 | `save()`。`withOptimisticLock` の戻り値を無視（:215）、`localSnapshot` は in-memory 参照 |
| `src/utils/trustDb/managedStringList.ts` | 49-58 | `remove()` が splice 後 `save()`、無条件 success。操作意図（add/remove）を外へ出す必要 |
| `src/utils/trustDb/ManagedCollections.ts` | 22-71, 116-118 | 3 つの `ManagedStringList` を in-memory 配列で構築。remove 系ラッパ |
| `src/utils/trustDb/domainVerifier.ts` | 129-147 | whitelist 優先判定。**今回は変更しない**（Scenario 5 は merge 修正の帰結） |
| `src/background/pipeline/steps/checkTrustDomainStep.ts` | 28-45 | 記録可否ゲート。**今回は変更しない** |
| `src/dashboard/settings/trustSettings.ts` | 314-320 | 削除 UI。`renderWhitelistList(db.getWhitelist())`（in-memory 由来）で再描画。失敗フィードバック無し |
| `src/utils/trustDb/TrustDbAdmin.ts` | 107, 134-141 | 委譲＋module-level シングルトン（**JS context ごと**に独立した kernel を持つ。dashboard と SW で状態が違う理由） |
| `src/utils/trustDb/__tests__/trustDb.test.ts` | 443-459 | 削除テスト。`chrome.storage.local.get` を `{}` にモック → union 再追加が露出しない |
| `src/utils/trustDb/__tests__/lockContract.test.ts` | 133-177 | 「並行追加のみ」を pin。削除は未 pin |

### 最小変更の選択肢

**選択肢 1（推奨）: `mergeTrustDatabase` を操作種別考慮 merge へ変更。add と remove で別 updater を使い分ける**

- 実装方針: kernel が保留中の操作（intent）を持つ。`ManagedStringList.add/remove` は splice する代わりに intent を push し、`save()` が `mergeTrustDatabase(current, localSnapshot, pendingOps)` を CAS updater として渡す。updater は `current` に対して**意図の順序どおり**に操作する: `add` は集合和集合、`remove` は `list.filter(x => !removedSet.has(x))`、`bulk`（tranco/bloomFilter）は既存どおり lastUpdated で選択。commit 後に intent を clear する。
- 並行性: 追加どうし・削除どうしは完全に可換なので union 相当の「両方残る」保証を保つ。add と remove が競合したときは commit に到達した順で決まるが、**いかなる組み合わせでも union による削除の復活は起きない**。
- データ消失リスク: あり。意図的に「消える」のは (a) 自分が消した要素、(b) 自分の古い in-memory snapshot が、自分の初期化読み込みより後に別コンテキストが追加した要素。 (b) は現行 union では起きなかった消失であり、UI で結果を表示したうえで受け入れる（別タブの追加を自分のスナップショットが巻き戻すのは、最小変更では避けられない MV3 制約下のトレードオフ）。 緩和策として kernel は初期化時に「読み込み後のベースライン」を保持し、自分の in-memory がベースラインからすでに減っている（＝自分の削除）要素だけを current に適用する設計にできる。
- 変更範囲: `mergeTrustDatabase.ts` / `TrustDbKernel.ts` / `managedStringList.ts` / `ManagedCollections.ts`。スキーマ・storage キー・version 方式は不変なので**既存プロファイルの互換性は保つ**。

**選択肢 2: kernel の save で merge ではなく intended full snapshot を書く（CAS は維持し last-writer-wins を明示的に受け入れる）**

- 実装方針: `withOptimisticLock<TrustDatabase>(STORAGE_KEY, () => structuredClone(localSnapshot))` に差し替え、`mergeTrustDatabase.ts` は retire。tranco/bloom の lastUpdated 選択も purely last-writer-wins に統一する。
- 並行性: `TrustDbAdmin` のシングルトンは context ごと（`TrustDbAdmin.ts:134`）なので、dashboard の kernel と SW の kernel は**独立した in-memory state** を持つ。dashboard を開きっぱなしにして SW が tranco update すると、SW のスナップショットが dashboard 側で行ったユーザーリスト変更を巻き戻す。
- データ消失リスク: **最も大きい**。既存契約「2 ライターの delta が両辺残る」（`lockContract.test.ts:133`）がそのまま赤くなる。実害の無い追加のみに受益していた union を捨てるため、修正対象（削除）に加えて**現状無傷な並行追加**まで壊すことになる。
- 結論: 不採用。救済として「last writer が自分の in-memory に無い要素を current から復活させる」と書けば、それは選択肢 1 の集合演算そのものに戻る（違いは「復活の基準が操作由来か、最新スナップショット由来か」だけ）。参考実装として本選択肢の議論は PBI に残す。

**推奨**: 選択肢 1。既存テストを緑のまま通せる最小の変更であり、`lockContract` の並行追加保証を壊さない。

### 着手前に潰すべき検証（監査の blocker）

- needs_validation の blocker は 1 件: 「source-only execution boundary により対象コードを実行できず、deterministic reproduction（seed → remove → 書き戻し値の読み返し）が未実行で、durable-restore の observed result が存在しない」。したがって:
  1. **Red 確認**: 上記テスト戦略の単体 Red を先に書き、修正前に「確実に赤」であることを観測する。**赤が出なかった場合、監査の根本原因（union が削除を殺す）が誤り**であり、設計に着手せず原因を再考し、監査へ是正を返す。
  2. **owner-observed 確認**: 展開済み拡張で「追加 → 削除 → ダッシュボード再オープン」で再出現するかを 1 回実機確認し、結果を PBI に記録する。監査の deployment validation plan と対応。
  3. この 2 つが blocker を閉じるまでは「修正できた」と宣言しない。

### 既存テストへの追加項目

- `trustDb.test.ts:443` の 'removes a domain' ― **改変せず**、隣に populated `trust_db` を返す describe を新設。`removeSensitiveDomain` / `removeUserTld` の 3 系統それぞれに「書き戻し値に含まれない」assert 1 件ずつ。
- `lockContract.test.ts:133` ― 「並行追加」既存 1 件は**そのまま残す**（選択肢 1 の契約）。追加: (a) remove intent が current に含まれる要素を消す、(b) remove が current に無い要素に対して no-op かつ冪等、(c) add と remove の競合で結果が一意かつ union 復活なし。`mergeTrustDatabase` の引数が増えるため `:100-129` の「両引数を mutate しない」「current undefined で fresh object」「tranco は新しい側」も更新が必要。
- AGENTS.md の test rule に従い、**実時間 sleep を追加しない**。並行は `vi.doMock` の直列化 fake か、`Promise.all` で in-flight な Promise 同士を競合させ、結果を見る形にする。

### ロールバック手順

- 変更は `src/utils/trustDb/**` とそのテストに閉じており、`trust_db` のキー構造・schema・version 方式を変更しない。`git revert <commit>` で即座に旧 pure-additive union に戻せる。マイグレーション・バージョン bump は不要。
- ロールバック時に既存プロファイルの読み込みは壊れないが、**修正後に実際に消えたエントリは union に戻すと復活する**（= 修正前の既知バグに戻る）。リリースノートに 1 行だけ明記し、巻き戻しリリース時は削除済みエントリの再消失を許容とすること。
- 最悪のケース（選択肢 1 の (b) で別タブ追加を巻き戻す）の emergency フックとして、`MergeConflictNotice` 相当を UI に残す案も可。ただし本 PBI のスコープ外（別 PBI）。

## 見積もり

**5 SP**（🟡中）。理由: 単一ファイル bugfix の変更量は小さいが、「merge 方策の再設計」＋ kernel の intent モデル追加＋ 既存 lock 契約の維持＋ Red-first の再現テスト作成が支配的。最小でも 2 日、並行契約の裏取りを含めて 1 スプリントに収まる範囲。

## Definition of Done

- [ ] BDDシナリオが自動テストで実装されパス（Scenario 1〜6 の 6 件）
- [ ] `npm run validate` が緑（type-check + lint + 全テスト）。競合系は `npx vitest run <file> --repeats=20` で安定
- [ ] 監査 fingerprint `trust-db-save:merge-union-reverts-user-removals` を完了記録（CHANGELOG / 監査 ledger）に残す
- [ ] コードレビュー完了（Security Review 観点：信頼設定 = プライバシー防衛線。merge 変更が「より信頼する」方向にのみ働くことを確認）
- [ ] ドキュメント更新済み（`pbi/00-INDEX.md` への行追加、`trustDb` 配下に merge 方策の 1 段落ドキュメント、`CHANGELOG.md`）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現）
- 決め手: populated `trust_db`（`['a.example.com','b.example.com']`）を seed し `removeFromWhitelist('a.example.com')` を実行 → in-memory は `['b.example.com']` だが、**storage 書き戻し後は `['a.example.com','b.example.com']` に復活**（version bump 付き）
- 影響: 削除が再起動後に復活する実害を実証。Red テストとしてそのまま利用可能

## 関連

- `pbi/00-INDEX.md`（本 PBI の登録先。完了後は `dev-docs/archived/pbi/` へ移動しアーカイブ履歴へ）
- ストレージCAS系との整合を確認すること:
  - PBI 12「settings-blob stale patch」（監査 #21: ロック前の read で取得した patch が並行 commit 済み delta を巻き戻す）― **本件と同種の「古いスナップショットが削除を殺す／復活させる」問題**。settings 側の merge 方策（[2026-10-01-13-refactor-settings-repository-merge-unification.md](../dev-docs/archived/pbi/2026-10-01-13-refactor-settings-repository-merge-unification.md) の merge-under-lock 統一）と**同じ方策原則に揃える**こと。
  - PBI 18「withOptimisticLock cross-context window」（監査 #25: verify→set が context 跨ぎで非原子）― 本件の前提。`storageTransaction.ts` の `chains` は module-level Map であり context を跨げない。選択肢 1 で「別コンテキストの追加を巻き戻す」リスクはこの窓の上に重なっているため、**両 PBI の設計メモを相互参照すること**。
  - 既存の同種マージ先行例: `src/utils/storage/savedUrlRepository.ts:353` `mergeSavedUrlEntry` / `:363` `updateSavedUrlEntry`（CAS 内で要素単位 updater を適用する前例。本 PBI の選択肢 1 と構造が近い）
  - `src/utils/storage/storageTransaction.ts:230`（updateFn は pure かつ idempotent であるべきという契約コメント）
- 監査成果物: `/Users/yaar/security-audit-skill/obsidian-smart-history/run-2/`（`NEEDS-VALIDATION.md` 24番、`findings.json`、`REPORT.md`）
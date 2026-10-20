# PBI: 拡張コンテキストをまたぐ storage CAS の verify→set 窓で確定済み更新が黙って失われる問題の修正

## ユーザーストーリー

記録システム（yasumaro）を複数画面（service worker / popup / dashboard）で同時に使うユーザーとして、**ある画面で行った保存結果が、別画面の同時操作で「エラーも警告も出ずに消える」事態を起こさない**ことがほしい、なぜなら本拡張の記録はユーザーが「このURLは保存した」と認識し、その認識が実データとして永続化するのが製品価値の中心だから。特に `pending_pages`（未整理の記録候補）、`recording_recovery_claims`（記録回復の所有権クレーム）、`trust_db:json`（信頼DB）はいずれも**複数コンテキストから同時に更新されうるキー**で、lost update が起きると「保存したはずの記録が消えた」「信頼設定が勝手に戻った」という再現困難で診断もできない報告になる。エラーを出さないサイレントなデータ喪失はユーザーが追跡できるバグとして扱えないので、**どちらかが必ず検出されて競合として扱われるか、両方の更新が残る**こと（最悪でもユーザーに見える形で失敗すること）を保証したい。

## 優先度

- 順位: 18 / 25
- RICE: 600（Reach=100 / Impact=0.5 / Confidence=80% / Effort=0.2）
- 根拠: 監査18位。`storageTransaction` の per-realm chain は module-level Map で、1つの JS コンテキスト内の直列化にしか効かない（service worker / popup / dashboard はそれぞれ自分の module を持つ）。`chrome.storage.local` は compare-and-swap を持たず、CAS の verify read と set は別々の IPC で、post-write 検証も「自:set と自:verify の間に落ちた上書き」しか検出できない（注釈は「TOCTOU を塞ぐ」と書いているが実装はその範囲に過ぎない）。対象キンは `pending_pages` / `recording_recovery_claims` / `trust_db:json`。lost update の実害は、そのキーが何を持つかで決まる。
  - -cohort（該当プロファイル）: 同じ storage キーを 2つ以上の拡張コンテキストが同時に更新しうるプロファイル。具体的には次の3系統。
    - popup の「保存」フロー（`src/popup/pendingPages.ts:166` の `removePendingPages`）と、service worker の自動記録（`src/utils/pendingStorage.ts:221` の `addPendingPage` も同じ `pending_pages` へ書き込む）が、同一ユーザーが数秒以内に両方起きるケース
    - popup の discard 経路（`src/popup/pendingPages.ts:214`）と dashboard の onDelete / 再記録からの削除が、同じ `pending_pages` に対して並行するケース（3コンテキスト目が加わる）
    - 記録回復クレームの `recording_recovery_claims`（`src/utils/recoveryClaimStore.ts:23`）を、service worker 側と UI 側の両方が触るケース
    - `trust_db:json`（`src/utils/storage/types.ts:147`）を dashboard と他コンテキストが同時に更新するケース
- 種別: 🔧非機能追加（fix）
- 難易度: 🔴高（MV3 の制約下で真の CAS を組む必要があり、ブラウザAPIだけで完結しない可能性がある）
- 副作用: 🟡軽微

## 背景（監査の出典）

security-audit run-2 の needs_validation リード。fingerprint: `withOptimisticLock:cross-context-verify-set-window`。監査成果物: /Users/yaar/security-audit-skill/obsidian-smart-history/run-2/（`findings.json` / `NEEDS-VALIDATION.md:764`〜「## 25. withOptimisticLock CAS verify-then-set is not atomic across extension contexts; a concurrent writer can silently lose a committed update」）。

判定は `needs_validation`。run-2 の blocker は「2つのコンテキストの `chrome.storage.local` get/set ラウンドトリップが、実際に verify→set の窓の中で咬み合うかどうか。これはブラウザのスケジューリングや IPC レイテンシの事実に依存し、ソースからは観測できない」というもの。つまり**窓がソース上存在することは確定**しているが、**現実での発生頻度と、どちらの writer が更新を失うかは未検証**。このため本 PBI は「窓を消せるか」ではなく「窓が実際に開いたときに必ず収束するか」を問う形で、受け入れ基準とテスト戦略を下面で定義する。

### 再現経路（trace / evidence、行番号は実ファイルで確認したもの）

1. **module-level chain（シリアライズは 1 コンテキスト内のみ）** ― `src/utils/storage/storageTransaction.ts:33` の `const chains: ChainMap = new Map();`。`:35` の `runSerialized(key, fn)` がこの Map を介して per-key のマイクロタスクチェーンを張るが、Map は module-level なので **service worker / popup / dashboard はそれぞれ自分の module インスタンスを持ち、合流しない**。
2. **CAS のクリティカルセクションが 2 回の別 IPC にまたがる** ― `src/utils/storage/storageTransaction.ts:364` の `await port.get([key, \`${key}_version\`])`（verify read）と `:374` の `await port.set({ [key]: newValue, ... })`（set）は別々の await 済み IPC で、その間に browser-level の CAS は存在しない。バージョン比較は `:368` の `if (verifyVersion !== currentVersion) throw new ConflictError(...)`。
3. **port 層は素通し** ― `src/utils/storage/storagePort.ts:53-55` の `ChromeStoragePort.set` は `await chrome.storage.local.set(items)` を呼ぶだけ。storage 側の CAS も排他も無い（`get` は `:50-52` で同じく素通し）。
4. **post-write 検証の範囲** ― `src/utils/storage/storageTransaction.ts:376` の注釈「post-write verification always enabled ― closes TOCTOU window」と `:377` の `await verifyPostWrite(port, [key], [newValue], [newVersion])`。`verifyPostWrite`（`:199-214`）は**自分の set の後**に読み直し、自分が書き込んだ version と値を照合する。つまり検出できるのは「**自分の set と自分の verify の間に落ちた**上書き」だけで、**verify read（`:364`）と自分の set（`:374`）の間に落ちた上書きは検出できない**。注釈が主張する範囲と実装の範囲に乖離がある。
5. **エントリポイント（複数コンテキストから同じキーへ）** ― `src/popup/pendingPages.ts:166`（保存フローの `removePendingPages`）、同 `:214`（discard 経路）。これらは `src/utils/pendingStorage.ts:288` の `removePendingPages` から `withOptimisticLock(PENDING_PAGES_KEY, ...)` に入り、`:221` の `addPendingPage`（service worker 側の自動記録）と**同じ `pending_pages` キー**に対して CAS する。

### 既存テストとの区別（重要）

- `src/utils/__tests__/optimisticLockSerialization.test.ts:76` の describe `withOptimisticLock same-key serialization (TOCTOU)` は**同一コンテキスト内**の同キー直列化だけを pin している（module-level chain が効く範囲）。**cross-context の writer pair は一切カバーされていない**。
- `src/utils/storage/__tests__/withLockBypassRace.test.ts:224` の describe `R2 rationale: a version-non-bumping write is invisible to the CAS` が pin しているのは「version を bump しない **bypass writer** による不可視の上書き」という**別クラス**。本件は「**両方が正規の CAS writer** で、verify read が双方完了してから set が双方走る」**2-CAS-writer の cross-context clobber** であり、pin 済みクラスとは別の未 pin クラス。既存テストの期待値を書き換えてはならない（期待値を変えると別種類のテストになってしまう）。

## BDD受け入れシナリオ

```gherkin
Scenario: 2つの拡張コンテキストが同じキーを同時に更新したとき、片方の確定済み更新が黙って消えない
  Given 共有ストレージに pending_pages が ['a.com','b.com'] で存在し、context A（popup）と context B（service worker）はそれぞれ独立した StorageTransaction インスタンスを持つ
  And   context B の verify read が context A の set より先に解決するように、get をゲートで制御する（両方の verify read が完了してから set が走る deterministic interleave）
  When  context A が pending_pages を ['b.com'] へ更新し、context B が ['a.com','b.com','c.com'] へ更新する
  Then  意図した収束が起きる（片方の更新が必ず ConflictError として検出され競合として扱われる、または両方の更新が最終 storage の結果として確認できる）
  And   context A の確定済み更新が、ConflictError による観測なしに黙って失われない
  And   両方の caller が「成功」と報告したのに最終 storage に矛盾が残らない

Scenario: 同一コンテキスト内の既存直列化は引き続き保証される（回帰ガード）
  Given 1つの JS コンテキスト（同一 module インスタンス）の中で 2つの writer が同じキーへ同時に withOptimisticLock する
  When  両方の writer が read-modify-write を発行する
  Then  per-realm chain により先行した write が完了してから、後続の verify read が走る（既存の optimisticLockSerialization.test.ts:76 の期待が引き続きパスする）
  And   同一コンテキスト内の既存の挙動、および ConflictError + retry shell が変化していない
```

## 受け入れ基準

- [x] cross-context の deterministic interleave（get をゲートし、writer B の verify read を writer A の set より先に解決させる）に対して、**どちらかの更新が ConflictError として検出されるか、両方が最終結果として確認できる**ことを assert する自動テストが存在し、パスする（現状は片方の確定済み更新が黙って上書きされる）
- [x] 既存の `src/utils/__tests__/optimisticLockSerialization.test.ts`（同一コンテキストの直列化）と `src/utils/storage/__tests__/withLockBypassRace.test.ts`（version を bump しない bypass クラス）の期待値が変更されず、そのまま緑
- [x] `storageTransaction.ts:376` の post-write 検証の注釈が実挙動（自分の set と自分の verify の間に落ちた上書きしか検出できない）に合わせる形に更新され、TOCTOU 全体を塞ぐと読める記述が残っていない
- [x] `StoragePort` が cross-context の収束に必要なフック（書き戻し前の期待値照合、lease の取得と解放など）を**既存の呼び出しを壊さない**形で提供し、`ChromeStoragePort.set`（`storagePort.ts:53`）が無防備な素通しのまま残っていない
- [x] 採用した方式（単一 writer 集約 / lease / write-after-read 検証強化のいずれか）が ADR として記録され、**「browser level に真の CAS は無い以上、どれでも窓を小さくする程度までしかできない」**点が明記されている
- [x] 対象3キー（`pending_pages` / `recording_recovery_claims` / `trust_db:json`）それぞれについて、lost update が起きた場合に**どちらの更新が失われるか**と、実際の業務影響（何が残り何が消えるか）がコード読解だけで説明可能になっている
- [x] ブロッカー（needs_validation: cross-context の IPC が本当に verify→set の窓内で咬み合うか）の owner 観測チェックが手順書として残っており、**未確認のまま「競合は直った」と主張しない**構造になっている
- [x] `npm run validate` が緑（type-check ＋ 既存テスト）

## テスト戦略

- 単体: 2つの `StorageTransaction` インスタンスを1つの共有 `InMemoryStoragePort` に載せ、writer B の verify read が writer A の set より先に解決されるよう `get` をゲートし、writer A の commit が残るかを assert（現状は黙って上書きされる）。さらに「収束の形は ConflictError か、両方が確認できるか」を、採用戦略としてどちらが正しいかを pin する。時間は実際に待たず、ゲートの Promise 解決で drive すること（`dev-docs/TEST_RULE.md` の実時間待ち禁止に従う）。lease を採用する場合は、期限切れ lease の奪取（stale lease の回収）を別のケースで。
- 統合: `lockKeyBypassContract` / `optimisticLockSerialization` 系の既存 pin との整合。具体的には「同一 module インスタンス内では従来どおり直列化される」「`withAtomicKeys` の複数キー順序と deadlock 回避（`storageTransaction.ts:48` の `runSerializedMulti`）は変わらない」を確認する回帰ガード。module-level の `chains` Map（`:33`）を cross-context 対応に変更しても、`__resetStorageTransactionForTest`（`:59`）との整合が保たれること。
- E2E: owner 観測（popup の削除と dashboard の削除を同時に解放し、どの commit が落ちたかを見る）。実拡張を読み込み（`npm run build` の後に `chrome://extensions` で unpacked ロード）、popup の保存フローと dashboard の pending 削除を同じ URL に対して同時に解放し、`chrome.storage.local.get('pending_pages')` を読んで**どちらの commit が落ちたか**を記録する。実時間の sleep ではなく UI 操作の完了イベントで待つ。

## 実装メモ（実装者向け）

### 対象ファイルと該当行（trace / evidence から / 実ファイルで確認したもの）

| 場所 | 行 | 内容 |
|---|---|---|
| `src/utils/storage/storageTransaction.ts` | `:33` | `const chains: ChainMap = new Map();` ― module-level。cross-context では直列化にならない |
| 同 | `:35-46` | `runSerialized(key, fn)` ― per-realm のチェーン。module をまたげない |
| 同 | `:48` | `runSerializedMulti` ― 複数キーの順序保証（`withAtomicKeys` 用） |
| 同 | `:199-214` | `verifyPostWrite` ― 自分の set の**後**に読み直して照合。検出範囲は自分の set と自分の verify の間だけ |
| 同 | `:226` | `export class StorageTransaction` ― port を注入可能な単一 writer クラス |
| 同 | `:262` | `await runSerialized(key, () => performCasUpdate(...))` ― 直列化はこの 1 コンテキスト内のみ |
| 同 | `:364` | `await port.get([key, \`${key}_version\`])` ― verify read（IPC 1回目） |
| 同 | `:368` | `if (verifyVersion !== currentVersion) throw new ConflictError(...)` ― version 比較 |
| 同 | `:374` | `await port.set({ [key]: newValue, [\`${key}_version\`]: newVersion })` ― set（IPC 2回目）。隙間に CAS が無い |
| 同 | `:376` | 注釈「post-write verification always enabled ― closes TOCTOU window」― **実装より広い主張。要修正** |
| 同 | `:377` | `await verifyPostWrite(port, [key], [newValue], [newVersion])` |
| `src/utils/storage/storagePort.ts` | `:50-52` | `ChromeStoragePort.get` ― `chrome.storage.local.get` へ素通し |
| 同 | `:53-55` | `ChromeStoragePort.set` ― `chrome.storage.local.set` へ素通し（排他なし） |
| `src/popup/pendingPages.ts` | `:166`, `:214` | popup コンテキストからの `removePendingPages`（保存フロー / discard） |
| `src/utils/pendingStorage.ts` | `:68` | `PENDING_PAGES_KEY = 'pending_pages'` |
| 同 | `:221` | `addPendingPage` の `withOptimisticLock`（service worker 側の同一キーへの書き込み） |
| 同 | `:288` | `removePendingPages` の `withOptimisticLock` |
| `src/utils/recoveryClaimStore.ts` | `:23` | `CLAIMS_KEY = 'recording_recovery_claims'` |
| `src/utils/storage/types.ts` | `:147` | `TRUST_DB: 'trust_db:json'` |

### MV3 で cross-context の atomicity を得るための現実的な選択肢

browser level に真の CAS（compare-and-swap）は無い。`chrome.storage.local` は read も write も「最後に書いた者が勝つ」だけ。以下は**どれも「窓を小さくする」効果までにしかならない**ことを前提に選ぶこと。

1. **すべての storage 書き込みを service worker 単一コンテキストに集約する（単一 writer モデル）**
   - 最も確実。module-level の `chains` Map（`storageTransaction.ts:33`）が**本当に全 writer を直列化できる**。popup / dashboard は service worker へメッセージを送り、service worker が唯一の writer として CAS する。
   - ただし移行量が大きい（popup / dashboard / offscreen を含む全書き込み呼び出しをメッセージ化する）。**service worker が terminate されることによる中断**（MV3 の stateless 性）は本 PBI の窓とは別問題として残る。
   - 参考: popup / dashboard から service worker へのメッセージ経路（`chrome.runtime.sendMessage`）は本リポジトリに既に存在する。これを再利用するのが最小工数。

2. **lease / lock owner を chrome.storage で持つ（排他）**
   - 例: `<key>_lock` に owner id と期限日時を書き、書き込み前に取得、書き込み後に解放する。取得は「現在の lease を読む → 無い、または期限切れなら自分の lease を書く → もう一度読み直して自分の lease か確認（fencing token）」という流れで排他を近似する。
   - ただし**この取得の流れ自体も非原子**なので、得られるのは排他ではなく窓の縮小まで。加えて**期限切れ lease の回収**が要る（service worker が terminate されて解放されないと stale lease が残る）。stale lease の検出と回収が最大の運用コストになる。
   - 参考: `Mutex`（`src/utils/Mutex.ts`）と `ServiceWorkerContext` が既に service worker 内だけの排他機構として存在する。lease 版はその「service worker 内だけ」という制約を外すものになる。

3. **write-after-read 検証の強化（version ではなく指紋を再照合し、期待と違えば ConflictError で再試行）**
   - 現在 `verifyPostWrite`（`:199-214`）は version と値の照合のみ。**自分の set の後**に落ちた上書きしか検出できない。set の**直前にもう 1 回**読み直し、「まだ自分の持つ version か」を確認し、違うなら ConflictError を投げて既存の retry shell（`runCasRetryLoop`）に投げ直す。
   - ただし**自分の set の直前にどちらかが set を走らせる可能性**は依然として窓として残る。得られるのは窓の縮小まで。

**どれを選んでも「窓を消せる」わけではない。** 実装時にこの制約を ADR に明記し、「残存する窓はどれだけの幅で、どんな条件下で起きるのか」を文書として残すこと。

### ブロッカー（needs_validation: cross-context の IPC が本当に窓の中で咬み合うか）

- **着手前に潰すべき owner 確認**: 2つの拡張コンテキストの `chrome.storage.local` の get/set ラウンドトリップが、**verify read（`:364`）と set（`:374`）の間**で実際に咬み合うか。これはブラウザのスケジューリングや IPC レイテンシの事実に依存し、ソースからは観測できない（run-2 の blocker）。
- owner 観測手順: 実拡張を unpacked でロードし、popup の保存フローと dashboard の pending 削除を同じ URL に対して**同時に解放**し、`chrome.storage.local.get('pending_pages')` を読んで**どちらの commit が落ちたか**を記録する。
- 判定: 観測できた → 本 PBI の BDD シナリオが実在する競合を再現しているので実装に進む。観測できなかった → 窓は存在するが到達頻度が低い可能性があるため、**影響度（Impact）を再評価**してから優先順位を付け直す。**未確認のまま「競合は直った」と主張しない。**

### 既存テストとの区別（再掲 / 実装時に必ず守る）

- `optimisticLockSerialization.test.ts:76` は**同一コンテキスト**の同キー直列化のみ。本件は cross-context の writer pair で**別物**。既存テストの期待値を書き換えてはならない。
- `withLockBypassRace.test.ts:224` は **version を bump しない bypass writer** による不可視の上書き。本件は**両方が正規の CAS writer**で、verify read が双方完了してから set が双方走る **2-CAS-writer の cross-context clobber** で**別物**。理由説明を書き換えると別種類のテストになる。

### ロールバック手順

- 本 PBI の変更は `storageTransaction.ts` / `storagePort.ts` 周辺に閉じているため、**変更を 1 コミットにまとめ**、`git revert <commit>` で戻せるようにする。
- 単一 writer 集約（選択肢1）を採用した場合、**メッセージ経路の追加が主な差分**。revert しても既存の直接 port 書き込み経路は残るため、データ互換性上の取り残しデータにはならない（lease 方式の `<key>_lock` キーが残る場合は、起動時の sweep を入れて回収する）。
- lease 方式で stale lease が発生した場合は、`<key>_lock` の期限切れを待つか、`chrome.storage.local.remove` で明示的にクリアしてから再開する。
- write-after-read 検証の強化（選択肢3）の retry は**既存の retry shell（`runCasRetryLoop`）を通る**ため、revert しても既存の retry 挙動へ戻るだけで、データは壊れない。

## 見積もり

**SP: 8**（🔴高。🔴高 = 3pt以上目安。MV3 の制約下で真の CAS を組む必要があり、ブラウザAPIだけで完結しない可能性が高い）

内訳の目安:

- ブロッカー潰し（owner 観測チェック）: 1pt
- 選択肢の意思決定と ADR 記録: 1pt
- cross-context 収束の実装（単一 writer 集約が最大の工数、lease / write-after-read 検証強化なら中間）: 4〜5pt
- 単体 / 統合 / E2E のテスト整備: 1〜2pt
- 注釈修正とドキュメント更新: 0.5pt

**8pt 超は 1 スプリントに収まらない可能性が高く、着手前にシニアと設計相談すること**を推奨。選択肢 1（単一 writer 集約）は 4〜5pt 単独では大きいため、**フェーズ分割（ブロッカー潰し ＋ 選択肢3での窓縮小 → 必要なら選択肢1の writer 集約）の 2 段階**を推奨する。

## Definition of Done

- [x] BDDシナリオが自動テストで実装されパス
- [x] npm run validate が緑
- [x] 監査 fingerprint（`withOptimisticLock:cross-context-verify-set-window`）を完了記録に残す
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`storageTransaction.ts` の post-write 検証の注釈を実挙動に合わせる。`:376` の「closes TOCTOU window」は実装より広い主張）

## 調査結果（2026-10-18）

- 判定: **CONFIRMED**（局所再現。ブラウザ IPC の咬み合いは owner 観測）
- 決め手: 共有 GatedStoragePort 上に writer A/B を載せ、B の verify read を A の set より先に解決させると、B は version 0 を観測し、**両 CAS とも ConflictError を投げずに解決**。最終値は `['a.com','b.com','c.com']` となり **A の確定済み更新（a.com 削除）が黙って失われた**。同一 module 内の 2 インスタンスでは直列化が効いて両更新が残る（対照）
- 影響: 実装メモの `__performCasUpdateForTest` シームが再現に有効と確認。MV3 に真の CAS が無いという前提も仕様どおり

## 関連

- [pbi/00-INDEX.md](00-INDEX.md)
- ストレージ CAS 領域の PBI 06（trust-db merge / `2026-10-18-06-fix-trust-db-merge-union-removals.md`）、12（settings stale patch / `2026-10-18-12-fix-settings-stale-patch-revert.md`）、20（session auto-lock）と方針の整合を確認すること。特に PBI 06 は `trust_db:json`（本 PBI の対象キーの1つ）に直接触れ、PBI 12 は settings の stale patch（CAS の失敗モード）に直接触れる。**3件で「CAS が壊れるとき」の扱いを揃える**こと（それぞれが独立に「エラーにする」「握りつぶす」を選ぶと、利用者が矛盾した挙動を見る）。

## 完了記録（2026-10-20）

- 実装: `StoragePort` に任意の `compareAndSet` 書き込み時フェンスを追加（版キーを再読し全版が expected と一致する間だけ `set` を実行、不一致は false 報告）。`StorageTransaction` は最終版チェックを書き込み呼び出し内部へ置き、verify 読み取りと書き込みの間に commit した cross-context writer による黙って上書きを拒否（ConflictError として表面化）。
- 設計注釈: chrome.storage.local に真の CAS は無いため、フェンス内部の read→set 間の窓は残る（narrowing であり真の CAS ではない）。フェンス未実装ポートは `remove?` と同様に feature-detect で動作継続。
- PBI 06 / 12 / 20 の整合: PBI 06 は操作種別考慮の merge で trust_db の lost update を防ぎ、PBI 12 は settings の re-encryption を value-level CAS で防ぎ、本 PBI は汎用版キーの verify→set 窓をフェンスで狭める。3 件とも「失敗を握りつぶさず、検出して競合として扱う」方向で揃っている。
- 5 Whys: 確定済み更新が黙って失われるのは verify 読み取りと書き込みの間に cross-context writer が commit しても検出されないため → 版チェックが呼び出し側にあり呼び出し間で状態を保持できないため → MV3 に真の CAS が無い設計のため。解: 書き込み時フェンスで最終版チェックを write の直前へ移し、窓を構造的に最小化して競合を拒否可能に。
- 検証: 対象テスト（storageTransaction / cross-context 新規テスト）緑 / type-check / eslint 全緑 / フル validate 緑。
- 残置（owner 観測）: 実ブラウザでの IPC 咬み合い観測（2 コンテキスト同時書き込みの実環境再現）は owner タスクとして残置。

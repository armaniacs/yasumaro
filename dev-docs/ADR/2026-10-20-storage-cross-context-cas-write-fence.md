# ADR: クロスコンテキスト storage CAS の verify→write 突き合わせは Port 層の書き込み時フェンス（compareAndSet）で縮小する

## ステータス
採用済み

## 日付
2026-10-20

## コンテキスト

監査 fingerprint: `withOptimisticLock:cross-context-verify-set-window`（security-audit run-2、PBI `pbi/2026-10-18-18-fix-storage-cross-context-cas.md`、調査判定 CONFIRMED）。

`StorageTransaction` の CAS は、verify read（`storageTransaction.ts:435` の `port.get`）と
set（`:451` 付近の書き込み）が**別々の await 済み IPC** で、その間に browser レベルの CAS は存在しない。
per-key の直列化（`chains`、`:35`）は module 状態の Map なので、service worker / popup / dashboard
という**別々の JS コンテキスト**では直列化にならず、2つの正規 CAS writer の verify read が
双方完了してから set が走るインターリーブで、確定済み更新が黙って失われる。

### 確定済みの再現（PBI 調査結果 2026-10-18）

共有 GatedStoragePort 上に writer A/B を載せ、B の verify read を A の set より先に解決させると:

- B は version 0 を観測し、**両 CAS とも ConflictError を投げずに解決**した
- 最終値は B の値となり、**A の確定済み更新が黙って失われた**
- 同一 module 内の 2 インスタンスでは直列化が効いて両更新が残る（対照）

旧実装では、この喪失を検出できるのは post-write 検証（`:201`）だけだった。post-write 検証は
「自分の set の後」に読み直すため、**自分の verify read と自分の set の間に落ちた上書きは検出できない**。

### MV3 の前提

`chrome.storage.local` には compare-and-swap が無い。read も write も「最後に書いた者が勝つ」だけ。
**browser レベルに真の CAS が無い以上、どの方式でも窓を消すことはできず、窓を小さくする程度までしかできない。**
この制約が本決定の出発点である。

## 選択肢の比較

| 選択肢 | 得られる効果 | コスト / 残存リスク |
|---|---|---|
| 1. 全 storage 書き込みを service worker 単一コンテキストに集約 | chains が本当に全 writer を直列化できる。最も確実 | popup / dashboard / offscreen の全書き込み呼び出しをメッセージ化する大移行。SW terminate による中断は別問題として残る |
| 2. lease / lock owner を chrome.storage で持つ | 排他を近似できる | 取得の流れ自体が非原子。stale lease の回収が最大の運用コスト |
| 3. 書き込み時フェンス（version を取り直し、期待と違えば ConflictError で再試行） | verify→write 窓を 1 port 呼び出しの 2 IPC まで縮小し、窓外の全インターリーブを検出可能にする | フェンスの内部 read と内部 set の間という残余窓は残る |

## 決定事項

**選択肢 3（書き込み時フェンス）+ Port 層への `compareAndSet` フック追加を採用する。**
選択肢 1 は PBI 実装メモの推奨どおり段階分割の後続フェーズとして残す（今回の窓縮小で
到達頻度が実用上問題にならないと確認できた場合、実施しない判断もできる）。

### D1. `StoragePort.compareAndSet` を optional フックとして追加する

`storagePort.ts:39` に `compareAndSet?(items, expectedVersions): Promise<boolean>` を追加。
実装（`:78` の `compareAndSetViaGetSet`、`ChromeStoragePort` / `InMemoryStoragePort` の両方が採用）は
version key のみを 1 回読み、**全 version が期待値と一致したときだけ** items を書く。
`ChromeStoragePort.set`（`:97`）自体は非 CAS 呼び出し（settings 等）との互換のため素通しのまま残すが、
**CAS 経路の書き込みはこのフックを通る**ため、トランザクションは無防備な `set` に依存しなくなる。
optional（`remove?` と同様の feature detect）なので、既存の `StoragePort` 実装や
ハンドロールのテストダブルは壊れない（`storageTransaction.ts:255` で未実装ポートは旧来の
`port.set` 経路にフォールバック）。

### D2. 単一キー / 複数キー両方の CAS 書き込みをフェンス経由にする

- 単一キー: `performCasUpdate`（`:427`）は従来どおり verify read と version/値チェックを行い、
  その後 `commitWithCasFence`（`:249`）で `expectedVersions = { [`${key}_version`]: verifyVersion }`
  を渡して書き込む。
- 複数キー: `withAtomic`（`:380`）も同様に全 version key の期待値を渡す。
- フェンスが `false` を返した場合、観測 version を 1 回読み直して
  `ConflictError` を投げ、既存の retry shell（`runCasRetryLoop`）に流す。
  呼び出し側の挙動変更は「窓内の他コンテキスト commit が ConflictError として検出され、
  再試行で再収束する」ことだけである。

### D3. post-write 検証の注釈を実挙動に合わせる

`storageTransaction.ts` の post-write 検証（`:201`）と単一キー経路の注釈は、
「自分の set と自分の verify の間に落ちた上書きしか検出できない」実挙動に合わせて更新した。
「closes TOCTOU window」のような、実装より広い主張は残っていない。

## 残存する窓（明記すべき制約）

**browser レベルに真の CAS は無い。** 本フェンスが塞ぐのは、verify read から書き込みまでの
module コードの区間であり、最後の version 観測はフェンスの内部 read に移る。それでも
**フェンスの内部 read と内部 set の間**に他コンテキストの commit が落ちる場合は検出できない。
この残余窓の幅は「1 つの port 呼び出し内の 2 つの連続 IPC」であり、旧実装の
「verify read → set の間に module コードと chain のスケジューリングを挟む区間」より狭い。
窓を 0 にするには、選択肢 1（単一 writer 集約）か、browser 側の真の CAS を待つしかない。

## 対象 3 キーの lost update 影響（コード読解で説明可能にする）

どの writer が失うかは「フェンスで拒否された側（ConflictError → 再試行）」と
「commit を維持した側」で決まり、再試行は最新値から再構築するため、**両方の更新が残る方向に収束する**:

| key | 更新系統 | lost update が起きたときに何が残り何が消えるか |
|---|---|---|
| `pending_pages` | popup の保存/discard（`pendingStorage.ts` の `removePendingPages`）と service worker の自動記録（`addPendingPage`） | 旧実装: 後から set した側が勝ち、先に commit した側の追加または削除が**黙って消える**（保存したはずの記録が消えた、と診断不能な報告になる）。フェンス後: 拒否された側が再試行で再マージし、削除と追加が両方残る |
| `recording_recovery_claims` | service worker と UI の両方（`recoveryClaimStore.ts`） | 旧実装: 2 つの writer が**双方とも成功と報告**し、所有権クレームが 2 重に存在したり片方が黙って消えたりする（回復が 2 回走る、または走らない）。フェンス後: 負けた claimant が ConflictError を観測し、所有権が 1 つに収束する |
| `trust_db:json` | dashboard と他コンテキスト（`storage/types.ts` の `TRUST_DB`） | 旧実装: 後勝ちで、ユーザーの trust 設定が**黙って前の状態に戻る**。フェンス後: 拒否された側が確定済みの状態の上に自分の判断を再適用し、trust の反転が残る |

## owner 観測チェック（未実施 ― 本 ADR は競合の実-browser 発生を主張しない）

ブロッカー（needs_validation）「2 つの拡張コンテキストの get/set ラウンドトリップが、
verify read と set の間で実際に咬み合うか」は browser のスケジューリングと IPC レイテンシの
事実に依存し、ソースからは観測できない。**owner が次の手順で観測を完了するまで、
本 PBI は「競合の実-browser 発生は未確認」のまま扱う。** 未確認のまま「競合は直った」と主張しないこと。

1. `npm run build` の後、`chrome://extensions` で `dist/chromium-mv3` を unpacked ロードする
2. dashboard の pending 削除と popup の保存フローを、同じ URL に対してできるだけ同時に発火させる
3. `chrome.storage.local.get('pending_pages')` を読み、**どちらの commit が落ちたか**を記録する
4. 待ちは実時間の sleep ではなく、UI 操作の完了イベントで行う
5. 観測できた → 本 PBI の BDD シナリオが実在する競合を再現していると記録する
   観測できなかった → 窓は存在するが到達頻度が低い可能性があるため、
   **影響度（Impact）を再評価**してから優先順位を付け直す

## テスト

- `src/utils/storage/__tests__/storageTransaction-cross-context.test.ts`（新規）:
  - 単一キー: verify→write 窓内の他コンテキスト commit が ConflictError として検出され、
    再試行で両方の更新が最終 storage に残ること（BDD シナリオ 1）
  - 2-CAS-writer の決定論的インターリーブ（PBI 調査の再現形）で writer B が ConflictError
    を受け、writer A の確定済み更新が残ること。CAS ステップは調査で有効と確認済みの
    `__performCasUpdateForTest` シームで駆動し、module-level chain の合流を回避する
  - 複数キー: `withAtomic` の書き込みもフェンス経由であること
  - フェンス未実装の port が旧来の書き込み経路を維持すること（既存呼び出しの互換）
  - 同一 realm の 2 インスタンスは chain で直列化され続けること（BDD シナリオ 2 の回帰ガード）
- すべてのインターリーブは resolved promise のゲートで決定し、実時間の待機は無い
- 既存 pin（`optimisticLockSerialization.test.ts` / `withLockBypassRace.test.ts`）は
  期待値を変更せず、そのまま緑であることを確認済み

## 結果

### メリット

- クロスコンテキストの verify→write 窓内の他コンテキスト commit が、**必ず ConflictError として
  検出され**、既存の retry shell で再収束する。サイレントな lost update の主要形を塞ぐ
- 挙動変更は PBI の受入シナリオ（競合検出と収束）に限られ、既存テストの期待値は不変
- フェンスは Port 層の optional フックなので、既存の呼び出し・実装を壊さない

### デメリット / 残存リスク

- **残余窓は 0 にならない**: フェンスの内部 read と内部 set の間の commit は検出できない
- CAS 書き込みごとに version key の読み直し IPC が 1 回増える（書き込みは低頻度なので許容）
- 実-browser での咬み合い観測（owner 観測）は未実施。上記手順の完了まで本 ADR は
  発生頻度を主張しない

### 影響範囲

- 変更対象: `src/utils/storage/storagePort.ts`、`src/utils/storage/storageTransaction.ts`、
  新規テスト `src/utils/storage/__tests__/storageTransaction-cross-context.test.ts`
- 変更しない: `ConflictError` の契約、`runCasRetryLoop` の backoff 系列、
  `runSerialized` / `runSerializedMulti` の直列化、`__resetStorageTransactionForTest`、
  post-write 検証の有効化（常に on のまま）、`manifest.json`

### ロールバック

変更は `storagePort.ts` / `storageTransaction.ts` と新規テストに閉じている。
`compareAndSet` フックを外し、2 つの書き込み経路を `port.set` に戻せば旧挙動へ戻る。
データ互換の取り残しは発生しない（新しいキーは書かない）。

## 関連するADR

- [`withLock` の object 競合検知は version を唯一の durable signal とする](./2026-09-26-withlock-object-conflict-policy.md)
- [TrustDBアトミック性修正](./2026-03-20-trustdb-atomicity-fix.md)
- [ESLint ルールテストの `vitest --repeats` 対応](./2026-09-26-eslint-ruletester-vitest-repeats.md)

## 参照

- `pbi/2026-10-18-18-fix-storage-cross-context-cas.md`（監査出典: security-audit run-2、
  findings fingerprint `withOptimisticLock:cross-context-verify-set-window`）

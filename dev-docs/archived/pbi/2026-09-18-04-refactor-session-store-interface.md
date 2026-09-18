# PBI: SessionStore のインターフェース化と失敗時ポリシーの明示（refactor）

優先度: 台帳 RICE 1.9（Reach 3 / Impact 0.5 / Confidence 0.5 / Effort 0.4pt）
backlog: [2026-09-15-00-backlog-archloop-0915b.md](2026-09-15-00-backlog-archloop-0915b.md)（台帳、候補7）
依存: なし

## ユーザーストーリー

拡張機能を保守する開発者として、SessionStore の依存先にインターフェースを設け失敗時の挙動を型で明示してほしい、なぜなら現状は具象クラスへの直接依存とサイレントな失敗握りつぶしが同居しており、他の耐久性コンポーネント（PersistentRetryQueue・StorageTransaction）と一貫しない設計になっているから。

## 背景（現状と課題）

`src/background/sessionStore.ts` の `SessionStore` クラス（234行）にはインターフェースが存在せず、`TabCache`・`RateLimiter` から具象型として直接注入されている（`compositionManifest.ts:74,79,87,88`）。`RecordingCacheInstance` は `SessionStoreRecordingCacheStore` という薄いアダプタ経由で `RecordingCacheStore`（`recordingCache.ts:41-44`、`get`/`set` のみの狭いインターフェース）を経由しているが、`TabCache` と `RateLimiter` はこれすら経由していない。

durability 挙動:
- `set()` はデフォルト50ms debounce（`FLUSH_DELAY`、25行目）、`flushImmediately` オプションで即時flush可能（55-64行目のコメントに「SW終了時のデータロスウィンドウ」の明記あり）
- `get()` は `chrome.storage.session` が失敗した場合、例外を握りつぶして `null` を返すのみ（44-47行目）。リトライやフォールバック方針の記録がない
- `migrateFromLocalStorageIfSessionEmpty`（37行目）による `chrome.storage.local` からの一方向移行フォールバックはある

比較対象として、同リポジトリの `PersistentRetryQueue`（`persistentRetryQueue.ts`、TTL・retry count・maxPayloadBytes を `PersistentRetryQueueOptions` 型で明示、`RetryableItem` インターフェースあり）と `StorageTransaction`（`storageTransaction.ts`、CAS+バージョニング+書き込み後検証）は、共に冒頭コメントで「deep module」としての設計思想を明記し、失敗時ポリシーを型で保証している。`SessionStore` にはこの一貫性がない。

対応方針: `get` 失敗時の扱い（現状: 例外握りつぶし→`null`）を型・インターフェースとして明示化する `SessionStorePort`（仮称、`get`/`set`/`flushImmediately` を含む最小限のシグネチャ）を新設し、`TabCache`・`RateLimiter` の依存先をこのインターフェース越しにする。

対象外（スコープ外）: durability 保証そのものの機能追加（リトライ機構の新設、`get` 失敗時のフォールバック実装など）は本 PBI では行わない。必要であれば別 PBI として切り出す。既存の `get` 失敗時の挙動（`null` を返す）自体は変更しない。

## BDD受け入れシナリオ

```gherkin
Scenario: TabCache が SessionStorePort インターフェース越しに SessionStore を利用する
  Given SessionStorePort インターフェースが定義されている
  When TabCache が compositionManifest から注入を受ける
  Then TabCache は具象クラス SessionStore ではなく SessionStorePort 型で依存を受け取る

Scenario: 境界 — get 失敗時の挙動が統合後も現行と同一
  Given chrome.storage.session の get が例外を投げる状態
  When SessionStorePort.get() を呼び出す
  Then 現行と同じく例外は握りつぶされ null が返る（挙動変更なし、型のみ明示化）
```

## 受け入れ基準

- [x] `SessionStorePort`（または同等の名称）インターフェースが定義され、`get`/`set`/`flushImmediately` のシグネチャと `get` 失敗時の契約（例外を投げずに `null` を返す）が型コメントで明示されている
- [x] `TabCache`・`RateLimiter` が `SessionStore` 具象型ではなく `SessionStorePort` 型で依存を受け取るようリファクタされている
- [x] `compositionManifest.ts` の DI 登録がインターフェース経由になっている
- [x] `RecordingCacheStore`（`recordingCache.ts`）との統合要否を検討し、統合しない場合はその理由をコード上または PBI 内に残す（recordingCache.ts のインターフェース定義に doc comment で理由を記載済み）
- [x] 既存の durability 挙動（debounce・flushImmediately・get失敗時null）に変更がない
- [x] `npm run type-check` / `npm test` が green

## テスト戦略

- 既存テストの維持: `src/background/__tests__/sessionStore.test.ts` が無修正でパスすることで挙動不変を確認する。
- 単体テスト（新規）: `TabCache`・`RateLimiter` がインターフェース型のフェイク実装で動作することを検証するテストを追加し、具象クラスへの結合が外れたことを保証する。
- 契約テスト: `SessionStorePort` の `get` 失敗時契約（例外を投げず `null` を返す）を pin するテストを追加する。

## 見積もり

1 pt（インターフェース抽出+2箇所の依存差し替え。durability機能の新規実装は含まない）。

## 実装ガイド

- 着手時点での確認ポイント: `src/background/sessionStore.ts`、`src/background/compositionManifest.ts:74,79,87,88`、`src/background/tabCache.ts`、`src/background/rateLimiter.ts`、`src/background/recordingCache.ts:41-44`（既存の `RecordingCacheStore` との重複を避けるため先に読むこと）。
- `RecordingCacheStore` と今回新設する `SessionStorePort` の関係を先に整理すること。両者を無理に統一する必要はないが、目的の異なる2つの狭いインターフェースが並立する理由をコメントで残す。
- durability 保証の強化（リトライ・エラー通知）は着手しない。もし実装中に「ここもついでに直したい」という誘惑が出たら、それは別 PBI に切り出すこと。

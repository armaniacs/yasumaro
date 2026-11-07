# PBI 2026-11-07-04: raw chrome.storage.local を StoragePort 背後に集約する

> Rank: 4/9 | RICE: 1.6 (R5/I2/C0.8/E5) | depends: 2026-11-07-02 | round: holistic improvement

## ユーザーストーリー

開発者として、non-blob キー (migration state、pause marker など) の読み書きを StoragePort 実装の背後に集約したい。なぜなら raw な `chrome.storage.local` 呼び出しが各所に散在すると SSOT が崩れ、キー名と暗号化方針の変更が追跡できないからだ。

## 背景

SSOT (single source of truth) の実行後半として、blob 以外の小規模キーに対する直接アクセスを adapter 層へ移す。前提として PBI 2026-11-07-02 が先に完了していること (同じ `src/background/` 領域、lint-first の順序)。本 PBI では振る舞いを変更しない。

確認済み呼び出し箇所 (全て実コードで確認、要確認なし):

- `src/background/recordingPause.ts:68-73` - `getPausedUntil` の `chrome.storage.local.get` と `setPausedUntil` の `chrome.storage.local.set` (同ファイル 76 行目の `remove` も対象)
- `src/background/migration/migrationState.ts:37-60` - `ChromeMigrationStateAdapter` の status / progress / retryCount の get/set 計 6 件
- `src/background/sessionStore.ts:385,403,433` - emergency flush の `set`、単一キー移行の `get`、起動時移行の `get(null)` による `sw:` 走査
- `src/background/webhookExport/webhookExportSettings.ts:41-46` - `chromeLocalWebhookExportStore` の get/set
- `src/background/queueStorageAdapter.ts:27-33` - `ChromeStorageAdapter` の load/save

方針は次の通り。non-blob キーは StoragePort 実装の背後に置く。raw 呼び出しは adapter 内部だけに隔離する。キー名と暗号化要否の判断は adapter 層に集約する。

## BDD受け入れシナリオ

```gherkin
Scenario: pause marker が StoragePort 経由で読み書きできる
  Given 記録一時停止機能が有効である
  When ユーザーが 30 分の一時停止を開始する
  Then 一時停止期限が StoragePort 実装経由で保存される
  And 再起動後に同じ期限が復元される

Scenario: migration state が adapter 経由で同一に振る舞う
  Given 未完了の migration 状態が保存されている
  When migration が status と progress を更新する
  Then 更新前と同じキー名と値形式で保存される
  And 既存の保存値をそのまま読み戻せる

Scenario: session 移行が emergency flush と共存する
  Given session storage が空で local storage に sw: キーが残っている
  When service worker 起動時に移行処理が走る
  Then 対象キーが session 側へ移動し local 側から削除される
  And emergency flush の best-effort 性質は変わらない
```

## 受け入れ基準

- [x] non-blob キー (migration state、pause marker) が StoragePort 実装の背後に置かれている
- [x] 業務ロジック側の raw `chrome.storage.local` 呼び出しが adapter への委譲に置き換わっている
- [x] raw 呼び出しが adapter 内部だけに残り、それ以外の直接呼び出しが増えていない
- [x] キー名と暗号化要否の判断が adapter 層に集約されている
- [x] 既存データ形式と読み書き結果が同一であり、振る舞い変更がない
- [x] PBI 2026-11-07-02 の完了後に着手し、lint-first の順序が守られている

## テスト戦略

### 対象単体テスト

- `src/background/__tests__/sessionStore.test.ts` - emergency flush と `migrateFromLocalStorage` 系の回帰確認
- `src/background/migration/__tests__/migrationState-coverage.test.ts` - status / progress / retryCount の get/set 委譲確認
- `src/background/pipeline/steps/__tests__/webhookExportStep.test.ts` - settings の load/save 経路の回帰確認
- `src/background/__tests__/recordingAdmission-pause.test.ts` - pause marker の保存と復元の回帰確認
- queue 永続化の単体テスト - `ChromeStorageAdapter` の load/save 委譲確認

### 共通ゲート

- `npm test` が全件グリーンである
- `npm run type-check` がエラーなしである

Outside-In で進める。まず上記テストで失敗条件を確認し、次に adapter への委譲を実装し、最後にグリーンとリファクタリングを行う。

## 見積もり

5SP

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] `npm test` がグリーンである
- [x] `npm run type-check` がグリーンである
- [x] コードレビュー完了
- [x] ドキュメント更新済み

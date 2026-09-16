# PBI: GistSyncTarget が注入された settingsReader を無視する問題の修正

優先度: 順位 2 / 10（RICE: 6.0 = Reach 3 / Impact 1 / Confidence 1.0 / Effort 0.5 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: なし

## ユーザーストーリー

拡張機能の同期処理をテストする開発者として、`GistSyncTarget` の全経路がコンストラクタで注入された `settingsReader` を使うようにしてほしい。なぜなら現状は一部の経路だけが実ストレージに直接触るため、テストで InMemory の reader を注入してもその経路だけが実 `chrome.storage` に触れてしまい、テストの隔離と設定キャッシュの一貫性が壊れるから。

## 背景（現状と課題）

- `GistSyncTarget` の constructor は `settingsReader: SettingsReader` をデフォルト引数付き（デフォルトは共有 singleton の `settingsRepository`）で受け、フィールドに保持している。現状確認済み。
- `isConfigured()` は注入された reader 経由（`isCredentialConfigured(this.settingsReader, ...)`）で判定しており、DI シームが機能している。現状確認済み。
- 一方で以下 3 箇所が `new SettingsRepository()` を直接生成して注入を無視している。現状確認済み（いずれも `gistSyncTarget.ts` 内。行番号は着手時に再確認すること）。
  - `sync()` の前半（設定読み込み部）での `getAll()`
  - `sync()` の後半（Gist 新規作成時の GIST_ID 保存部）での `set()`
  - `testConnection()` の前半（設定読み込み部）での `getAll()`
- 実害は 2 点。
  1. テストで InMemory の `SettingsReader` を注入しても、この 3 箇所だけ実 `chrome.storage` に触る。既存テスト（`src/background/__tests__/markdownJoinSafety.test.ts` の Gist 経路、`src/background/__tests__/gistSyncTarget.test.ts`、`src/background/__tests__/gistSyncTarget-r2.test.ts`）が `SettingsRepository` クラス全体をモックして回避していることが、この分断の証拠として確認済み。
  2. `SettingsRepository` はインスタンスごとの 1 秒 TTL 設定キャッシュを持つため、直接生成したインスタンスは注入 reader のキャッシュと分断される。クラスが自分で宣言した DI シームが機能していない。
- 型の制約として、`SettingsReader` 型（`src/utils/storage/SettingsRepository.ts` で定義。現状確認済み）は `getMany` と `getAll` のみを持つ `Pick` 型であり、`set` に対応していない。そのため GIST_ID 保存部の置換には注入シームの型の扱いを決める必要がある（判断ポイントとして後述）。
- 関連経路として、`src/dashboard/gistSettings.ts` の接続テストハンドラは `new GistSyncTarget(sqliteClient)` で生成しており、`settingsReader` を明示していない（デフォルト singleton が使われる）。現状確認済み。本 PBI の修正後もデフォルト引数のまま動作すること。
- スコープ境界: 本 PBI は `GistSyncTarget` に限定する先行・部分修正である。同種の `new SettingsRepository()` 排除の全体対応は別 PBI（`pbi/2026-09-17-06-refactor-settings-repository-discipline.md`）で実施される。

## BDD受け入れシナリオ

```gherkin
Scenario: 注入した InMemory reader の値で sync が動作する（ハッピーパス）
  Given InMemory の SettingsReader に GITHUB_PAT を設定している
    And 実 chrome.storage には PAT が無い（または異なる値である）
  When GistSyncTarget の sync() を実行する
  Then 実 chrome.storage を参照せず、注入 reader の PAT で GitHub API 呼び出しが行われる
    And 新規 Gist 作成時は GIST_ID が注入 reader 側に保存される

Scenario: PAT 未設定の注入 reader では早期リターンする（境界）
  Given 注入した reader に PAT が無い
    And 実 chrome.storage には PAT が設定されている（または不確定である）
  When sync() / testConnection() を実行する
  Then isConfigured() による早期リターンが注入 reader の値に基づき成立する
    And GitHub API への fetch が発生しない（sync は { success: false }、testConnection は 'GitHub PAT not configured' を返す）
    And 実 chrome.storage への読み書きが発生しない
```

## 受け入れ基準

- [x] `sync()` の設定読み込み部が `this.settingsReader` 経由になっており、`new SettingsRepository()` を直接生成していない
- [x] `sync()` の GIST_ID 保存部が注入シーム経由になっており、`new SettingsRepository()` を直接生成していない
- [x] `testConnection()` の設定読み込み部が `this.settingsReader` 経由になっており、`new SettingsRepository()` を直接生成していない
- [x] 注入 reader に PAT が無い場合、`sync()` / `testConnection()` が fetch なしで早期リターンする（BDD Scenario 2 のテストで証明する）
- [x] 注入した InMemory reader だけで `sync()` のハッピーパスが完走し、実 `chrome.storage` に触れない（BDD Scenario 1 のテストで証明する）
- [x] 既存の GistSync 関連テスト（`gistSyncTarget.test.ts`、`gistSyncTarget-r2.test.ts`、`markdownJoinSafety.test.ts` の Gist 経路）が green のままである
- [x] `npm run type-check` が green である

## テスト戦略

- 新規テストは `GistSyncTarget` の constructor に InMemory 系の reader（`InMemoryStoragePort` 裏打ちの `SettingsRepository` 実体、または `getAll` / `getMany` / `set` を持つスタブ）を注入する形で書く。既存テストのように `SettingsRepository` クラス全体をモックしてごまかさない。
- 実ストレージ非接触の証明方法: `chrome.storage` へのアクセスを監視・禁止する（例: `SettingsRepository` のコンストラクタ呼び出しをスパイして `sync()` / `testConnection()` 経路で呼ばれないことを assert する、または `ChromeStoragePort` を使わない構成にして InMemory の値だけで完走することを assert する）。いずれか実装が容易な方を採用する。
- `fetch`（Gist 作成・更新・接続テスト）は既存テストと同様にモックし、送信された `Authorization` ヘッダの PAT が注入 reader の値であることを assert する。
- 境界テストでは注入 reader の PAT を空にした状態で `sync()` / `testConnection()` を呼び、`fetch` が呼ばれていないことと戻り値（`sync` は成功なし、`testConnection` は未設定メッセージ）を確認する。
- 既存テストのうち、`SettingsRepository` 全体モックに依存しているものは、本修正後に不要になったモックを縮小できるか検討する。縮小自体は必須としないが、壊れたテストは本 PBI の範囲で修正する。

## 見積もり

0.5 pt（半日程度）。3 箇所の置換と型シームの判断、および注入ベースのテスト 2 件が主体。既存テストのモック縮小を含める場合は +0.5 pt を見込むが、本 PBI では必須としない。

## 実装ガイド

### 修正対象（関数名 + 概略位置。着手時に現状を再確認すること）

- `GistSyncTarget.sync()` の前半（設定読み込み部）: `new SettingsRepository().getAll()` を `this.settingsReader.getAll()` に置換する。
- `GistSyncTarget.sync()` の後半（Gist 新規作成時の GIST_ID 保存部）: `new SettingsRepository().set(...)` を注入シーム経由に置換する。
- `GistSyncTarget.testConnection()` の前半（設定読み込み部）: `new SettingsRepository().getAll()` を `this.settingsReader.getAll()` に置換する。

### 判断ポイント: GIST_ID 保存部の型シーム（いずれか小さい方を採用し、採用結果を記録すること）

現状の `SettingsReader` 型は読み取り専用（`getMany` / `getAll` のみ）であり、`set` を持たない。以下 2 案のうち、小さい方を採用すること。

- 案 A: 注入シームの型を広げる。`SettingsReader` に `set` を持つ最小ポート（例: `SettingsReader & Pick<SettingsRepository, 'set'>` のような型エイリアス）を定義し、`GistSyncTarget` の constructor 引数の型をそれに変える。`SettingsRepository` 実体はそのまま渡せる。
- 案 B: 注入対象を `SettingsRepository` そのものにする。constructor 引数の型を `SettingsRepository`（デフォルトは共有 singleton のまま）に変え、`this.settingsReader` の型も追従させる。

判断基準: 呼び出し側（`dashboard/gistSettings.ts` の `new GistSyncTarget(sqliteClient)`）と既存テストの変更量が小さい方。デフォルト引数の互換性が壊れないことを条件とする。採用した案と理由を実装時のコミットメッセージまたはテストのコメントに残すこと。

### 触ってはいけないもの・範囲外

- `dashboard/gistSettings.ts` の `new GistSyncTarget(sqliteClient)` 呼び出しは変えなくてよい（デフォルト singleton のまま動作することが期待値）。
- `SettingsRepository` 本体（キャッシュ TTL、暗号化、マイグレーション）の挙動変更は範囲外。
- `GistSyncTarget` 以外のファイルにある `new SettingsRepository()` は本 PBI では触らない（別 PBI `pbi/2026-09-17-06-refactor-settings-repository-discipline.md` の範囲）。

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

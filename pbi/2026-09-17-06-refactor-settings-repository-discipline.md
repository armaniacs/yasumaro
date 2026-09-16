# PBI: new SettingsRepository() の直接生成を排除し、シーム経由に統制

優先度: 順位 6 / 10（RICE: 3.2 = Reach 8 / Impact 1 / Confidence 0.8 / Effort 2 pt）
backlog: [2026-09-17-00-backlog-arch-review-0917.md](2026-09-17-00-backlog-arch-review-0917.md)（台帳）
依存: pbi/2026-09-17-02-fix-gist-sync-settings-reader-seam.md を先に実施済みなら、その3箇所は本 PBI の対象から除外する（本 PBI 単独でも着手可）

## ユーザーストーリー
拡張機能を保守する開発者として、`new SettingsRepository()` の直接生成をなくし、読み取りは `settingsRepository` シングルトンまたは注入された `SettingsReader` に統一してほしい、なぜならインスタンスごとに分断された設定キャッシュと singleton 側に偏った副作用が、テスト時の実ストレージ接触や将来の不具合の温床になるから。

## 背景（現状と課題）
`src/utils/storage/SettingsRepository.ts` には明確なシームが存在する（`SettingsRepository` クラス、`export const settingsRepository = new SettingsRepository()` シングルトン、`SettingsReader` 型）。PBI 起票前の読み取りでいずれの実在も確認済みである。

それにもかかわらず、本番コード 14 箇所が `new SettingsRepository()` を直接生成している（起票前の grep では `new SettingsRepository()` 全 15 件中 1 件がシングルトン定義自身であり、残り 14 件が本番呼び出し箇所。着手時に再 grep して更新すること）。具体的な問題は次の通りである。

- インスタンスごとに 1 秒 TTL の設定キャッシュ（`CACHE_TTL`）が分断される。シングルトンに統一すればキャッシュは 1 箇所にまとまる。
- 再暗号化・observe の副作用は singleton 側に偏る。直接生成されたインスタンスの書き込みは別キャッシュ経路を通る。
- テストで InMemory ポートを注入している場合でも、`new` されたインスタンスは実 `chrome.storage` に触る。

なお `statusPanel.ts`・`whitelistWriter.ts` は既にシングルトン経由に移行済みであり、`recordingConditionsSettings.ts` の読み取り関数・`trancoConsent.ts`・`tagsPanel.ts`・`gistSettings.ts`・`markdownExport.ts` は `SettingsReader` のデフォルト引数注入パターン（`repo: SettingsReader = settingsRepository`）を採用済みである。本 PBI はこの既存の正規パターンへの寄せ集めであり、新規パターンの導入ではない。

## BDD受け入れシナリオ
```gherkin
Scenario: 直接生成が lint で検出されなくなる
  Given 本番コード 14 箇所（pbi/02 実施済みの場合は 11 箇所）が置換対象である
  When  置換が完了する
  Then  新規 import のみで `new SettingsRepository()` が `src/utils/storage/` 配下を除き検出されない（lint が green）

Scenario: dashboard の setAll 経路の observer 発火が等価である
  Given dashboard の setAll 経路（テンプレート管理・プロンプト管理・記録条件設定）
  When  singleton 経由に置換する
  Then  storage.onChanged 経由の observer 発火回数が置換前と同一である（parity）
```

Scenario 2 の根拠は起票前に確認済みである。`SettingsRepository` の `observe` メソッドは `port.onChanged` に委譲し、`changes` 内の `settings` キーの有無だけを見てキャッシュ無効化とコールバック実行を行う。すなわち発火は port level で動き、どの `SettingsRepository` インスタンス経由で `setAll` を呼んでも同一の `settings` キー書き込みになるため、発火回数は不変である。着手時にこの前提を再確認し、結果を作業記録に残すこと。

## 受け入れ基準
- [ ] 読み取り 4 箇所がシングルトンまたは注入された reader 経由に置換されている（`deps.ts` の `getSettings` 定義、`recordSession.ts` の記録実行処理、`previewFlow.ts` の `run` 冒頭、`statusChecker.ts` の並列取得処理）
- [ ] dashboard の `setAll` 7 箇所がシングルトン経由に置換されている（`markdownTemplateManager.ts` の有効化・削除・保存処理、`customPromptManager.ts` の作成・削除・有効化処理、`recordingConditionsSettings.ts` の保存処理）
- [ ] `gistSyncTarget.ts` の 3 箇所（`sync` 処理内の読み取りと GIST_ID 保存、`testConnection` 処理内の読み取り）は、pbi/02 未実施の場合のみ本 PBI で置換し、実施済みの場合は対象から除外している
- [ ] ESLint で `no-restricted-syntax` の `NewExpression` selector（`callee.name === 'SettingsRepository'`）による再発防止ルールが設定され、許可パス（`utils/storage/SettingsRepository.ts` 自身と composition 系）のみが除外されている
- [ ] `npm run type-check` / `npm run lint` / 対象テストスイートが green である
- [ ] 挙動変更がない（キャッシュ TTL の統合による副作用の減少は許容する）

## テスト戦略
- 既存テストの維持: `src/utils/storage/` 配下の既存テスト（`SettingsRepository.test.ts`・`settingsRepository-migration-parity.test.ts` 等）が green のままであること。
- Scenario 1 の自動化: lint ルール自体がテストになる。新規の `new SettingsRepository()` 追加時に lint が fail することを、許可外ファイルに一時的な生成コードを置いて確認する（確認後は削除）。
- Scenario 2 の自動化: dashboard の `setAll` 経路について、`storage.onChanged` 経由の observer 発火回数を置換前後で比較する parity テストを追加する。発火回数が同一であることを assert する。
- テスト時の実ストレージ接触の排除を確認する: 置換後の呼び出し箇所が InMemory ポート注入下で実 `chrome.storage` に触らないことを、既存のシームテスト群（`tagsPanel-seam.test.ts`・`gistSettings-seam.test.ts`・`markdownExport-seam.test.ts` 等）の方式に倣って確認する。

## 見積もり
2 pt。読み取り置換（4 箇所）・書き込み置換（7 箇所 + 条件付き 3 箇所）・lint ルール追加・parity テスト追加を含む。`gistSyncTarget.ts` の 3 箇所を pbi/02 が先に実施した場合はその分だけ縮小する。

## 実装ガイド

### 置換一覧表（起票前の grep・読み取りに基づく。着手時に再 grep して更新すること）

| # | ファイル | 概略位置（関数名 + 位置） | 用途 | 置換先 |
|---|---|---|---|---|
| 1 | `src/background/handlers/dashboardSqlite/deps.ts` | 依存組み立て関数の終盤にある `getSettings` 定義 | 読み取り | `settingsRepository.getAll()` |
| 2 | `src/popup/recordCurrentPage/recordSession.ts` | 記録実行処理の中盤にある設定取得 | 読み取り | `settingsRepository.getAll()` |
| 3 | `src/popup/recordCurrentPage/previewFlow.ts` | `PreviewFlow.run` の冒頭にある設定取得 | 読み取り | `settingsRepository.getAll()` または注入された reader |
| 4 | `src/popup/statusChecker.ts` | 状態確認処理の並列取得（`Promise.all` 内） | 読み取り | `settingsRepository.getAll()` |
| 5 | `src/dashboard/markdownTemplateManager.ts` | テンプレート有効化処理の保存呼び出し | `setAll` | `settingsRepository.setAll()` |
| 6 | `src/dashboard/markdownTemplateManager.ts` | テンプレート削除処理の保存呼び出し | `setAll` | `settingsRepository.setAll()` |
| 7 | `src/dashboard/markdownTemplateManager.ts` | テンプレート保存処理の終盤にある保存呼び出し | `setAll` | `settingsRepository.setAll()` |
| 8 | `src/dashboard/settings/customPromptManager.ts` | プロンプト作成処理の保存呼び出し | `setAll` | `settingsRepository.setAll()` |
| 9 | `src/dashboard/settings/customPromptManager.ts` | プロンプト削除処理の保存呼び出し | `setAll` | `settingsRepository.setAll()` |
| 10 | `src/dashboard/settings/customPromptManager.ts` | プロンプト有効化処理の保存呼び出し | `setAll` | `settingsRepository.setAll()` |
| 11 | `src/dashboard/recordingConditionsSettings.ts` | 記録条件保存処理の `setAll` 呼び出し（読み取り関数は注入済み） | `setAll` | 注入された `repo` または `settingsRepository.setAll()` |
| 12 | `src/background/syncTargets/gistSyncTarget.ts` | `sync` 処理内の設定読み取り | 読み取り | pbi/02 が担当（未実施時のみ本 PBI） |
| 13 | `src/background/syncTargets/gistSyncTarget.ts` | `sync` 処理内の GIST_ID 保存 | `set` | pbi/02 が担当（未実施時のみ本 PBI） |
| 14 | `src/background/syncTargets/gistSyncTarget.ts` | `testConnection` 処理内の設定読み取り | 読み取り | pbi/02 が担当（未実施時のみ本 PBI） |

`recordingConditionsSettings.ts` は読み取り関数（初期化・読み込み関数）が既に `SettingsReader` 注入済みのため、残る直接生成は保存処理のみである。保存処理も注入された `repo` に寄せるか、書き込みが `SettingsReader` 型の範囲外である場合は `settingsRepository` シングルトンに寄せる。

### lint 設計
- `eslint.config.js` は flat config 形式であり、`src/**/*.ts` 向けブロックに `no-restricted-imports` の前例がある（起票前に構成を確認済み）。同様式で `no-restricted-syntax` ブロックを追加する。
- selector: `NewExpression[callee.name='SettingsRepository']` に `message` を付与する（例: `Do not instantiate SettingsRepository directly. Use the settingsRepository singleton or an injected SettingsReader.`）。
- 許可パス: `utils/storage/SettingsRepository.ts` 自身（シングルトン定義箇所）は除外する。composition 系（DI 合成ルート）の除外が必要になった場合は、ファイルパス指定で最小限に除外し、除外理由をコメントに記録する。
- `src/**/__tests__/**` は既存ブロックで除外扱いが多いため、テスト内での `new SettingsRepository(InMemoryStoragePort)` 等の正規利用を壊さないよう、テストパスは除外対象に含める。

### 制約の再掲
- 挙動変更なし。キャッシュ TTL の統合は副作用の減少であり、許容する。
- 着手時の確認ポイント: `SettingsRepository.ts` のクラス・シングルトン・`SettingsReader` 型、上記呼び出し箇所の実コード、`eslint.config.js` の構成、`src/utils/storage/` 配下の既存テスト。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

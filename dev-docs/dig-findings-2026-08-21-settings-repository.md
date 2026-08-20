# 深掘りセッション — 2026-08-21 SettingsRepository Seam

対象: PBI 01 `SettingsRepository Seam — storage barrelの浅さを深い moduleに`  
スコープ判定: 中規模（1 module、2pt、interface 4メソッド + 2 adapters）— 高・中リスクを1-2ラウンド深掘り

## 挑戦した仮定

| 仮定 | リスク | 発見 | 決定 |
|------|--------|------|------|
| `get<K>(key)` の generic 4メソッドで全呼び出し元を置換できる | 高（実現可能性） | `getSettings()` 全件取得派（20箇所）と `chrome.storage.local.get([key])` 単一取得派（7箇所）の2パターンが混在。単一取得派は `get(K)` で置換可能、全件派は `getAll()` で置換可能。ドメイン別ヘルパー（例: `getObsidianConfig()`）は `getAll()` + 分割代入で代替でき、interface を膨らませるだけで depth を損なう。既存 `SettingsRepository.ts` も generic で実装済み。 | **A: generic 4メソッドのみ** — `get`/`set`/`getAll`/`onChange` に絞る。ドメイン別ヘルパーは必要なら module 外の純粋関数として後から追加可能とし、core interface からは除外 |
| `storage.ts` barrel を今回のPBIで物理削除できる | 中（スコープ） | barrel 削除は `grep -r "from.*storage.js" | wc -l` で27ファイルに波及。各ファイル1行変更だが、27ファイルは `vi.mock('../../utils/storage.js')` を使っているテスト100件以上に影響。直近の `RecordingPipeline` テストで barrel 直参照を `storage/types.js` に変えただけで5件失敗（`reviewSummaryGenerator` の `getSettings` mock が外れた）。物理削除は 0.5人月の Effort を超過し、PBIの本質（深さ）から逸れる。`dev-docs/LAYERS.md` Wave 3でも「barrel の段階的分割 — 各PBIで3-5ファイルずつ」と明記。 | **B: @deprecated 残置（段階的）** — 今回は Repository の深さに集中。barrel は `@deprecated` のまま残し、呼び出し元の移行が完了したことを `grep` で検証後に次PBIで削除。受け入れ基準の「re-export が削除され lintで検出可能」は「barrel への新規 import が lintで検出可能」に読み替え、 lint ルールで `from '../utils/storage.js'` を警告対象にする |
| `trustDb ↔ settingsStore` 循環を `StorageAdapter` 注入で物理的に断てる | 中（依存関係） | 循環は2経路: `settingsStore.getSettings() → import('../trustDb') → db.initialize()`（legacy 分岐）と `trustDb.TrancoVersionTracker → getSettingsStore()`（バージョン永続化）。前者は `migrateUblockSettings` 等の legacy migration 完了後に `db.initialize()` を呼ぶ業務要件、後者は Tranco バージョンの source-of-truth が `settings` にある業務要件で、どちらも ADR 2026-08-20 で「業務ルール上不可避」と記録。物理的に断つには `trustDb` が `StorageAdapter` に依存する形にし、`settingsStore` 側の `import` を削除する必要があるが、その場合 `getSettings()` 初回実行時の `db.initialize()` タイミングが変わり、v6.7.43 の暗号化キー永続化（`chrome.storage.local` vs `session`）の救済マイグレーションに影響するリスク。Effort 0.5人月では検証不足。 | **B: 現状維持 + 文書化** — 動的 `await import()` のまま残し、`SettingsRepository` は `settingsStore.getSettings()` の薄いラッパーとして完成させる。循環は ADR 通りに保護し、物理的解消は `TrancoVersionTracker` の `StorageAdapter` 化を別PBIで検討。今回の受け入れ基準「ADRが更新されている」は、循環が `SettingsRepository` の adapter 経由で将来的に解消可能である旨を ADR に追記することで満たす |

## なぜなぜ分析（徹底）

### Q1: なぜ generic 4メソッドで十分なのか

1. **なぜ** 呼び出し元は `StorageKeys.FOO` を直接知る必要があるのか → `getSettings()` が `Settings` 全件を返すため、呼び出し元は `settings[StorageKeys.FOO] as number || default` と再導出しているから
2. **なぜ** 再導出が必要なのか → `getSettings()` が defaults を適用して返すが、呼び出し元はその defaults が適用済みか確信できないため、自前で `|| default` を書いているから
3. **なぜ** 不確信が生まれるのか → `SettingsRepository` が存在せず、seam が `chrome.storage.local.get` に分散し、defaults/validation/encryption が interface に漏れているから
4. **なぜ** ドメイン別ヘルパーが不要なのか → `getAll()` で全件を一度に取り、分割代入すれば `const {OBSIDIAN_HOST, OBSIDIAN_PORT} = await repo.getAll()` で Obsidian ドメインの複数キーを1行で扱え、ヘルパーは糖衣に過ぎないから
5. **なぜ** 糖衣を core に入れない方が deep なのか → interface が小さいほど `depth = 実装量 / interfaceサイズ` が大きくなり、leverage が上がる。ドメイン別ヘルパーは必要になった時点で `settingsRepository.getObsidian = () => getAll().then(...)` のように module 外の純粋関数として追加でき、core の4メソッドを汚さないから
- **解**: generic 4メソッドで depth を最大化。ドメイン別は後から追加可能な sugar として分離

### Q2: なぜ barrel を今回削除しないのか

1. **なぜ** barrel 削除が27ファイルに波及するのか → `grep -r "from.*storage.js"` で27ファイルが `StorageKeys` を barrel 経由で参照しているから
2. **なぜ** 27ファイル変更がリスクなのか → 各ファイルのテストが `vi.mock('../../utils/storage.js')` で barrel を丸ごと mock しており、import パスを `storage/types.js` に変えると mock が外れ、直近の `reviewSummaryGenerator` で13件失敗した実績があるから
3. **なぜ** mock が外れると失敗するのか → `getSettings` は `settingsStore.js` の関数だが、barrel 経由で mock していたテストは `storage.js` の `getSettings` を差し替えており、直接 import に変えると差し替え先がずれ、`getSettings` が本物の `chrome.storage.local.get` を呼んでしまうから
4. **なぜ** 段階的が良いのか → `dev-docs/LAYERS.md` Wave 3でも「各PBIで3-5ファイルずつ」とし、1PBIで27ファイルを一度に変えるのは YAGNI に反し、2pt の Effort を超過するから
5. **なぜ** lint で代替できるのか → `storage.ts` を残したまま、eslint の `no-restricted-imports` で `from '../utils/storage.js'` を警告にすれば、新規コードの barrel 利用を機械的に防止でき、deletion test と同等の効果を段階的に得られるから
- **解**: 今回は repository の深さに集中し、barrel は `@deprecated` のまま残置。lint ルールで新規利用を防止し、次PBIで物理削除

### Q3: なぜ循環を物理的に断たないのか

1. **なぜ** `settingsStore → trustDb` の import が必要なのか → `getSettings()` の legacy 分岐（`settings_migrated === false`）で `migrateUblockSettings` 後に `db.initialize()` を呼ぶことで、Tranco リストの初期化を保証しているから
2. **なぜ** `trustDb → settingsStore` の import が必要なのか → `TrancoVersionTracker` が `StorageKeys.TRANCO_VERSION` を `settings` に永続化する必要があり、source-of-truth が `settings` にある業務要件だから
3. **なぜ** 両方向が不可避なのか → Tranco バージョンの永続化先を `settings` 以外（例: 専用の `chrome.storage.local` キー）に変えれば循環は断てるが、その場合 v6.7.43 の暗号化キー救済マイグレーションや `migrateJpLayoutDefault` 等の既存マイグレーションとの整合性を再検証する必要があり、0.5人月では不足するから
4. **なぜ** 動的 import で十分なのか → `await import()` は ESM キャッシュで2回目以降は即時解決し、性能影響なし。テストでは `vi.mock('../../utils/storage/settingsStore.js')` で直接 mock 可能で、ADR で保護済みだから
5. **なぜ** 今回は文書化に留めるのか → `SettingsRepository` 自体が `getSettings()` に委譲する薄いラッパーであり、循環の解消は `TrancoVersionTracker` が `StorageAdapter` に依存する形に変える別PBIで初めて意味を持つ。今回のPBIで `SettingsRepository` を完成させ、次のPBIで `trustDb` 側の注入に着手するのが locality を保つ最短経路だから
- **解**: 現状維持 + ADR 追記。`SettingsRepository` は `settingsStore` のラッパーとして完成させ、循環の物理的解消は次PBIで `TrancoVersionTracker` の adapter 化として分離

## 新たに発見したリスク
- `SettingsRepository.set()` が `chrome.storage.local.set({settings: current})` を直接呼び、adapter を迂回している（`src/utils/storage/SettingsRepository.ts:112`）。`get` は `getSettings()` 経由だが `set` は adapter を使わないため、`InMemoryStorageAdapter` でテストしても `onChange` が発火しないリスク
- `get(K)` が `getSettings()` 全件取得を毎回呼ぶため、`get` をループで呼ぶと N回 `chrome.storage.local.get` が発生する性能リスク。`getAll()` を推奨するガイドが必要
- barrel を残置する場合、lint ルールが無いと新規コードが再び barrel を使ってしまうドリフトリスク

## 未解決の疑問
- `onChange` の `changes['settings']` 以外のキー（例: `settings_migrated`）を無視する仕様で十分か — 現状の `onChanged` は `area === 'local'` の全変更を `settings` キーのみにフィルタしており、`TRANCO_VERSION` 等の個別キー変更は検出できない。次PBIで `StorageAdapter` が `settings` オブジェクト全体を監視する設計で十分か検証が必要
- `set` の adapter 迂回を今回のPBIで修正すべきか — 修正すると `saveSettings` の暗号化・楽観ロック・クォータ検証を `SettingsRepository` 側に再実装する必要があり、Effort が 0.5人月を超過する可能性。今回は `set` を `saveSettings` 経由に直す最小修正に留めるか、次PBIに回すか要判断（Phase 3で仮定を置く）

## 決定事項
1. interface は generic 4メソッドのみ（A）
2. barrel は @deprecated 残置で段階的削除（B）— lint ルールで新規利用を防止
3. 循環は現状維持 + ADR 追記（B）— 物理的解消は次PBIで `TrancoVersionTracker` の adapter 化として分離
4. `set` の adapter 迂回は今回のPBIで `saveSettings` 経由に修正し、`InMemory` でも `onChange` が発火するようにする（Phase 3の仮定として 4b で提示）

## 完全性チェック
- [x] 高リスク仮定がすべて調査された
- [x] スコープ判定で決めた深さまで掘った
- [x] すべての決定が記録された
- [x] 新たに浮かんだリスクが追跡された
- [x] 未解決の疑問が明示された

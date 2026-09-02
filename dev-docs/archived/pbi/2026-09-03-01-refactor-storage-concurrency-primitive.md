# PBI: Storage Concurrency Primitive 統合 — optimisticLock と keySerializer を単一 deep module に

## ユーザーストーリー
ストレージ整合性を担う開発者として、`withOptimisticLock` / `withAtomicKeys` と `runSerialized` / `runSerializedMulti` を単一の deep module に統合したい、なぜなら現在は 307l と 75l の shallow な分離で 4 subsystem（SettingsRepository / TrustDbKernel / PermissionManager / savedUrlRepository）が同一CASロジックを分散所有し、TOCTOU修正1件が4箇所に波及し InMemoryPort が `_version` を模倣しないため contract が乖離しているから

## 優先度
- 順位: 01 / 07
- RICEスコア: **720**（Reach=120 / Impact=3 / Confidence=0.8 / Effort=0.4）
- 根拠: blast radius が最大。全ストレージ書き込み（毎記録・毎TrustDb更新・毎permission記録・毎savedUrl更新）に影響し、1つの TOCTOU バグが4 subsystemを同時に壊す。後続の 03/04/05/06 全ての土台であり、依存関係上も最先行が必須。Effort は 2ファイル統合＋contract test追加で 0.4人週と小さい。

## 背景 / なぜなぜ分析サマリ
| 疑問 | 原因 → 示唆 → 解 |
|------|------------------|
| なぜ分離が shallow か？ | `keySerializer` は `Mutex` が `vi.useFakeTimers()` で止まるための置換として抽出されたが、単独では意味を持たず常に `optimisticLock` とセットで使われる → 2 file は1つの振る舞い（serialized CAS）を分割しているだけ |
| なぜ 4 subsystem に波及する？ | `withOptimisticLock` が Settings / TrustDb / Permission / savedUrl の4箇所から直呼びされ、CAS window / post-write verification / canonical equality が各呼び出し元に露出 → 修正が分散 |
| なぜ InMemory が乖離？ | `InMemoryStoragePort` が `_version` キーを模倣せず、`SettingsRepository` だけが `isChromePort` 分岐で CAS を迂回 → 同じ primitive が caller ごとに異なる振る舞い、post-write path がテストされない |
| なぜ post-write verification が不安定？ | コメントに4回の on/off 往復が記録され、interface に `enablePostWriteVerification()` が露出 → caller が invariant を知る必要があり seam が漏れている |

## BDD受け入れシナリオ

### Scenario: 単一キー CAS が TOCTOU を検出してリトライする
  Given 2つの並行コンテキストが同一キー `settings` を同時に read-modify-write する
  When 新しい `StorageTransaction.withLock('settings', updater)` が両方から呼ばれる
  Then 一方は成功し、もう一方は ConflictError を検出して指数バックオフでリトライし、最終的に両方の更新が直列化されて反映される

### Scenario: 複数キー原子性 — savedUrls と savedUrlsWithTimestamps が同時更新される
  Given `savedUrls` と `savedUrlsWithTimestamps` を `withAtomic(['savedUrls','savedUrlsWithTimestamps'], updater)` で更新する
  When 並行して別コンテキストが片方のキーを更新する
  Then どちらのキーも単独で観測される中間状態がなく、両キーの version が同時にインクリメントされるか、ConflictError で全キーまとめてリトライされる

### Scenario: InMemory と Chrome の contract 一致
  Given 同一の assertion suite（単一キー CAS / 複数キー原子性 / post-write 検証 / canonical equality）
  When `ChromeStoragePort` と `InMemoryStoragePort` の両方で suite を実行する
  Then 両ポートで同じ結果（成功/ConflictError の分岐）が得られ、InMemory が `_version` を正しく模倣する

### Scenario: post-write verification が常に有効
  Given `StorageTransaction` の利用者が `enablePostWriteVerification()` を呼ばない
  When verify read と set の間に並行上書きが起きる
  Then post-write の再読で不一致が検出され ConflictError が送出される（caller が opt-in する必要がない）

### Scenario: fake-timer 下でも直列化が進む
  Given `vi.useFakeTimers()` が有効なテスト
  When `withLock` / `withAtomic` が並行に呼ばれる
  Then `runSerialized` の microtask チェーンによりタイマー進行なしで直列化が完了する

## 受け入れ基準
- [x] `src/utils/optimisticLock.ts` と `src/utils/keySerializer.ts` が単一の deep module（例: `src/utils/storageTransaction.ts` または `src/utils/storage/storageTransaction.ts`）に統合され、外部 interface は `withLock` / `withAtomic`（命名は実装時に確定）の2メソッドに縮小している
- [x] `enablePostWriteVerification()` / `canonicalStringify` / `deepEqual` / `chains` Map が外部 interface から削除され module 内部に隠蔽されている（internal seam）
- [x] `SettingsRepository` の `isChromePort` 分岐による CAS 迂回が解消され、全 store が同一 seam を通る（InMemory も `_version` を扱う）
- [x] 既存の 4 caller（SettingsRepository / TrustDbKernel / PermissionManager / savedUrlRepository）が新 seam に移行し、`import { runSerialized }` の直接 import が残っていない
- [x] Contract test が `ChromeStoragePort` と `InMemoryStoragePort` の両方で同一 suite を実行し green
- [x] `npm run validate`（type-check + tests）が green、既存の optimisticLock / keySerializer 関連テストが新 seam 経由で pass

## テスト戦略
- 単体: `StorageTransaction` の CAS 競合・リトライ・指数バックオフ・post-write 検証・canonical equality（キー順序違いの deepEqual）・`withAtomic` の key-ordered deadlock 回避を InMemory で検証
- 統合: 上記 contract suite を Chrome mock（`chrome.storage.local` stub）と InMemory の両方で実行し結果一致を検証
- 単体: fake-timer 下での `runSerialized` 進行テスト（`vi.useFakeTimers()` + `await withLock` が timer advance なしで解決）
- E2E/回帰: 既存の `withOptimisticLock` / `withAtomicKeys` / `keySerializer` テストを新 seam に移行し green を確認

## 見積もり
3 pt（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `src/utils/keySerializer.ts` が削除または internal 化され、外部からの直接 import が 0 件（`grep` で確認）
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`dev-docs/DESIGN_SPECIFICATIONS.md` / 必要なら ADR の storage 層記述）
- [x] `npm run validate` green

## 実装メモ（任意）
- 新 module 配置は `src/utils/storage/storageTransaction.ts` を推奨（storage 層に寄せる）が、`src/utils/optimisticLock.ts` を deep 化して `keySerializer.ts` を吸収する形でも可。いずれも外部 interface は 2 メソッドに縮小すること。
- `InMemoryStoragePort` の `_version` 対応は `get` / `set` で `key_version` を自動管理する形で実装。

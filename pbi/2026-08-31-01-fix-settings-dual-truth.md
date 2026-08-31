# PBI: Settings 二重真実の解消 — SettingsRepository への単一化と versioned StoragePort

## ユーザーストーリー
開発者として、Settings の読み書きを単一の深い Module（SettingsRepository）経由に統一したい。なぜなら現在 34 箇所が `settingsStore.legacy` の 1s キャッシュ経由、6 箇所が `SettingsRepository` 経由の二重真実になっており、defaults / migration / encryption / quota の知識が分散し、テストでは InMemory が optimisticLock を再現せず prod と乖離しているから。

## 優先度
- 順位: 01 / 06
- RICEスコア: **2160**（Reach=800 / Impact=3 / Confidence=0.9 / Effort=1）
  - Reach 800: 34 call sites + 全 pipeline / AI / Obsidian / DomainPolicy が Settings に依存。月間全 recording に波及
  - Impact 3: 根本的 Correctness（呼出側の `|| 'default'` 再導出を消し、migration 前後の scattered fallback 到達不能を解消）
  - Confidence 0.9: ホットスポット 14 回、コードで二重経路を確認済み
  - Effort 1: 1 人週（Port 拡張 + repo 内 cache 移設 + 34 箇所置換）
- 根拠: 全候補中 Reach×Impact が最大。依存関係上も Pipeline(02) と TrustDb(03) が Settings に依存するため、先に完了させないと後続の Leverage が得られない。スコアでも 1 位。
- 依存: なし（他候補の前提になる）

## 背景 / なぜなぜ分析
- 表層: `getSettings()` と `repo.getAll()` のどちらを使うべきか不明
- なぜ1: 歴史的に `settingsStore.legacy.ts` が cache + `buildAllowedUrls` 副作用を持ち、Phase15 で `SettingsRepository` が追加されたが移行が未完
- なぜ2: `storagePort.ts` の InMemory が `getBytesInUse` / `optimisticLock version` を持たないため、テストが prod の CAS 競合を検証できない
- なぜ3: `SettingsRepository.getAll` の scattered fallback（30 keys 個別 fetch + backup restore）は migration 後に到達不能だが、削除が怖くて残置 → 未テスト経路
- なぜ4: `settingsStore.ts` が 1 行 re-export の shallow module として残り、deletion test で「消しても複雑さは移動しない」にもかかわらず削除されていない
- 解: StoragePort に version/getBytesInUse を持たせ InMemory が CAS を再現。cache を repo 内に移設し、legacy 二層を削除。scattered fallback は内部テスト用 seam に格下げ。

## BDD受け入れシナリオ

Scenario: 単一の Seam 経由で Settings を取得できる
  Given 開発者が任意の call site で Settings を必要としている
  When   `settingsRepository.getMany([StorageKeys.OBSIDIAN_API_KEY, StorageKeys.AI_PROVIDER])` を呼ぶ
  Then   defaults で補完された typed な値が返り、Chrome でも InMemory でも同じ結果が得られる
  And    `chrome.storage.local.get` の呼出は repo 内で 1 回に集約される

Scenario: InMemory でも optimisticLock 競合が再現される
  Given InMemoryStoragePort に `settings:version` が 1 で保存されている
  When  2 つの並行 `repo.setAll({...})` が同じ version を読んで書き込む
  Then  片方は version 競合でリトライし、最終的に両方の変更がマージされる（prod の withOptimisticLock と同挙動）

Scenario: legacy cache 経路が存在しない
  Given コードベース全体を grep する
  When  `from '../storage/settingsStore'` / `getSettings()` の import を検索する
  Then  0 件である（全 34 箇所が `SettingsRepository` / `SettingsReader` に置換済み）
  And   `src/utils/storage/settingsStore.legacy.ts` と `settingsStore.ts` shim が削除されている

Scenario: 境界 — getBytesInUse 不可用でも getAll は成功する
  Given `chrome.storage.local.getBytesInUse` が throw する環境（jsdom / 権限なし）
  When  `repo.getAll()` を呼ぶ
  Then  quota チェックはスキップされ、migration/decrypt は正常に完了する

## 受け入れ基準
- [ ] `StoragePort` が `get/set/onChanged/getBytesInUse` に加え `getVersion/setVersion`（または version 付き read/write）を公開し、`InMemoryStoragePort` が CAS セマンティクスを再現する
- [ ] `SettingsRepository` が 1s TTL cache と `buildAllowedUrls`/`computeUrlsHash` 副作用を内部に持ち、外部から `cachedSettings` に触れられない
- [ ] `src/utils/storage/settingsStore.legacy.ts` / `settingsStore.ts` が削除され、34 箇所の `getSettings` import が 0 になる
- [ ] `getAll()` の scattered fallback が削除または `__internal` なテスト専用 seam に分離され、通常経路のカバレッジが 90% 以上
- [ ] 既存の `SettingsRepository.__tests__` 18 ファイルが InMemory version 付きで green、e2e の Settings 保存が手動で成功する
- [ ] ADR `2026-03-20-default-settings-single-source` に追記（単一化の完成）

## テスト戦略
- E2E: ダッシュボードで Obsidian/AI 設定を保存 → 再読込後も反映される、chrome.storage の `settings:version` がインクリメントされる
- 統合: InMemory vs Chrome Port の両方で `getMany` / `setAll` / `observe` が同一結果を返す。並行 write の競合テスト
- 単体: `applyMigrationsAndDecryptWithReEncrypt` 純粋関数テスト、cache TTL 境界（0ms / 999ms / 1001ms）、`tryRestoreFromBackupViaPort` の backup 復元、getBytesInUse throw 時のフォールバック

## 見積もり
3 pt（要チームでの見積もり）— Port 拡張 1pt + repo cache 移設 1pt + 34 箇所置換と削除 1pt

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了（storage / pipeline / trustDb の影響確認）
- [ ] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の Storage Keys 章、ADR 追記）
- [ ] `npm run validate`（type-check + tests）が green

## 実装メモ（任意）
- `StoragePort` 拡張は `ChromeStoragePort` が `withOptimisticLock` の version 読みを Port 経由に委譲する形に
- `observe` は Port の `onChanged` をそのまま委譲（既存の `onChange` エイリアスは削除し `observe` に統一）
- 移行は codemod 的に `getSettings()` → `repo.getMany([...])` / `repo.getAll()` に置換。`SettingsReader` 型は維持

# PBI: TrustDb God Module 解体 — TrustPolicy / ManagedCollections / TrustDbKernel への分割

## ユーザーストーリー
開発者として、TrustDb の 609 行 God object を 3 つの深い Module に分割したい。なぜなら `isDomainTrusted` / `addUserTld` / `addSensitiveDomain` など 15 facade、静的共有 `initPromise`、15 field 補完の `repairDatabase`、3×`ManagedStringList` が一箇所に集中し、直近 5 hotfix がすべて `repairDatabase` 起因の pipeline-error で、preset 追加が 4 ファイルに跨り漏れが再発するから。

## 優先度
- 順位: 03 / 06
- RICEスコア: **320**（Reach=400 / Impact=2.5 / Confidence=0.8 / Effort=2.5）
  - Reach 400: 全 visit の trust 判定（VALID_VISIT の checkTrustDomainStep）が対象。hot spot 10 回
  - Impact 2.5: 圧倒的ではないが大きい。破損 DB 修復の包括化で pipeline-error 5 連発を根絶。Leak する dynamic import 循環も解消
  - Confidence 0.8: God 化と shallow 委譲は確認済み。repair の純粋関数化の工数に不確実性
  - Effort 2.5: 2.5 人週（3 Module 分割 + repair 純粋化 + shallow Store 削除 + 循環解消）
- 根拠: RICE 3 位。01 Settings 後が望ましい（TrustDb が settingsStore を動的 import しており、Port に置換するため）。01 と並行着手も可能だが、02 Pipeline との競合を避けるため 02 の後。
- 依存: 01 Settings 単一化（推奨）。`getSettingsStore` / `getStorageTypesStatic` の動的 import を Port に置換するため。

## 背景 / なぜなぜ分析
- 表層: `repairDatabase` に手を入れるたびに別の欠落が顕在化し hotfix が連発
- なぜ1: `repairDatabase(db: Record<string,unknown>)` が引数のオブジェクトを in-place mutate し、`wasRepaired` 判定後に `save()` で部分永続化 → `bloomFilterFromData` が throw しても中途半端な DB が残る
- なぜ2: `WhitelistStore` / `SensitiveDomainStore` が `ManagedStringList` の 1:1 shallow ラッパーで、deletion test で「消しても複雑さは移動するだけ」
- なぜ3: `buildManagedStringLists` が `save: () => this.save()` closure を 3 つ生成し、`withOptimisticLock` の競合時にどの save が勝つか不明
- なぜ4: `settingsStore ↔ trustDb` の循環が dynamic import で隠蔽され、StoragePort を迂回して `chrome.storage.local.get('trust_db:json')` を直接読む唯一の utils になっている
- なぜ5: `TrancoVersionTracker` が `getStorageTypes` を deps として要求するが、実際は static import で足りる
- 解: `repairDatabase` を純粋関数 `repair(db)->db` に。shallow Store を削除し `ManagedCollections` 一つに。判定は `TrustPolicy.isDomainTrusted` 一つの深い Seam に。Settings 依存は Port 経由に。

## BDD受け入れシナリオ

Scenario: 破損 DB が包括的に修復される
  Given `trust_db:json` が `jpAnchor.tranco/sensitive/bloomFilter` のいずれかを欠く破損状態
  When  `TrustDbKernel.initialize()` を呼ぶ
  Then  `repairDatabase` 純粋関数が全必須 field を既定値で補完し、`bloomFilterFromData` が成功する
  And   修復後に `save()` が 1 回だけ呼ばれ、再読込後も pipeline-error にならない

Scenario: 単一 Seam で trust 判定ができる
  Given 初期化済みの `TrustPolicy`
  When  `policy.isDomainTrusted('example.com')` を呼ぶ
  Then  BloomFilter → Tranco → Preset の 3-step 検証が内部で実行され `TrustResult` が返る
  And   Caller は Bloom / Tranco の内部を意識しない

Scenario: ManagedCollections で preset 追加が一箇所で完結
  Given 開発者が `presets.ts` に finance preset を 1 ドメイン追加する
  When  `ManagedCollections.addSensitiveDomain` 経由で保存する
  Then  `presets.ts` と `TrustDbKernel.repair` の 2 ファイル変更で完結し、別途 Store 層の変更は不要

Scenario: 境界 — 競合する並行 save で optimisticLock が正しくマージされる
  Given 2 つのタブが同時に `addUserTld('.example')` を呼ぶ
  When  両方の `save()` が `withOptimisticLock` で競合する
  Then  `mergeTrustDatabase` により両方の TLD が和集合で保存され、片方の変更が失われない

Scenario: エラー — 未初期化で isDomainTrusted を呼ぶと UNVERIFIED を返す
  Given `TrustDbKernel.initialize()` 未実行
  When  `policy.isDomainTrusted('example.com')` を呼ぶ
  Then  `level: UNVERIFIED, reason: 'Trust database not initialized'` が返り、throw しない

## 受け入れ基準
- [x] `repairTrustDatabase(input): Record<string,unknown>` が純粋関数として `trustDbRepair.ts` に抽出され in-place mutate しない。`TrustDbKernel.repairDatabase` はテスト互換の薄い委譲 shim（15 field の欠落をカバーするテストあり）
- [x] `WhitelistStore` / `SensitiveDomainStore` が削除され `ManagedCollections`（userTlds / sensitive / whitelist を束ねる単一 Module）に置換。`ManagedStringList` は内部実装として残存
- [x] `TrustPolicy` が `isDomainTrusted / isTrancoDomain` を公開し、`DomainVerifier / BloomFilterManager / TrancoManager` を private に隠蔽
- [x] `TrustDbKernel` が `initialize / save / rebuildCaches` を担当し、settings アクセスは注入可能な `settingsReader` port 経由（動的 import なし）
- [x] `getStorageTypesStatic` 動的 import は存在しない
- [x] Tranco version tracking / atomicity 回帰テストが green
- [x] `chrome.storage.local.get(STORAGE_KEY)` を直接読む箇所は `TrustDbKernel.ts` の 1 箇所のみ

## テスト戦略
- E2E: 破損 DB（手動で `trust_db:json` を欠落させた状態）からの起動 → 自動修復 → VISIT が pipeline-error にならない
- 統合: `TrustPolicy` の 3-step 検証（Bloom hit/miss × Tranco hit/miss × preset）、`ManagedCollections` の add/remove 永続化と optimisticLock 競合
- 単体: `repairDatabase` 純粋関数の全 field 欠落パターン、`bloomFilterFromData` throw 時の挙動、`initPromise` 静的共有の並行 initialize

## 見積もり
8 pt（要チームでの見積もり）— 純粋関数化 2pt + shallow Store 削除と Collections 統合 2pt + TrustPolicy 抽出 2pt + 循環解消と Kernel 集約 2pt

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（trustDb / pipeline / storage の影響確認 — 2026-09-01。dead code だった `whitelistStore.ts` / `sensitiveDomainStore.ts` を削除）
- [ ] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の Trust 章、ADR 2026-08-20 circular-dependency に追記）
- [x] `npm run validate` が green（破損 DB からの復旧の手動確認は未実施）

## 残作業（次セッション）
- DESIGN_SPECIFICATIONS.md の Trust 章 / ADR 2026-08-20 への追記
- 破損 DB からの復旧の手動 e2e 確認

## 実装メモ（任意）
- `TrustDb` クラスは互換 shim として一時残し、内部で Kernel/Policy/Collections に委譲。`getTrustDb()` singleton は廃止方向で `createTrustDbKernel` に移行
- `repairDatabase` の純粋化にあたり、`db.bloomFilter` が corrupt な場合は `createBloomFilterFromPresets` で再生成する分岐を追加
- Preset 追加時の手順を `presets.ts` コメントに明記（repair の既定値補完と同期が必要なことを可視化）

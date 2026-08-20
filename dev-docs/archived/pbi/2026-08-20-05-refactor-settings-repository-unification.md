# PBI: Settings Repository への統合 — 散在する StorageKeys アクセスを深いモジュールに集約

## ユーザーストーリー
開発者として、`StorageKeys` 定数（30+）が `src/utils/storage/types.ts`（463行）で定義されているものの、実際の `chrome.storage.local.get/set` 呼び出しが `generalSettingsPanel.ts`, `settingsFormBinding.ts`, `settingsPipeline.ts`, `obsidianClient.ts`, `aiServiceFactory.ts`, `contentExtractor` 等の30+箇所に散在し、各呼び出し元が個別にデフォルト値・暗号化要否・マイグレーション有無を再導出している状態を解消したい。なぜなら、1つの設定キー（例: `OBSIDIAN_API_KEY`）のデフォルト値を変更するのに6ファイルを編集する必要があり、`data-storage-key` の typo が silent fail として検出されないからだ（PBI 05 Settings Schema は DOM 側の typo は防ぐが、storage 側の散在は未解消）。

## 優先度
- 順位: 05 / 5
- RICEスコア: (Reach=5 × Impact=1 × Confidence=0.6) / Effort=3 = 1.0
- 根拠: Reach 5（設定変更を行うユーザー + 設定を読み取る全 recording パス。だが設定変更自体は低頻度）。Impact 1（開発者生産性の向上に留まり、ユーザーの直接的な価値（保存成功・AI品質）には影響しない）。Confidence 60%（PBI 05 Settings Schema との責務境界が曖昧 — DOM 側の schema と storage 側の repository で2つの schema が並立するリスクがある。どちらが source of truth か未確定）。Effort 3人日（30箇所の呼び出し移行 + 暗号化/migration の内部化 + 型安全な get/set の実装）。04（Diagnostics Panel）の後に着手する方が効率的 — Panel Lifecycle が安定してから repository の `onChange` 購読を設計できる。依存: 04（Panel Lifecycle 安定後に `onChange` 設計）+ PBI 05（Settings Schema の shape 確定後）。

## ビジネス価値
- 保守性: 設定キーの追加・デフォルト変更・暗号化ポリシー変更が `SettingsRepository` の1箇所で完結する。各呼び出し元は `repo.get(StorageKeys.X)` の1行で済む。
- 型安全性: `repo.get()` は `StorageKeys` に対して型安全であり、存在しないキーや型不一致はコンパイルエラーになる。現在は `chrome.storage.local.get('typo_key')` が `undefined` を返し silent fail する。
- 測定方法: 存在しない `StorageKeys` へのアクセスがコンパイルエラーになることを型レベルテストで保証。新規設定キー追加時の編集ファイル数が 6 → 1 に削減されることを計測。

## BDD受け入れシナリオ

```gherkin
Scenario: 型安全な get/set で設定が読み書きされる
  Given SettingsRepository が存在する
  When repo.get(StorageKeys.OBSIDIAN_API_KEY) が呼び出される
  Then 正しい型（string | undefined）で値が返却される
  And 存在しないキー（例: "typo_key"）へのアクセスはコンパイルエラーになる

Scenario: デフォルト値が repository 内部で管理される
  Given 設定が未保存の状態で repo.get(StorageKeys.OBSIDIAN_PORT) が呼び出される
  When 値が取得される
  Then デフォルト値（例: "27124"）が返却される
  And 呼び出し元がデフォルト値を知る必要がない

Scenario: 暗号化が透過的に処理される
  Given OBSIDIAN_API_KEY のような暗号化対象キーが保存される
  When repo.set(StorageKeys.OBSIDIAN_API_KEY, "secret") が呼び出される
  Then 内部で encryptionSession による暗号化が行われ、chrome.storage には暗号化された値が保存される
  And repo.get() 呼び出し時には自動で復号された値が返る

Scenario: 変更購読が可能になる
  Given dashboard と popup が SettingsRepository を共有する
  When repo.set() で設定が変更される
  Then repo.onChange() で登録されたコールバックが呼び出され、UI が自動で更新される
  And chrome.storage.onChanged への直接依存が呼び出し元から消える

Scenario: テストで InMemory adapter が使える
  Given テスト環境で InMemoryStorage が注入された SettingsRepository がある
  When repo.set() / repo.get() が呼び出される
  Then chrome.storage をモックせず、InMemory データから結果が返る
```

## 受け入れ基準
- [ ] `SettingsRepository` モジュールが `src/utils/storage/SettingsRepository.ts`（または `src/utils/settingsRepository.ts`）に作成される。公開 interface は `get<K>(key)`, `set<K>(key, value)`, `getAll() => Settings`, `onChange(cb)` のみ。
- [ ] `StorageKeys` 定数とデフォルト値が `SettingsRepository` 内部に集約される。呼び出し元がデフォルト値を個別に持つことがなくなる。
- [ ] 暗号化対象キー（`OBSIDIAN_API_KEY` 等）の暗号化/復号が `SettingsRepository` 内部で透過的に行われる。`encryptionSession.ts` の呼び出しが repository 内部に隠蔽される。
- [ ] マイグレーション（`storageMaintenance.ts` / `settingsMigration.ts`）の呼び出しが `SettingsRepository` 内部に集約される。呼び出し元がマイグレーションを意識する必要がなくなる。
- [ ] 既存の30+箇所の `chrome.storage.local.get/set` 直接呼び出しが `SettingsRepository` のメソッドに移行する。代表的な移行先: `generalSettingsPanel.ts`, `settingsFormBinding.ts`, `settingsPipeline.ts`, `obsidianClient.ts`, `contentExtractor` 等。
- [ ] `chrome.storage.local` への直接アクセスが `SettingsRepository` 以外に存在しないことがテストまたは lint ルールで保証される（`no-restricted-import` または grep テスト）。
- [ ] `data-storage-key` 属性（PBI 05 Settings Schema）との整合性が保たれる — Schema のキーが `StorageKeys` と一致することが型レベルで保証される。
- [ ] InMemory adapter（`Map<string, unknown>` ベース）がテスト用に提供され、`SettingsRepository` のテストが `chrome.storage` をモックせずに実行できる。

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- dashboard / popup の設定変更 → 保存 → 復元の一連フローが `SettingsRepository` 経由で正常に動作することを検証。

### 統合テスト
- `SettingsRepository` × InMemoryStorage で、全キー（30+）の get/set が型安全に動作することを検証。
- `SettingsRepository` × 暗号化対象キーで、暗号化/復号が透過的に行われることを検証。
- `SettingsRepository` × `onChange` で、変更購読が正しく動作することを検証。

### 単体テスト
- 本PBIでは repository 内部の単体テストを追加しない — 深いモジュールのテストは interface（`get/set/getAll/onChange`）でカバーする。境界値（未保存キー → デフォルト、暗号化キーの空文字）は interface テストで検証。

## 実装アプローチ
- **Outside-In**: まず `SettingsRepository` の E2E テスト（全キーの get/set）を RED にし、既存の `storage.ts` 実装を内部に移動して GREEN にする。
- **Red-Green-Refactor**: キーをグループごとに移行（obsidian 系 5キー → AI 系 6キー → general 系 10キー → 残り の順）し、都度 GREEN を確認。
- **リファクタリング**: GREEN になるたびに `chrome.storage.local.get` の重複を除去し、デフォルト値を1箇所に集約。

## 見積もり
3人日

## 技術的考慮事項
- 依存関係: `chrome.storage.local`（local-substitutable — InMemory Map で代替可能）、`encryptionSession.ts`（内部で使用）、`storageMaintenance.ts`（内部で使用）。新たな外部依存は追加しない。
- テスタビリティ: `SettingsRepository` は `StorageAdapter` interface（`get/set/onChanged`）を注入可能にする。テストでは InMemory adapter を注入。現状は1つの adapter（chrome.storage）のみなので、導入直後は seam が hypothetical だが、テスト用 InMemory adapter の追加で real になる（two adapters justify the seam）。
- 非機能要件: `chrome.storage.local` のクォータ制限（5MB）は `SettingsRepository` 内部で `checkQuota` として隠蔽する（`savedUrlRepository` のパターンを再利用）。
- ADR整合性: `ADR-2026-08-12 encryption-secret-storage-area-must-be-local` に準拠 — `ENCRYPTION_SECRET` は `chrome.storage.local` に保存することを維持。repository はこの決定を内部に隠蔽するが、再議論しない。
- 前波との関係: PBI 05（Settings Schema Binding）は DOM 側の `data-storage-key` typo を防ぐ。本PBIは storage 側の散在を解消する。両者は補完的だが、同時に2つの schema を導入すると source of truth が二重になるため、PBI 05 の shape 確定後に着手する。

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "chrome\.storage\.local\.get\|chrome\.storage\.local\.set" src/ --include="*.ts" | wc -l
grep -rn "StorageKeys\." src/ --include="*.ts" | head -20
grep -rn "data-storage-key" src/ --include="*.ts" | head -20
cat src/utils/storage/types.ts | head -80
```
- 既実装の可能性がある場合はここに明記し、調査してから実装に進むこと。`SettingsSchema`（PBI 05）は 2026-08-20 に導入されたが、storage 側の集約は未着手。

### 実装手順
1. `src/utils/storage/SettingsRepository.ts` を新規作成。`SettingsRepository` クラスを定義し、内部で `StorageAdapter` interface（`get/set/onChanged`）を持つ。デフォルトは `ChromeStorageAdapter`。
2. `src/utils/storage/types.ts` の `StorageKeys` とデフォルト値を `SettingsRepository` 内部に移動。`getSettings()` / `setSettings()` を repository の `getAll()` / `set()` に委譲する shim に縮小。
3. `encryptionSession.ts` の暗号化/復号を `SettingsRepository` 内部で透過的に呼び出す。`isEncryptedKey(key)` の判定を内部に隠蔽。
4. 呼び出し元を1グループずつ移行（obsidian → AI → general の順）。各グループ移行後にテストを GREEN にする。
5. `chrome.storage.local` への直接アクセスを禁止する ESLint ルールまたは grep テストを追加。
6. `SettingsSchema`（PBI 05）との整合性を型レベルで保証: `SettingsSchema[StorageKeys.X]` が `SettingsRepository` のキーと一致することを `tsc` で検証。

### 落とし穴
- `chrome.storage.local` と `chrome.storage.session` は別領域 — `SettingsRepository` は `local` のみを扱い、`session`（`recordingCache`, `confirmToken` 等）は対象外。混同しないこと。
- `getSettings()` は現在 `clearSettingsCache()` と組み合わせてキャッシュを無効化するパターンがある（`aiServiceFactory` 等）。`SettingsRepository` 移行時に `onChange` 購読で自動更新されるようにし、`clearSettingsCache()` の手動呼び出しを不要にすること。
- `data-storage-key` の値は `StorageKeys` の文字列値と一致するが、HTML 側の typo は PBI 05 の Schema で防ぐ。repository 側では `StorageKeys` の型安全性で防ぐ — 両者の二重管理にならないよう、`SettingsSchema` が `StorageKeys` を source of truth として参照する形にすること。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする（型安全 get/set + デフォルト + 暗号化 + onChange + InMemory adapter）
- [ ] テストカバレッジが基準を満たす（既存30+箇所の呼び出しが repository 経由でカバーされる）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（30+箇所の移行、旧 `getSettings` shim の縮小、lint ルール追加）
- [ ] ドキュメント更新済み

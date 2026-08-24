# PBI: StorageKeys に facade を追加し god-type の shallow module を深める

## ユーザーストーリー
開発者として、130 個の StorageKeys を flat な定数として公開するのをやめ、ドメイン別 typed accessor を追加したい。なぜなら `Settings = Partial<StorageKeyValues> & { [key:string]:unknown }` が型安全を放棄しており、各呼び出し元がフォールバックを手動で実装する必要があるから。

## 優先度
- 順位: 05 / 全候補数 7
- RICEスコア: 10.67（Reach=40 / Impact=1 / Confidence=80% / Effort=3人週）
- 根拠: 40+ call sites が対象。SettingsRepository shim（PBI-01）完了後に着手。大 effort のため incremental に実施。

## BDD受け入れシナリオ

Scenario: Obsidian 設定が facade 経由で取得できる
  Given `SettingsRepository.getAll()` が 130 キーを返す
  When `settings.getObsidianConfig()` facade を追加する
  Then 呼び出し元は `StorageKeys.OBSIDIAN_API_KEY` を直接参照する必要がない
  And 戻り値は `{ apiKey: string; protocol: string; port: number; dailyPath: string }` 型である

Scenario: フォールバックが facade 内に集中する
  Given 各 call site が `settings[StorageKeys.X] ?? DEFAULT_SETTINGS[...]` を手動で記述している
  When facade 内で `DEFAULT_SETTINGS` を適用する
  Then 呼び出し元はフォールバックを記述する必要がない
  And デフォルト値の欠落バグが facade で検出される

## 受け入れ基準
- [ ] `SettingsRepository` に `getObsidianConfig()` / `getPrivacyMode()` / `getAiProviderConfig()` 等の facade が追加されている
- [ ] `Settings` 型が新規コードで exact type に変更されている（`{ [key:string]:unknown }` を廃止）
- [ ] `StorageKeys` が internal に留まり、新規コードは facade 経由でアクセスする
- [ ] 既存の 40+ call sites が段階的に facade に移行されている
- [ ] `npm run test` が PASS する

## テスト戦略
- **統合**: facade が `DEFAULT_SETTINGS` を正しく適用することを検証
- **単体**: 各 facade のフォールバップロジックテスト
- **契約**: `Settings` 型が exact であることを型テストで検証

## 見積もり
3 ストーリーポイント（高 — 3 人週程度。incremental に実施）

## 技術的考慮事項
- **依存**: PBI-01（SettingsRepository shim 廃止）に依存
- **テスタビリティ**: facade は pure function なので、テストは `InMemoryStorageAdapter` で容易
- **非機能要件**: 型安全性向上。デフォルト値の欠落バグ防止。

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "StorageKeys\." src/ --include="*.ts" | wc -l
grep -rn "DEFAULT_SETTINGS\[" src/ --include="*.ts" | wc -l
```

### 実装手順
1. `SettingsRepository` に `getObsidianConfig()` を追加（最初の facade）
2. `obsidianClient.ts` 等の主要 call site を facade に移行
3. `Settings` 型を新規コードで exact に変更
4. 残りの facade を incremental に追加
5. `no-restricted-imports` で `StorageKeys` の新規利用を禁止（内部除く）

### 落とし穴
- 130 キーを一度に split しない。 facade 1 つずつ追加し、安定してから次に進む。
- `CLEANSING_RULE_DEFAULTS` のパターン（`CLEANSING_RULES.map` から導出）を他のドメインでも活用する。

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了
- [ ] ドキュメント更新済み

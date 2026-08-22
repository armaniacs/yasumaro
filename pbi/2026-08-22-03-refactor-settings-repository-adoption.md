# PBI: SettingsRepository の採用 — パネルの生キャスト読み取りを型付き seam へ移行

## ユーザーストーリー
開発者として、ダッシュボードパネルの設定読み取りを `SettingsRepository`（既存 deep module）経由に移行したい、なぜなら `(settings[StorageKeys.X] as string) || 'default'` のキャストとインラインデフォルトが呼び出し箇所ごとに複製され、deep module が存在するのに friction が残り続けているから

## 優先度
- 順位: 3 / 4（pass 2）
- RICEスコア: 120（Reach=300 / Impact=1 / Confidence=80% / Effort=2人週）
- 根拠: 設定を読む全パネルに影響。Impact 1（振る舞い変化なし・型安全化・defaults の局在化）。Confidence 80%（`getMany` 追加が必要な可能性あり）。Effort 2週。PBI 02（diagnosticsPanel 深掘り）完了後に着手すると最大キャスト群（20件）が既に collector 側へ移動しており作業量が減る。pass 1 PBI 04（barrel import 経路）とは対象が異なる（本 PBI は「どのモジュールを呼ぶか」の変更）

## BDD受け入れシナリオ

```gherkin
Scenario: getMany で複数キーを型付き取得できる
  Given SettingsRepository.getMany(keys) が追加されている
  When パネルが getMany(['obsidian_protocol', 'obsidian_port', 'obsidian_api_key']) を呼ぶ
  Then 戻り値の各フィールドが SettingsType 由来の正確な型を持ち、デフォルト値が schema 側で適用される

Scenario: パネルから生キャストが消える
  Given 対象パネルが SettingsRepository 経由で読むように移行済みである
  When 対象ファイルで "as string" / "as number" / "as boolean" の settings キャストを grep する
  Then ヒット0件であり、インラインフォールバックデフォルトも存在しない

Scenario: InMemory adapter でテストできる
  Given InMemoryStorageAdapter に seed された settings がある
  When パネルの view model 構築関数が repository 経由で読む
  Then chrome.storage モックなしでテストが完結する

Scenario: エラー — storage 失敗時は現行と同一の挙動
  Given chrome.storage.local.get が例外を投げる
  When getMany が失敗する
  Then 呼び出し側の catch が現行の getSettings 失敗時と同じエラー処理を行う（新たなエラー分岐を導入しない）
```

## 受け入れ基準
- [ ] `SettingsRepository` に `getMany<K extends StorageKey>(keys: K[]): Promise<Pick<SettingsType, K>>` が追加され、単体テスト（InMemory adapter 越し）がある
- [ ] diagnosticsPanel（PBI 02 完了後は DiagnosticsCollector）、generalSettingsPanel/settingsForm、connectionTests、statusChecker 相当の主要な読み取り箇所が repository 経由に移行されている
- [ ] 移行済みファイルでの settings 関連キャスト（`as string|number|boolean` + StorageKeys インデックス）が0件
- [ ] デフォルト値の重複が解消され、schema/defaults は `storage/types.ts` または settingsStore 側の一元ソースのみを参照する
- [ ] `npm run type-check` / `npm test` がパスし、既存 settingsStore 系テストが無傷

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 一般設定で保存 → ダッシュボード再読込 → 診断パネル・一般設定パネルの表示が保存値を反映するシナリオ

### 統合テスト
- getMany + ChromeStorageAdapter（モック）で複合キー取得・デフォルト適用・暗号化キーフィールドの扱い（API_KEY_FIELDS はマスク継続）の統合テスト
- 移行済みパネルの view model 構築関数 × InMemory adapter

### 単体テスト
- getMany の境界（空配列 / 重複キー / 存在しないキー）
- defaults 適用の優先順位（seeded 値 > schema default）

## 見積もり
3pt（要チームでの見積もり）— getMany 追加は小さいが、パネル横断の移行とキャスト撤去のレビューが主コスト
- **注意**: 本 PBI は PBI 2026-08-22-02（diagnosticsPanel 深掘り）完了後推奨
  - PBI 02 完了でディ agnosticsPanel の 20キャストが既に collector 側に移動
  - 本 PBI では collector 内 1箇所の置換のみで済む

## 技術的考慮事項
- 依存関係: PBI 02 完了後推奨（diagnosticsPanel の20キャストが collector 側に移動済みとなり、本 PBI では collector 内1箇所だけの置換でよくなる）。pass 1 PBI 04（barrel 経路）とは独立だが同一ファイル群を触るため競合注意 — 本 PBI を先にし、import 経路は PBI 04 で機械的に一括置換するのが競合最小
- テスタビリティ: InMemoryStorageAdapter が既存（`src/utils/storage/SettingsRepository.ts`）。getMany も同 adapter 越しにテスト
- 非機能要件: 設定の永続化形式・マイグレーション・暗号化挙動は不変。読み取り経路の変更のみ

## 実装者向け注記

### 現状コードの確認
```bash
# deep module の現形状
grep -n "async \|export class\|export interface" src/utils/storage/SettingsRepository.ts | head
# 生キャスト読み取りの分布（移行対象の洗い出し）
grep -rn "(settings\[StorageKeys\..*\] as " src/dashboard/ src/popup/ --include="*.ts" | grep -v "__tests__" | wc -l
grep -rln "(settings\[StorageKeys\..*\] as " src/dashboard/ --include="*.ts" | grep -v "__tests__"
```

### 実装手順
1. `getMany` を SettingsRepository に追加し、InMemory adapter 越しの単体テストを RED→GREEN
2. PBI 02 済みの DiagnosticsCollector 内の読み取りを getMany に置換（1ファイルで効果検証）
3. generalSettings/settingsForm.ts、connectionTests.ts、statusView など dashboard 側を読み取り箇所の多い順に移行
4. 各移行でキャストとインラインデフォルトを削除し、`npm run type-check` を実行
5. popup 側（statusChecker 等）も同様に移行（時間があれば同 PR、なければ後続）
6. `npm run validate`

### 落とし穴
- `getSettings()` にはキャッシュ（30秒 TTL）があり、getMany で per-key 取得に変えるとキャッシュヒット特性が変わる。getMany は内部で getSettings() を1回呼ぶ形（全量取得→Pick）にすれば現行キャッシュをそのまま活かせる
- API_KEY_FIELDS（暗号化対象フィールド）は getSettings 経由では復号済みで返る。getMany も同一経路を使う限り挙動は不変だが、独自に storage を読まないこと
- connectionTests はフォーム未保存値（input 要素の現在値）と保存済み settings を混在させる。repository 移行は「保存済み値」側のみに限定し、フォーム値の読み取りは DOM のままにすること

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（getMany の境界値）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（移行済みファイルのキャスト0件）
- [ ] ドキュメント更新済み（DESIGN_SPECIFICATIONS.md の settings アクセス指針に getMany を追記）

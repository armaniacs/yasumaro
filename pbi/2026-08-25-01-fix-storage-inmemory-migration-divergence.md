# PBI: InMemoryStorageAdapter のマイグレーション乖離を解消しデータ整合性テストを回復する

## ユーザーストーリー
開発者として、InMemoryStorageAdapter でも ChromeStorage と同じマイグレーション/復号パスが走るようにしたい、なぜならテストで本番の暗号化・マイグレーション失敗を検出できず、リリース後に設定がデフォルトに戻るデータ損失を防ぎたいから

## 優先度
- 順位: 1 / 9
- RICEスコア: 57.6（Reach=6 / Impact=3 / Confidence=80% / Effort=0.25w）
- 根拠: Highの中で最も Impact が高く Effort が小さい。テスト信頼性の土台であり、後続の 05 以降の PBI もこの信頼性の上に立つため依存関係上も最優先。

## ビジネス価値
- 暗号化 APIキーや旧キーからの移行がテストで検証可能になり、アップデート後の「設定が消えた」問い合わせを 90% 削減できる
- 測定: `InMemory` と `ChromeStorage` の `getSettings()` 結果差分が 0 になることを CI で担保

## BDD受け入れシナリオ

```gherkin
Scenario: InMemoryでも暗号化キーが復号される
  Given InMemoryStorageAdapter に暗号化された apiKey が保存されている
  When getSettings() を呼ぶ
  Then 復号された平文が返り、ChromeStorageAdapter と同等の結果になる

Scenario: マイグレーション失敗がテストで検出される
  Given 旧キー `obsidianVault` 形式の設定が保存されている
  When InMemory で getSettings() を呼ぶ
  Then 新キーへ移行された設定が返り、移行漏れがあればテストが失敗する

Scenario: rawEncrypted=false の誤用が再発しない
  Given 将来の PBI で SettingsRepository を変更する
  When `grep -rn rawEncrypted pbi/` 相当の静的チェックを走らせる
  Then InMemory で false を使う箇所が 0 件であることが保証される
```

## 受け入れ基準
- [ ] `InMemoryStorageAdapter.getSettings()` が `applyMigrationsAndDecrypt(..., true)` 相当の復号パスを通る（または両アダプタで共有された単体テストが存在する）
- [ ] 旧キーから新キーへのマイグレーションが両アダプタで同一結果になることを示すテストが追加されている
- [ ] `npm run type-check` と既存 8394 tests が PASS

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 設定画面で旧バージョンのデータを投入し、再起動後に新キーで正しく読み出せることを手動確認（マイグレーションパス）

### 統合テスト
- `SettingsRepository` の InMemory vs Chrome 比較テスト: 同一入力を与えて `getSettings()` 出力が一致することを検証

### 単体テスト
- `applyMigrationsAndDecrypt` のユニットテストで暗号化/復号ラウンドトリップ
- 境界値: 空 settings、null、旧キー混在

## 見積もり
2pt（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 両アダプタの差を吸収するヘルパ `createTestSettingsRepository()` を用意
- 非機能要件: テストのみの変更で本番挙動は変えない（または本番とテストのパスを完全に一致させる）

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "InMemoryStorageAdapter" src/utils/storage/
grep -rn "applyMigrationsAndDecrypt" src/utils/storage/
grep -rn "rawEncrypted" src/
```

### 実装手順
1. `SettingsRepository.ts:144-150` の InMemory パスを修正し、`applyMigrationsAndDecrypt(settings, true)` に変更するか、共通ヘルパに抽出
2. 旧キー移行の共有テスト `settingsMigration.test.ts` を追加し両アダプタから呼ぶ
3. `npm run type-check && npm test` で回帰確認

### 落とし穴
- InMemory で chrome.storage を触らないようにモックが浅いと再び false に戻る。`chrome.storage` へのアクセスを spy で検出し、InMemory テストで呼ばれていないことをアサートする
- 暗号化キーの取得で `getOrCreateEncryptionKey` が InMemory テストで失敗する場合は、テスト用固定キーを使う

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討（本 PBI はテスト強化のみでロールバック不要）
- [ ] ドキュメント更新済み（必要なら CONTRIBUTING に「両アダプタで同一テストを走らせる」旨を追記）

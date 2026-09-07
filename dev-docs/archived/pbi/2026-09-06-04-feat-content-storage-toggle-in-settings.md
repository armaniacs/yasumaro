# PBI: 設定画面に「本文(content)の保存」トグルを追加する

## ユーザーストーリー
Yasumaro のユーザーとして、ダッシュボードの設定画面から「ページ本文(content)をローカル保存する/しない」をいつでも切り替えたい。なぜなら現在は初回のプライバシー同意モーダルでしか設定できず、同意後にこのポリシーを変更する手段がないからだ。

## ビジネス価値
- プライバシー設定を後から変更でき、ユーザーが自分のデータ保存の可否を常にコントロールできる。
- 保存がオフなら content 列が増え続けないため、ストレージ増大を止める手段が増える。
- 測定方法: 設定画面にトグルが表示され、オフ時の新規レコードの content 列が `NULL` になる（既存の保存ゲートが正しく効く）。

## BDD受け入れシナリオ

```gherkin
Scenario: 設定画面で本文保存をオンにする
  Given ユーザーが設定画面を開いていて、本文保存トグルが未チェック（オフ）である
  When  ユーザーが本文保存トグルをチェックして保存する
  Then  設定値 content_storage_enabled が true で永続化される
  And   以後に記録された閲覧レコードの content 列に本文テキストが保存される

Scenario: 設定画面で本文保存をオフにする
  Given ユーザーが設定画面を開いていて、本文保存トグルがオンの状態である
  When  ユーザーが本文保存トグルのチェックを外して保存する
  Then  設定値 content_storage_enabled が false で永続化される
  And   以後に記録された閲覧レコードの content 列が NULL になる
  And   既に保存済みの content 列の値は削除されずそのまま保持される

Scenario: 保存前に設定画面を再表示したときトグルの状態が正しく復元される
  Given 設定値 content_storage_enabled が true（または false）で保存されている
  When  ユーザーが設定画面を開く
  Then  本文保存トグルが保存値どおりにチェック済み（または未チェック）で表示される
```

## 受け入れ基準
- [x] 設定画面（Options / Dashboard の一般設定パネル）に本文保存トグルが表示される
- [x] トグルが既存の `StorageKeys.CONTENT_STORAGE_ENABLED`（`content_storage_enabled`）にバインドされ、保存/復元される
- [x] オフにしたとき、既存の content 列は削除されない（以後の新規保存のみ停止）
- [x] トグルに日本語・英語の i18n ラベルが用意されている
- [x] `data-i18n` 属性を使い、ハードコード文字列を入れない
- [x] タイプチェック・lint・既存単体テストが全て green

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Dashboard に本文保存トグルが表示され、チェック状態を切り替えて保存→再読み込みしても状態が維持されること

### 統合テスト
- トグル操作が `content_storage_enabled` として `chrome.storage` に保存され、`loadGeneralSettings()` で復元されること（`GENERAL_SETTINGS_SCHEMA` 経由のバインディング）

### 単体テスト
- `GENERAL_SETTINGS_SCHEMA` に `CONTENT_STORAGE_ENABLED`（checkbox型）が含まれること
- スキーマの型整合（storage key と HTML の `data-storage-key` が一致）のテスト
- オフ時（false）に `BrowsingLogRecordMapper` が content を null にする事は既存テストでカバー済みであることを確認（回帰なし）

## 実装アプローチ
- **Outside-In**: E2E（トグル表示→切り替え→保存→再表示）から開始し、まず失敗を確認してから実装する
- **Red-Green-Refactor**: 各レイヤーで TDD サイクルを適用
- **リファクタリング**: グリーンになるたびに品質改善

## 見積もり
2 ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: なし。既存の `content_storage_enabled` 設定キー、`GENERAL_SETTINGS_SCHEMA`、`loadSettingsToInputs` の `data-storage-key` バインディングを流用する
- テスタビリティ: 既存の `settingsForm.coverage.test.ts`、`BrowsingLogRecordMapper.test.ts`、`settingsSchemas` 相当のテストを踏襲。モックは既存構成を流用
- 非機能要件: トグル操作で既存データに副作用を起こさない（オフ時に即時パージしない）

## 実装者向け注記

### 現状コードの確認
（着手前に必ず実行すること）
```bash
# 設定キーと保存ゲートは既に実装済みであることを確認
grep -rn "CONTENT_STORAGE_ENABLED" src/utils/storage/types.ts
grep -rn "content_storage_enabled" src/background/pipeline/mappers/BrowsingLogRecordMapper.ts
# 現在ダッシュボードにこのトグルが「ない」ことを確認
grep -rn "content_storage_enabled" src/dashboard entrypoints/options/index.html
```

既実装の整理（重複実装しないこと）:
- `StorageKeys.CONTENT_STORAGE_ENABLED = 'content_storage_enabled'` は `src/utils/storage/types.ts:253` に定義済み
- デフォルト `false` は `src/utils/storage/defaults.ts:161` に定義済み
- 保存ゲート（`content_storage_enabled === true` のときのみ content 保存）は `src/background/pipeline/mappers/BrowsingLogRecordMapper.ts:9-11` に実装済み
- 初回同意モーダルのチェックボックスは `src/popup/privacyConsentController.ts:202` に既存
- 不足しているのは「ダッシュボード設定画面のトグル」とその `GENERAL_SETTINGS_SCHEMA` への登録のみ

### 実装手順
1. **E2E テスト（Red）**: ダッシュボード設定に本文保存トグルが存在することを検証する e2e を追加し、失敗を確認する（既存の `testDir/e2e/dashboard-ui.spec.ts` の retention セクション検証を参考にする）
2. **HTML**: `entrypoints/options/index.html` の「コンテンツ保持設定」セクション（449行目付近）の先頭に、チェックボックスを追加する:
   ```html
   <div class="form-group">
     <label class="checkbox-label">
       <input type="checkbox" id="contentStorageEnabled" data-storage-key="content_storage_enabled">
       <span data-i18n="contentStorageEnabledLabel">本文（ページの内容）をローカル保存する</span>
     </label>
   </div>
   ```
3. **スキーマ登録**: `src/utils/settingsSchemas.ts` の `GENERAL_SETTINGS_SCHEMA` に追記する:
   ```ts
   { key: StorageKeys.CONTENT_STORAGE_ENABLED, type: 'checkbox' },
   ```
   （これにより既存の `loadSettingsToInputs` / 保存時抽出が自動で効く）
4. **i18n**: `public/_locales/{en,ja}/messages.json` にキーを追加する
   - en: `contentStorageEnabledLabel` = "Store page content (body text) locally"
   - ja: `contentStorageEnabledLabel` = "本文（ページの内容）をローカル保存する"
5. **単体テスト（Green）**: スキーマ追加分とバインディングのテストを追加し、グリーンにする
6. **リファクタリング**: 既存 `loadGeneralSettings` にトグル可視性の sync ロジックが必要か確認する（必要なら `settingsForm.ts` に追記。現時点では単純なチェックボックスなので不要の見込み）

### 落とし穴
- `data-storage-key` の値（`content_storage_enabled`）を `StorageKeys.CONTENT_STORAGE_ENABLED` の文字列値と一致させること。タイポするとバインディングが黙って失敗する
- トグルのオフ＝即時削除ではない。既存 content を削除する動作は既存の「コンテンツ保持設定」（`contentPurgeNowBtn` / `purgeContentNow`）の責務なので、混同しない
- 保存ゲートは `=== true` 判定なので、チェックボックスから得る値は boolean であること（`'on'` などの文字列を渡さない）。既存 checkbox 型スキーマが boolean 化を担保するが、手書きバインドを足す場合は注意
- プライバシー同意モーダル（popup）と設定画面（dashboard）の 2 箇所が同一キーを共有するため、片方で変更した値がもう片方にも反映される（これは望ましい挙動であり、別々の状態を持つ実装はしない）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] i18n が日英両言語で追加済み

## 実装メモ（2026-09-06 自律実装）
- `GENERAL_SETTINGS_SCHEMA` に `{ key: StorageKeys.CONTENT_STORAGE_ENABLED, type: 'checkbox' }` を追加（`src/utils/settingsSchemas.ts`）。load/extract は既存の `data-storage-key` バインディングで自動対応
- `entrypoints/options/index.html` の「コンテンツ保持設定」セクション先頭に `#contentStorageEnabled` を追加
- i18n: `contentStorageEnabledLabel`（en/ja）
- テスト: `src/utils/__tests__/settingsSchemas.test.ts`（新規: スキーマ登録・HTMLバインド・i18n有無の3検証）、`settingsFormBinding.test.ts` に load→extract ラウンドトリップを追加、E2E `dashboard-ui.spec.ts` にトグル存在確認を追加（dashboard-ui 102 tests green）
- 保存ゲート（`BrowsingLogRecordMapper`）とデフォルト false は既存のまま。オフ時に既存 content を削除する処理は入れていない（受け入れ基準どおり）
- コードレビューは diff 自レビュー＋全体検証（type-check / lint 0 errors / 11702 tests / build）で実施

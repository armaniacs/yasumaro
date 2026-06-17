# PBI-17: ダッシュボード初期設定に Obsidian 利用有無のチェックボックスを追加

## ユーザーストーリー

Yasumaro の新規ユーザーとして、ダッシュボードの初期設定画面で「Obsidian を使う / 使わない 」を明示的に選べるようにしたい。なぜなら、Obsidian 連携はオプション機能であり、AI 要約とブラウジング履歴記録だけを使いたい場合にも、UI が Obsidian 未設定の状態で誤解を招かずにスムーズにセットアップできるべきだから。

## ビジネス価値

- **オンボーディング改善**: AI 専用ユーザーが不要な Obsidian 欄に惑わされることが減る
- **機能の独立性を UI で明示**: Obsidian 連携がオプションであることをユーザーに直感的に伝える
- **後方互換性の担保**: 既存の Obsidian 設定済みユーザーはアップグレード後も連携が継続する
- **PBI-16 の UX 補完**: Obsidian 未設定時の動作が安定した後、ユーザーがその動作を制御できる UI を提供する

## 調査結果（フェーズ0）

### 既存コードの確認

```bash
# 既存の obsidian_enabled 類似設定の有無を確認
grep -rn "obsidian.*enabled\|use_obsidian\|OBSIDIAN_ENABLED" src/ public/ entrypoints/
```

- 現時点では `obsidian_enabled` 相当の設定キーは存在しない
- Obsidian 接続セクションは `entrypoints/options/index.html` の `#panel-general` 内に配置されている
- 設定の読み書きは `src/utils/storage.ts` / `src/utils/storageSettings.ts` / `src/utils/storage/types.ts` で管理されている
- 録画パイプラインの Obsidian 保存ステップは `src/background/pipeline/steps/saveToObsidianStep.ts` で実装されている
- PBI-16 で追加された Obsidian 未設定時のスキップロジックは、API キーの有無で判定している

### 未実装の確認

- チェックボックス UI: 未実装
- `obsidian_enabled` ストレージキー: 未実装
- 既存ユーザー向けマイグレーション: 未実装

## 設計方針（深掘りセッションでの決定事項）

| 項目 | 決定 | 理由 |
|------|------|------|
| デフォルト値 | 新規インストール時は **OFF** | AI 専用ユーザーのオンボーディングを最優先 |
| 既存ユーザーの初期値 | `obsidian_api_key` が有効なら ON、なければ OFF | 実際の利用状況に即した遷移 |
| UI 表示 | OFF 時は Obsidian 欄を **折りたたみ** | シンプルさと後から発見しやすさのバランス |
| バックエンド判定 | **フラグ優先**（OFF なら必ずスキップ） | ユーザーの明示的な意図を尊重 |
| PBI-16 との関係 | **独立した新規 PBI** | PBI-16 は基盤挙動の修正、本 PBI は UX 機能の追加 |

## BDD 受け入れシナリオ

```gherkin
Scenario: 新規インストール時に Obsidian 利用を OFF にして AI 専用でセットアップする
  Given ユーザーが初めて Yasumaro をインストールした
  And   ダッシュボードの初期設定ページを開いている
  Then  「Obsidian を使う」チェックボックスは OFF になっている
  And   Obsidian 接続セクションは折りたたまれている
  When  ユーザーが AI プロバイダー設定のみ入力する
  And   「AI テスト」ボタンをクリックする
  Then  AI 接続テストが成功する
  And   Obsidian の設定を入力する必要がない

Scenario: 既存の Obsidian 設定済みユーザーがアップグレードした場合
  Given ユーザーが過去のバージョンで Obsidian API Key を設定していた
  When  拡張機能をアップグレードしてダッシュボードを開く
  Then  「Obsidian を使う」チェックボックスは ON になっている
  And   Obsidian 接続セクションは展開されている
  And   既存の API Key、Protocol、Port、Daily Note Path が保持されている

Scenario: ユーザーが Obsidian 利用を OFF にすると録画時に Obsidian 保存がスキップされる
  Given ユーザーが AI プロバイダーを有効に設定している
  And   「Obsidian を使う」が OFF になっている
  When  ユーザーが Web ページを閲覧して記録条件を満たす
  Then  AI 要約が生成される
  And   SQLite に記録が保存される
  And   Obsidian への保存がスキップされる
  And   エラーが発生しない

Scenario: ユーザーが Obsidian 利用を ON にする
  Given ユーザーがダッシュボードの初期設定ページを開いている
  And   「Obsidian を使う」が OFF になっている
  When  チェックボックスを ON にする
  Then  Obsidian 接続セクションが展開される
  And   Obsidian API Key 入力欄が有効になる
  When  ユーザーが有効な API Key を入力して保存する
  Then  録画時に Obsidian への保存が実行される

Scenario: Obsidian を使うが API Key が未入力の状態で録画が実行される
  Given 「Obsidian を使う」が ON になっている
  And   Obsidian API Key が空である
  When  録画パイプラインが実行される
  Then  Obsidian 保存ステップはスキップされる
  And   SQLite 保存ステップは実行される
  And   パイプラインは成功で完了する
```

## 受け入れ基準

- [ ] 新規インストール時に「Obsidian を使う」チェックボックスが OFF で初期化される
- [ ] 既存ユーザーアップグレード時に、API Key が有効なら ON、無効なら OFF に初期化される
- [ ] チェックボックス ON で Obsidian 接続セクションが展開され、OFF で折りたたまれる
- [ ] OFF 時に Obsidian 保存ステップがスキップされ、パイプラインが停止しない
- [ ] ON かつ API Key 有効時に Obsidian 保存が実行される
- [ ] 既存の Obsidian 設定済みユーザーの動作が変更されない（後方互換性）
- [ ] 全 BDD シナリオが自動テストとして実装されパスする

## テスト戦略（t_wada スタイル）

### E2E テスト（1件）
- ダッシュボードで「Obsidian を使う」チェックボックスの ON/OFF 切り替えと、Obsidian 欄の表示/非表示が連動すること

### 統合テスト（3件）
- `getSettings()` が `obsidian_enabled` の初期値を正しく決定すること（新規=OFF、既存 API Key あり=ON）
- `saveToObsidianStep` が `obsidian_enabled === false` のときにスキップすること
- `RecordingPipeline` が OFF 時に SQLite 保存まで到達すること

### 単体テスト（5件）
- ダッシュボードのチェックボックス変更イベントで `obsidian_enabled` が保存されること
- OFF 時に Obsidian セクションが折りたたまれる CSS/aria 制御
- ON 時に Obsidian セクションが展開される CSS/aria 制御
- `StorageKeys.OBSIDIAN_ENABLED` のデフォルト値が `false` であること
- マイグレーションロジックが API Key の有無で正しく分岐すること

## 実装アプローチ

### Step 1: ストレージキーとデフォルト値の追加

`src/utils/storage/types.ts` に追加:

```typescript
OBSIDIAN_ENABLED: 'obsidian_enabled', // true | false
```

`src/utils/storage/defaults.ts` に追加:

```typescript
[StorageKeys.OBSIDIAN_ENABLED]: false,
```

### Step 2: 既存ユーザー向け初期値判定

`src/utils/storage.ts` の `getSettings()` 内、デフォルトマージ後に以下を追加:

```typescript
// obsidian_enabled が未設定の場合、obsidian_api_key の有無で初期化
if (merged[StorageKeys.OBSIDIAN_ENABLED] === undefined) {
    const apiKey = merged[StorageKeys.OBSIDIAN_API_KEY] as string | undefined;
    merged[StorageKeys.OBSIDIAN_ENABLED] = !!(apiKey && apiKey.length >= 16);
}
```

### Step 3: ダッシュボード UI 変更

`entrypoints/options/index.html` の Obsidian 接続セクションを以下のように変更:

```html
<!-- Obsidian 接続セクション -->
<div class="settings-section">
  <h3 class="settings-section-title" data-i18n="obsidianSection">Obsidian 接続</h3>

  <div class="form-group checkbox-group">
    <input type="checkbox" id="obsidianEnabled" aria-describedby="obsidianEnabledHelp">
    <label for="obsidianEnabled" class="inline-label" data-i18n="obsidianEnabledLabel">Obsidian を使う</label>
    <div id="obsidianEnabledHelp" class="help-text" data-i18n="obsidianEnabledHelp">
      OFF の場合、記録は SQLite のみに保存されます。
    </div>
  </div>

  <details id="obsidianSettingsDetails" class="advanced-details">
    <summary class="advanced-details-summary" data-i18n="obsidianSettingsSummary">Obsidian 接続設定</summary>
    <div class="advanced-details-content">
      <div class="form-group">
        <label for="apiKey" data-i18n="obsidianApiKey">Obsidian API Key</label>
        <input type="password" id="apiKey" data-i18n-input-placeholder="apiKeyPlaceholder">
      </div>
      <!-- protocol, port, dailyPath は既存の details 内を維持 -->
    </div>
  </details>
</div>
```

### Step 4: ダッシュボードロジック変更

`src/dashboard/dashboard.ts` に以下を追加:

- `obsidianEnabledInput` を `getDashboardElements()` と `getSettingsMapping()` に追加
- チェックボックス変更時に `obsidianSettingsDetails.open = checked` を制御
- 保存時に `obsidian_enabled` を `extractSettingsFromInputs()` で取得

```typescript
el.obsidianEnabledInput?.addEventListener('change', () => {
  const details = document.getElementById('obsidianSettingsDetails') as HTMLDetailsElement | null;
  if (details) {
    details.open = el.obsidianEnabledInput?.checked ?? false;
  }
});
```

### Step 5: バックエンドロジック変更

`src/background/pipeline/steps/saveToObsidianStep.ts` を修正:

```typescript
// ユーザーが Obsidian 使用を明示的に OFF にしている場合はスキップ
const obsidianEnabled = context.settings[StorageKeys.OBSIDIAN_ENABLED];
if (obsidianEnabled === false) {
    addLog(LogType.INFO, 'Obsidian disabled by user, skipping save', { url });
    return context;
}
```

### Step 6: i18n メッセージ追加

`public/_locales/ja/messages.json` と `public/_locales/en/messages.json` に追加:

```json
{
  "obsidianEnabledLabel": {
    "message": "Obsidian を使う"
  },
  "obsidianEnabledHelp": {
    "message": "OFF の場合、記録は SQLite のみに保存されます。"
  },
  "obsidianSettingsSummary": {
    "message": "Obsidian 接続設定"
  }
}
```

（英語版も同様）

## 見積もり

**5 SP**（UI 変更 + バックエンド判定 + マイグレーション + テスト）

## 技術的考慮事項

- **依存関係**: PBI-16 の完了を推奨（本 PBI は PBI-16 の挙動を UI から制御するため）
- **後方互換性**: 既存ユーザーは API Key 有無で自動判定されるため、既存動作が維持される
- **テスタビリティ**: `chrome.storage.local.get` / `set` はモック可能
- **パフォーマンス**: 判定ロジックは軽量（真偽値チェック）
- **アクセシビリティ**: チェックボックスと折りたたみの連動に `aria-expanded` / `aria-controls` を適切に設定

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rn "obsidian_enabled\|OBSIDIAN_ENABLED" src/ public/ entrypoints/
grep -rn "saveToObsidianStep" src/background/pipeline/
grep -rn "getDashboardElements\|getSettingsMapping" src/dashboard/dashboard.ts
```

### 落とし穴

- `extractSettingsFromInputs()` は checkbox の checked 属性を正しく取得するよう実装されているか確認すること
- `details` 要素の `open` プロパティを直接書き換えると、アコーディオンアニメーションがない場合がある
- 既存の `saveToObsidianStep` の API Key 長チェック（16文字未満でスキップ）と `obsidian_enabled` フラグは両方維持すること
- マイグレーション判定は `obsidian_enabled === undefined` のときのみ実行し、明示的なユーザー設定を上書きしないこと

### 実装順序

1. `StorageKeys.OBSIDIAN_ENABLED` の追加
2. `DEFAULT_SETTINGS` への追加
3. `getSettings()` 内の既存ユーザー初期値判定追加
4. `entrypoints/options/index.html` の UI 変更
5. `src/dashboard/dashboard.ts` のイベントリスナーとマッピング追加
6. `saveToObsidianStep.ts` のフラグ判定追加
7. i18n メッセージ追加
8. テスト追加
9. `npm run type-check && npm test` で検証

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み（該当する場合）
- [x] i18n 日本語/英語両方に対応
- [ ] 既存の Obsidian 設定済みユーザーがアップグレード後も正常に動作することを手動確認

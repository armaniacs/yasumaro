# PBI: ダッシュボード診断パネルにブラウザ内蔵AI診断を追加

## ユーザーストーリー

拡張機能の利用者として、ダッシュボードの「診断」パネルでブラウザ内蔵AI（Chrome Gemini Nano / Edge Phi-mini）が現在使えるかどうかを確認したい、なぜならAIプロバイダーを選ぶ前に「無料・オフラインで動く内蔵AIが今のブラウザで使えるか」を判断材料にしたいから。

## ビジネス価値

- 内蔵AIはAPIキー不要・無料・オフライン動作という利点があるが、ブラウザ設定（フラグ有効化・モデルダウンロード）が必要で、ユーザーが自力で気づきにくい。診断パネルで可視化することで、AIプロバイダー設定変更前の判断コストを下げ、内蔵AI採用率の向上が期待できる。
- 測定方法: リリース後、AIプロバイダー設定で`built-in-ai`を選択するユーザーの割合を追跡（既存のプロバイダー優先度リストのテレメトリがあれば利用、なければ定性的なユーザーフィードバックで確認）。

## BDD受け入れシナリオ

```gherkin
Scenario: 内蔵AIが利用可能なブラウザで診断パネルを開く
  Given ユーザーがChromeでLanguageModel.availability()が"available"を返す環境で拡張機能を使っている
  When  ダッシュボードの「診断」パネルを開く
  Then  「ブラウザ内蔵AI」診断項目に「利用可能」と表示される
  And   AIプロバイダー設定で内蔵AIを選択しているかどうかに関わらず表示される

Scenario: モデル未ダウンロードでワンクリックダウンロードを開始する
  Given LanguageModel.availability()が"downloadable"を返す環境である
  When  診断パネルの「モデルをダウンロード」ボタンをクリックする
  Then  LanguageModel.create()が呼び出されモデルのダウンロードが開始される
  And   ダウンロード進捗（%）が診断パネルにリアルタイム表示される
  And   ダウンロード完了後は自動的に「利用可能」表示に切り替わる

Scenario: フラグ未有効化などで内蔵AIが利用できない
  Given LanguageModel.availability()が"unavailable"を返す、またはself.LanguageModelが存在しない環境である
  When  ダッシュボードの「診断」パネルを開く
  Then  「利用不可」と表示される
  And   現在のブラウザ（Chrome/Edge）向けのフラグ有効化案内（URLとフラグ名）が表示される
  And   ブラウザがChrome/Edge以外、または判別不能な場合は汎用の案内文言が表示される
```

## 受け入れ基準

- [ ] 診断パネルに「ブラウザ内蔵AI」セクションが追加され、`available`/`downloadable`/`downloading`/`unavailable`の4状態それぞれで適切な表示になる
- [ ] 表示はAIプロバイダー設定の選択状態に関わらず常時行われる
- [ ] `downloadable`時は「モデルをダウンロード」ボタンからワンクリックでダウンロードを開始できる
- [ ] ダウンロード中は進捗（%）がリアルタイムで更新表示される
- [ ] `unavailable`時は`browserSupport.ts`の`getBuiltInAIFlagGuidance()`を使ったフラグ案内（URL・フラグ名）を表示する
- [ ] 診断パネルの他項目（Obsidian接続・SQLite状態など）の表示・挙動に影響を与えない
- [ ] 表示文言はすべてi18n対応（data-i18n属性 or getMessage()経由）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Playwright: ダッシュボードの診断パネルを開き、内蔵AI診断セクションが表示されることを確認（`@interaction`プロジェクト、実ブラウザのLanguageModel挙動に依存するため`available`ケースは環境次第でスキップ可）

### 統合テスト
- `diagnosticsPanel.test.ts`: `loadAndPopulate()`が`BuiltInAIClient.getAvailability()`の4状態それぞれに対して正しいDOM表示を生成することを確認
- ダウンロードボタンクリック時に`LanguageModel.create()`が呼ばれ、`monitor`コールバック経由の進捗イベントがDOMに反映されることを確認（`LanguageModel`をモック）

### 単体テスト
- `builtInAIClient.test.ts`: 進捗コールバック（`monitor`）を受け取るダウンロード開始用メソッドの単体テスト（成功・失敗・進捗0%→100%の遷移）
- `browserSupport.test.ts`: 既存の`getBuiltInAIFlagGuidance()`のテストが引き続きパスすること（変更なしの場合は確認のみ）
- 境界値: `LanguageModel`が`undefined`（非対応ブラウザ）の場合に例外を投げずに`unavailable`として扱われること

## 実装アプローチ

- **Outside-In**: Playwright E2Eから開始し失敗を確認 → `diagnosticsPanel.test.ts`の統合テストを追加し失敗を確認 → `builtInAIClient.ts`のダウンロード開始メソッドを単体テストから実装
- **Red-Green-Refactor**: 各レイヤーでTDDサイクルを適用
- **リファクタリング**: グリーン後、`diagnosticsPanel.ts`内の他プロバイダー表示ロジックとの重複があれば`diagnosticUtils.ts`のヘルパーに集約

## 見積もり

3pt（既存の`BuiltInAIClient.getAvailability()`とフラグ案内ロジックは再利用できるが、ダウンロード進捗の`monitor`コールバック統合とUI追加は新規実装のため中規模）

## 技術的考慮事項

- 依存関係: なし（既存の`BuiltInAIClient`・`browserSupport.ts`を拡張する形）
- テスタビリティ: `globalThis.LanguageModel`をJestでモック可能（既存の`builtInAIClient.test.ts`で実績あり）。`monitor`コールバックの型は`LanguageModel.create({ monitor: (m) => m.addEventListener('downloadprogress', ...) })`の形状（Prompt API仕様）
- 非機能要件: ダウンロード進捗イベントの発火頻度が高い場合、DOM更新のスロットリングを検討（過度な再描画によるダッシュボードのカクつき防止）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること — 本PBI作成時に実施済み。以下は調査結果）

```bash
grep -rn "診断\|diagnos" src/ dashboard/ entrypoints/
grep -rn "builtInAI\|LanguageModel\|window.ai" src/ dashboard/ entrypoints/
```

**既存実装の要点:**
- `src/background/builtInAIClient.ts`の`BuiltInAIClient.getAvailability()`が`available`/`downloadable`/`downloading`/`unavailable`の4状態判定を既に実装済み。キャッシュ機構（`_availabilityCache`）あり、`downloading`時のみ再チェックする
- `buildUnavailableMessage()`（`builtInAIClient.ts`内、非公開関数）がフラグ案内文言を生成済み。`getBrowserName()`と`getBuiltInAIFlagGuidance()`（`src/utils/browserSupport.ts`）を使っている
- `src/dashboard/panels/diagnostic/diagnosticsPanel.ts`が診断パネル本体。`loadAndPopulate()`が各種診断情報を描画し、`mount()`内でボタンのイベントリスナーを登録するパターン
- 既存の「AI connection test」（`#diagTestAiBtn`）は`TEST_AI`メッセージ経由で`aiClient.testConnection()`を呼び、**ユーザーが設定したプロバイダー優先度リストのみ**をテストする。これは今回のスコープ外（触らない）
- `getAvailability()`・`buildUnavailableMessage()`は`BuiltInAIClient`のprivateメソッド/非公開関数ではなく通常のインスタンスメソッド/モジュール内関数。診断パネルから直接呼び出すには、Service Worker側で新規メッセージハンドラ（例: `TEST_BUILTIN_AI_AVAILABILITY`）を追加してダッシュボードから`chrome.runtime.sendMessage`で呼ぶ必要がある（`LanguageModel`はService Worker/ダッシュボードどちらのコンテキストでも呼べるが、既存実装がService Worker側にあるため一貫性重視でメッセージ経由を推奨）

**未実装（本PBIで新規追加が必要な部分）:**
- ダウンロード進捗（`downloadprogress`イベント）の監視・表示コードは存在しない（`grep -rn "downloadprogress"`で0件）
- 診断パネルへの単独表示項目（プロバイダー設定に関わらず常時表示）は存在しない

### 実装手順

1. `builtInAIClient.ts`に進捗コールバック付きのダウンロード開始メソッドを追加
   ```typescript
   async startDownload(onProgress: (percent: number) => void): Promise<BuiltInAIAvailability> {
       const languageModel = globalThis.LanguageModel;
       if (!languageModel) return 'unavailable';
       const session = await languageModel.create({
           monitor(m) {
               m.addEventListener('downloadprogress', (e) => {
                   onProgress(Math.round(e.loaded * 100));
               });
           },
       });
       session.destroy();
       this.resetAvailabilityCache();
       return this.getAvailability();
   }
   ```
   （`monitor`コールバックの型は`LanguageModelGlobal`インターフェースへの追加が必要）
2. Service Workerに`TEST_BUILTIN_AI_AVAILABILITY`等のメッセージハンドラを追加し、`getAvailability()`の結果とフラグ案内を返す
3. `diagnosticsPanel.ts`の`loadAndPopulate()`に内蔵AI診断セクションのDOM生成を追加（`makeStatRow`ヘルパー活用）
4. ダウンロードボタンのイベントリスナーを`mount()`に追加し、進捗イベントをService Worker→ダッシュボード間でメッセージ中継する仕組みを検討（`chrome.runtime.sendMessage`は単発なので、進捗のようなストリーミング更新には`chrome.runtime.connect`（Port）または短い間隔のポーリングを検討）

### 落とし穴

- `LanguageModel.create()`の`monitor`コールバックはPrompt API仕様のオプション引数。現在の`LanguageModelGlobal`インターフェース（`builtInAIClient.ts:42-45`）に`monitor`オプションが定義されていないため、型定義の拡張が必要
- ダウンロード進捗をダッシュボードにリアルタイム表示する場合、Service Worker側で`LanguageModel.create()`を実行しているなら`chrome.runtime.sendMessage`の単発応答では進捗を送れない。`chrome.runtime.connect`によるPort通信か、ダッシュボード（Optionsページ）側で直接`LanguageModel`を呼ぶ設計に変更するかを検討すること（Optionsページは拡張機能のトップレベルコンテキストなので`self.LanguageModel`に直接アクセス可能なはず — 実機検証が必要）
- `manifest.json`の`web_accessible_resources`更新は今回はモジュール分割を伴わないため不要（`CLAUDE.local.md`のルール参照）
- i18nキー追加時は`_locales/ja/messages.json`と`_locales/en/messages.json`（存在する場合は他言語も）を両方更新すること

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み（AGENTS.mdの「診断」関連記述があれば更新、i18n-guide.md準拠のメッセージキー追加）

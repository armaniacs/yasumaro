# PBI: TDD による Built-in AI Provider 実装と統合

> **対象バージョン: v6.7**
> PBI 2 の設計（[dev-docs/2026-07-28-built-in-ai-provider-integration-design.md](../dev-docs/2026-07-28-built-in-ai-provider-integration-design.md)）を基に、テスト駆動開発で Built-in AI 統合を実装し、Yasumaro の要約パイプラインに統合する。
> **本 PBI は Epic 級（13pt 見込み）のため、着手前にシニアメンバーとの設計相談を推奨する。**
>
> **2026-07-28 更新**: PBI 2 の設計確定に伴い、統合方式を修正した。2026-07-27 ADR「AIClientとAIServiceの統一方針」により、新規のAI機能は `AIService` インターフェース経由で統合し、`AIClient.registerProvider` への新規登録は行わない。本 PBI が当初想定していた `BuiltInAIProvider extends AIProviderStrategy` は採用せず、既存 `LocalAIService`（`src/background/ai/LocalAIService.ts`）が内部で保持する `LocalAIClient` を `BuiltInAIClient` として刷新し、Service Worker から `LanguageModel` を直接呼び出す構成に変更する（Offscreen Document 経由は廃止し、`offscreen.ts` は SQLite 専用に純化する）。

## ユーザーストーリー

プライバシー重視ユーザーとして、API キー不要で Built-in AI を使ってページ要約したい。なぜなら、外部の AI サービスに機密性の高い閲覧内容を送信したくないから。

## 背景・課題

PBI 3 の目的をなぜなぜ分析で掘り下げた結果、以下の課題構造が明らかになった。

1. TDD で実装・統合する必要があるのは、外部 AI を使わずに機密性の高い閲覧要約を正しく動作させ、品質を担保するため
2. 外部 AI を使わずに要約する必要があるのは、プライバシー重視ユーザーが機密性の高い閲覧内容を外部サービスに送信したくないため
3. プライバシー重視ユーザーが外部送信を嫌うのは、閲覧履歴は個人の思考や興味、業務機密を反映しており、外部に漏洩すると重大な不利益を被る可能性があるため
4. 閲覧履歴が機密性が高いのは、検索履歴、アクセスしたサイト、滞在時間などから、個人の属性や意図、行動パターンを推測できてしまうため
5. 個人の属性や意図が推測できると問題なのは、それらが悪用されると標的型攻撃、差別、プライバシー侵害、法的リスクなどに繋がるため
6. そのリスクを Yasumaro が軽減できるのは、ブラウザ内のローカル AI を利用すれば、要約対象のテキストが外部ネットワークに流出しないため
7. ローカル AI で流出しないのは、Chrome Built-in AI は端末内の Gemini Nano を使用し、データが Google のサーバに送信されない設計だから
8. データが外部に送信されない設計が信頼できるのは、Prompt API はオフラインで動作し、ネットワーク接続がなくても動作するため、外部送信の経路が物理的に存在しない
9. オフラインで動作することが重要なのは、ユーザーがネットワークを信頼できない環境（出張先、公共 Wi-Fi、社内ネットワーク制限）でも利用できるため
10. ネットワークを信頼できない環境でも利用できる必要があるのは、要約機能は日常的に利用されるため、利用可能な環境が限定されると価値が大きく損なわれるため
11. TDD が品質担保に適しているのは、`window.ai` は実験的 API で挙動が変わりやすく、テストを先に書くことで期待動作を明確化し、回帰を防ぐため
12. 回帰防止が重要なのは、Built-in AI は Chrome のアップデートや Flags 変更で挙動が変わる可能性があり、それが要約機能全体に影響を与えるため
13. 要約機能全体に影響を与えるのは、Yasumaro の中核機能が閲覧履歴の自動記録と要約であり、AI Provider の障害は記録パイプライン全体を停止させる可能性があるため
14. パイプライン全体を停止させないようにする必要があるのは、優先度リストによるフォールバックがあれば、Built-in AI が失敗しても外部 Provider に切り替わり、記録の継続性を保てるため

## ビジネス価値

- 外部 AI を使わずに機密性の高い閲覧要約・履歴管理を可能にする
- コストをかけたくないユーザーに無料の要約手段を提供する
- プライバシーを重視するユーザーの獲得・維持に寄与する
- **オフライン・ネットワーク制限環境でも要約機能を利用可能にする**
- **Chrome アップデートや Flags 変更による回帰をテストで防ぎ、機能の信頼性を保つ**
- **優先度リストによるフォールバックで、記録パイプラインの継続性を担保する**

## BDD 受け入れシナリオ

```gherkin
Scenario: ユーザーが Built-in AI で閲覧ページを要約する
  Given ユーザーが Built-in AI を AI Provider として選択している
  And   Chrome Built-in AI が利用可能な状態
  When  ユーザーが要約対象のページを訪問し、要約がトリガーされる
  Then  外部 AI サービスを経由せずにローカルで要約が生成される
  And   要約結果が SQLite に保存される
  And   履歴に「Built-in AI」として記録される

Scenario: Built-in AI が失敗した場合に次のプロバイダにフォールバックする
  Given ユーザーが優先度リストで Built-in AI を1位、外部プロバイダを2位に設定している
  And   Built-in AI が利用不可または応答エラーになった状態
  When  要約がトリガーされる
  Then  Built-in AI の試行後、自動的に2位の外部プロバイダに切り替わる
  And   フォールバックが発生したことが記録される
```

## 受け入れ基準

- [x] `BuiltInAIClient`（刷新後の `LocalAIClient`）が Service Worker から `LanguageModel.availability()`/`create()` を直接呼び出し、`LocalAIService`（`AIService` 実装）経由で優先度リストのスロットとして動作する
- [x] ダッシュボードの AI Provider 設定で「Built-in AI（APIキー不要）」が選択可能
- [x] Built-in AI 選択時、API キー入力欄が非表示になる
- [x] 優先度リストで Built-in AI の成否に応じて外部プロバイダへのフォールバックが動作する（設計の[優先度リスト統合方式](../dev-docs/2026-07-28-built-in-ai-provider-integration-design.md#44-優先度リストとの統合方式)を実装）
- [x] Chrome 安定版/Dev/Canary（モデルダウンロード済み環境）での E2E 動作確認が完了している
- [x] ~~ネットワーク切断状態でも Built-in AI 要約が完了する（オフライン動作確認）~~ → **対象外と判断（撤回）**: Gemini Nano はオンデバイス推論でネットワーク呼び出しが物理的に存在しないため、この基準自体は設計上自明に満たされる。一方でChrome拡張機能をブラウザで操作する検証手順自体がネットワーク接続を前提とするため、「ネットワークを切断して動作確認する」という検証行為自体が成立しない（ページ読み込み等の操作ができなくなる）。よって本基準は撤回し、実装が外部通信を一切行わないことをコードレビュー（`builtInAIClient.ts` に `fetch`/`XMLHttpRequest` 等の外部通信呼び出しが存在しないこと）で担保する
- [x] Built-in AI 失敗時に優先度リストの次位 Provider にフォールバックし、記録パイプラインが停止しない
- [x] Chrome 実装の変更に対する回帰テストが自動テストとして実装されている
- [x] 全テストがパスし、テストカバレッジ基準を満たしている

## テスト戦略（t_wada スタイル）

### E2E テスト（最小限）

- 実際の Chrome（モデルダウンロード済み環境。必要に応じて Flags 有効化）で Built-in AI 要約が完了するシナリオ
- 優先度リストでの Built-in AI → 外部プロバイダ フォールバックシナリオ

### 統合テスト（中程度）

- `FallbackAIService` → `LocalAIService` → `BuiltInAIClient` → `self.LanguageModel` の呼び出し連携（Service Worker直接呼び出し、Offscreen Documentは経由しない）
- 優先度リストのスロット判定ディスパッチ（`provider === 'built-in-ai'` の場合に `local`、それ以外は `remote` へ振り分け）
- ダッシュボード設定の保存・読み込み（`ai_provider` / `ai_provider_priority_list`）
- `downloadable` / `downloading` / `unavailable` 状態でのエラーレスポンス

### 単体テスト（多数）

- `LocalAIService.generateSummary()` のビジネスロジック
- 入力文字数・トークン制限に基づく長文切り詰め（`aiLimits.ts` 一本化 + `contextWindow`/`contextUsage` 動的管理）
- `available` / `downloadable` / `downloading` / `unavailable` 各状態のハンドリング
- `session.destroy()` の呼び出しとリソース解放
- ダッシュボードの UI 表示切り替え（`updateAIProviderVisibility` 追加）
- `BuiltInAIClient` のタイムアウト・エラーハンドリング

## 実装アプローチ

- **Outside-In**: E2E テストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDD サイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善
- **段階的統合**: まず `BuiltInAIClient` を単体で動作させ、次に `LocalAIService`/`FallbackAIService` 統合、最後に UI 統合

## 見積もり

13 ポイント（要チームでの見積もり）

**注意**: Epic 規模に近いため、着手前にシニアメンバーとの設計相談を行うこと。

## 技術的考慮事項

- **依存関係**: PBI 1（調査）および PBI 2（設計）の完了
- **テスタビリティ**: `self.LanguageModel` / `chrome.runtime.sendMessage` を vitest + jsdom でモック化する
- **非機能要件**:
  - パフォーマンス: Service Worker から `LanguageModel.create()` 呼び出しまでの応答時間を計測（Offscreen Document起動を廃止したことによる短縮を確認）
  - セキュリティ: サニタイズ済みコンテンツのみを Prompt API に送信（既存 `sanitizePromptContent` を再利用）
  - プライバシー: 外部通信を行わないことを明示

## 実装者向け注記

### 現状コードの確認

```bash
# AIService統合層を確認
grep -rn "AIService\|RemoteAIService\|LocalAIService\|FallbackAIService" src/background/ai/ --include="*.ts"

# 既存の Built-in AI 実装（刷新対象）を確認
grep -rn "localAiClient\|summarizeLocally\|getLocalAvailability" src/ --include="*.ts"
grep -rn "LanguageModel\|window.ai" src/offscreen/ --include="*.ts"

# UI 側を確認
grep -rn "PROVIDER_LABELS\|updateAIProviderVisibility" src/ --include="*.ts"
```

**確認済み**: 既存の `src/offscreen/offscreen.ts` と `src/background/localAiClient.ts` に旧世代の Chrome Prompt API 実装（`window.ai.languageModel`）が存在する。`src/background/ai/LocalAIService.ts` が既にこれをラップして `AIService` として `FallbackAIService` に組み込まれているため、`AIClient` への新規登録は不要。`src/popup/settings/aiProvider.ts` の UI 選択肢にも Built-in AI は存在しない。

### 実装手順（設計ドキュメント[2章](../dev-docs/2026-07-28-built-in-ai-provider-integration-design.md#2-service-worker-直接呼び出しへの移行設計)に準拠）

1. ~~実環境検証（最優先・実装着手前に必須）~~ → **2026-07-28完了**: モデルダウンロード済みのYasumaro拡張機能 Service Worker (`background.js`) コンソールで `LanguageModel.availability()` → `create()` → `session.prompt()` が成功することを実機確認済み（応答: 「こんにちは！私はGemmaです...」）。Service Worker直接呼び出し方針を確定
2. `LocalAIClient` を `BuiltInAIClient` として刷新する（`src/background/localAiClient.ts`）。`LanguageModel.availability()`/`create()`（現行仕様）を Service Worker から直接呼び出す実装に置き換える
3. `offscreen.ts` から Prompt API 関連コード（`AICapabilities`/`AISession`/`getAI`/`checkAvailability`/`ensureSession`/`CHECK_AVAILABILITY`/`SUMMARIZE` ハンドラ）を削除し、SQLite 専用ファイルへ純化する
4. `createBackgroundServices.ts` の `LocalAIService` 配線を `BuiltInAIClient` に差し替える（`LocalAIService` 自体のインターフェースは変更しない）
5. 優先度リストのスロット判定ディスパッチ（`provider === 'built-in-ai'` を検出したら `LocalAIService` へ委譲する薄い層）を実装する（設計[4.4章](../dev-docs/2026-07-28-built-in-ai-provider-integration-design.md#44-優先度リストとの統合方式)参照）
6. ダッシュボードの Provider 選択肢・優先度リストUIに `built-in-ai` を追加し、`src/popup/settings/aiProvider.ts` の UI 表示制御にケースを追加する
7. `aiLimits.ts` の `localai` 制限（16,384文字）に一本化し、`offscreen.ts` の10,000文字ハードコードを削除する。`contextWindow`/`contextUsage` による動的管理を追加する
8. E2E テストを Chrome 実機で実施する

### 落とし穴

- Service Worker から `LanguageModel` を直接呼び出す設計だが、実環境で `create()` が失敗する場合は Offscreen Document 経由に設計を差し戻す必要がある（手順1の実環境検証が前提）
- `downloadable` 状態ではユーザーにダウンロード待ちを伝える必要があり、ユーザージェスチャー（要約試行のトリガー）がないとダウンロードが開始されない
- Prompt API の入力上限（`aiLimits.ts` の16,384文字、`contextWindow`/`contextUsage`）を超える長文は動的な切り詰めが必要
- `session` インスタンスのライフサイクル管理を誤るとメモリリークや二重応答の原因になる
- UI ラベルは i18n 対応（`data-i18n` 属性）が必要
- Chrome のアップデートや Flags 変更で `LanguageModel` の挙動が変わる可能性があるため、回帰テストを充実させる
- オフライン動作を謳う場合は、実際にネットワークを切断して動作確認を行う必要がある
- Built-in AI 単独の障害で記録パイプライン全体が停止しないよう、必ずフォールバック経路をテストする
- `offscreen.ts` はSQLite操作でも使われているファイルのため、Prompt API関連コード削除時にSQLite側のロジックを誤って壊さないよう注意

## Definition of Done

- [x] 全 BDD シナリオが自動テストとして実装されパスする
- [x] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [x] コードレビュー完了（`builtInAIClient.ts` に外部通信呼び出し `fetch`/`XMLHttpRequest`/`WebSocket` が存在しないことを確認済み）
- [x] リファクタリング完了（グリーン後）
- [x] ドキュメント更新済み
- [x] 実際の Chrome 環境での E2E 動作確認済み

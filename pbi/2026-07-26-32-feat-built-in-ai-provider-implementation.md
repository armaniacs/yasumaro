# PBI: TDD による Built-in AI Provider 実装と統合

> **対象バージョン: v6.7**
> PBI 2 の設計を基に、テスト駆動開発で `BuiltInAIProvider` を実装し、Yasumaro の要約パイプラインに統合する。
> **本 PBI は Epic 級（13pt 見込み）のため、着手前にシニアメンバーとの設計相談を推奨する。**

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

- [ ] `BuiltInAIProvider` が `AIProviderStrategy` を実装し、`AIClient` の優先度リストで動作する
- [ ] ダッシュボードの AI Provider 設定で「Built-in AI（APIキー不要）」が選択可能
- [ ] Built-in AI 選択時、API キー入力欄が非表示になる
- [ ] 優先度リストで Built-in AI の成否に応じて外部プロバイダへのフォールバックが動作する
- [ ] Chrome Dev/Canary（Flags 有効化環境）での E2E 動作確認が完了している
- [ ] ネットワーク切断状態でも Built-in AI 要約が完了する（オフライン動作確認）
- [ ] Built-in AI 失敗時に優先度リストの次位 Provider にフォールバックし、記録パイプラインが停止しない
- [ ] Chrome 実装の変更に対する回帰テストが自動テストとして実装されている
- [ ] 全テストがパスし、テストカバレッジ基準を満たしている

## テスト戦略（t_wada スタイル）

### E2E テスト（最小限）

- 実際の Chrome（Flags 有効化環境）で Built-in AI 要約が完了するシナリオ
- 優先度リストでの Built-in AI → 外部プロバイダ フォールバックシナリオ

### 統合テスト（中程度）

- `AIClient` → `BuiltInAIProvider` → `LocalAIClient` → Offscreen Document のメッセージング連携
- ダッシュボード設定の保存・読み込み（`ai_provider` / `ai_provider_priority_list`）
- `after-download` / `no` / `unsupported` 状態でのエラーレスポンス

### 単体テスト（多数）

- `BuiltInAIProvider.generateSummary()` のビジネスロジック
- 入力文字数・トークン制限に基づく長文切り詰め
- `readily` / `after-download` / `no` / `unsupported` 各状態のハンドリング
- `session.destroy()` の呼び出しとリソース解放
- ダッシュボードの UI 表示切り替え（`updateAIProviderVisibility` 追加）
- `LocalAIClient` のタイムアウト・エラーハンドリング

## 実装アプローチ

- **Outside-In**: E2E テストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: TDD サイクルを各レイヤーで適用
- **リファクタリング**: グリーンになるたびに品質改善
- **段階的統合**: まず `BuiltInAIProvider` を単体で動作させ、次に `AIClient` 統合、最後に UI 統合

## 見積もり

13 ポイント（要チームでの見積もり）

**注意**: Epic 規模に近いため、着手前にシニアメンバーとの設計相談を行うこと。

## 技術的考慮事項

- **依存関係**: PBI 1（調査）および PBI 2（設計）の完了
- **テスタビリティ**: `window.ai` / `chrome.offscreen` / `chrome.runtime.sendMessage` を vitest + jsdom でモック化する
- **非機能要件**:
  - パフォーマンス: Offscreen Document 起動と Prompt API 応答の合計時間を計測
  - セキュリティ: サニタイズ済みコンテンツのみを Prompt API に送信（既存 `sanitizePromptContent` を再利用）
  - プライバシー: 外部通信を行わないことを明示

## 実装者向け注記

### 現状コードの確認

```bash
# Provider 抽象化を確認
grep -rn "AIProviderStrategy\|AIProviderFactory\|registerProvider\|generateSummary" src/background/ --include="*.ts"

# 既存の Built-in AI 実装を確認
grep -rn "localAiClient\|summarizeLocally\|getLocalAvailability" src/ --include="*.ts"
grep -rn "LanguageModel\|window.ai" src/offscreen/ --include="*.ts"

# UI 側を確認
grep -rn "PROVIDER_LABELS\|updateAIProviderVisibility" src/ --include="*.ts"
```

**確認済み**: 既存の `src/offscreen/offscreen.ts` と `src/background/localAiClient.ts` に Chrome Prompt API 実装が存在するが、`src/background/aiClient.ts` の Provider 抽象化には統合されていない。`src/popup/settings/aiProvider.ts` の UI 選択肢にも存在しない。

### 実装手順

1. `BuiltInAIProvider` クラスを `src/background/ai/providers/` 配下に作成する
2. `AIProviderStrategy` インターフェースを満たすよう `generateSummary()` / `testConnection()` を実装する
3. `AIClient.registerDefaultProviders()` で `'built-in-ai'` として登録する
4. `PROVIDER_LABELS` に `'built-in-ai': 'Built-in AI（APIキー不要）'` を追加する
5. `src/popup/settings/aiProvider.ts` の UI 表示制御に `built-in-ai` ケースを追加する
6. ダッシュボードの Provider 選択肢に `built-in-ai` を追加する
7. `aiLimits.ts` の `localai` 制限を `built-in-ai` でも使用できるよう確認・調整する
8. E2E テストを Chrome 実機で実施する

### 落とし穴

- `window.ai` は Service Worker では利用できないため、必ず Offscreen Document 経由とする
- `after-download` 状態ではユーザーにダウンロード待ちを伝える必要がある
- Prompt API の入力上限（現状 10,000 文字や 16,384 トークン）を超える長文は切り詰めまたは前処理が必要
- `session` インスタンスのライフサイクル管理を誤るとメモリリークや二重応答の原因になる
- `chrome.runtime.sendMessage` の非同期応答では `return true` を忘れないように注意（既存コードは対応済み）
- UI ラベルは i18n 対応（`data-i18n` 属性）が必要
- Chrome のアップデートや Flags 変更で `window.ai` の挙動が変わる可能性があるため、回帰テストを充実させる
- オフライン動作を謳う場合は、実際にネットワークを切断して動作確認を行う必要がある
- Built-in AI 単独の障害で記録パイプライン全体が停止しないよう、必ずフォールバック経路をテストする

## Definition of Done

- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] ドキュメント更新済み
- [ ] 実際の Chrome 環境での E2E 動作確認済み

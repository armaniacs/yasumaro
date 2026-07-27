# PBI: Built-in AI Provider 統合設計

> **対象バージョン: v6.7**
> PBI 1 の調査結果を基に、Yasumaro の既存 Provider 抽象化へ Chrome Built-in AI を統合する設計を確定する。

## ユーザーストーリー

開発者として、Built-in AI を既存の AI Provider 抽象化に統合する設計がほしい。なぜなら、ダッシュボードから選択可能にし、優先度リストでのフォールバックを可能にするため。

## 背景・課題

PBI 2 の目的をなぜなぜ分析で掘り下げた結果、以下の課題構造が明らかになった。

1. Provider 抽象化に統合する設計が必要なのは、ダッシュボードから「Built-in AI」を選択可能にし、他の Provider と同じように管理するため
2. ダッシュボードから選択可能にする必要があるのは、ユーザーが自分の環境に合った AI Provider（API キー不要の Built-in AI、または外部 AI）を選べるようにするため
3. ユーザーが選べる必要があるのは、Built-in AI は Chrome / Flags / モデルダウンロードの制約があり、すべてのユーザーが利用できるわけではないため
4. すべてのユーザーが利用できないのは、`readily` / `after-download` / `no` / `unsupported` の状態があり、ブラウザ環境や設定によって左右されるため
5. ブラウザ環境に左右されることが問題なのは、一部のユーザーだけが利用できない場合、統一された UX を提供できず、混乱やサポートコストが増えるため
6. 統一された UX が重要なのは、Yasumaro は複数の AI Provider をサポートしており、ユーザーが Provider 間の切り替えを直感的に行える必要があるため
7. 直感的な切り替えが必要なのは、要約機能は閲覧のたびに利用されるため、設定変更の手間や誤設定はユーザー体験を大きく損なうため
8. 要約機能が頻繁に利用されるのは、Yasumaro の中核機能が「閲覧履歴の自動記録と要約」であり、AI Provider はその中核を支えるインフラであるため
9. AI Provider が中核を支えるインフラなのは、要約品質と可用性が、ユーザーが後から閲覧履歴を振り返る際の価値を左右するため
10. 要約品質と可用性が価値を左右するのは、ユーザーは大量の閲覧履歴の中から重要な情報を効率的に抽出したいと考えており、要約が役立たないと履歴管理自体の価値が下がるため
11. 要約が役立たないと履歴管理の価値が下がるのは、要約がないとユーザーは各ページを個別に開いて内容を思い出す必要があり、時間と認知負荷が増大するため
12. Provider 抽象化に統合することが最善なのは、既存の優先度リスト、フォールバック、エラーハンドリング、設定管理の仕組みを再利用でき、新しいインフラを作らずに済むため

## ビジネス価値

- 実装の方向性を固め、複数人開発時の認識を合わせる
- UI/UX、エラーハンドリング、長文処理の仕様を早期に確定させる
- 実装フェーズの手戻りを減らす
- **複数 AI Provider 間で統一されたユーザー体験を提供し、設定の混乱やサポートコストを抑える**
- **既存インフラ（優先度リスト、フォールバック、設定管理）を再利用し、無駄な新規開発を避ける**
- **ユーザーの認知負荷を軽減し、要約機能の継続的な利用を促進する**

## BDD 受け入れシナリオ

```gherkin
Scenario: ユーザーがダッシュボードで Built-in AI を選択する
  Given ユーザーがダッシュボードの AI Provider 設定を開いている
  When  ユーザーが Provider プルダウンで「Built-in AI（APIキー不要）」を選択する
  Then  API キー入力欄が非表示になる
  And   既存の優先度リストにも Built-in AI を追加できる

Scenario: Built-in AI が利用不可な場合にユーザーへ通知する
  Given ユーザーのブラウザが Built-in AI に対応していない、またはモデルが未ダウンロード
  When  ユーザーが Built-in AI を選択または要約を試行する
  Then  利用不可の理由（未対応ブラウザ / ダウンロード待ち / 設定方法）が分かりやすく表示される
```

## 受け入れ基準

- [x] `BuiltInAIService`（`AIService` インターフェース実装）の設計図が作成されている（PBI 1 実機検証・2026-07-27 ADR「AIClientとAIServiceの統一方針」を踏まえ、`AIProviderStrategy`/`AIClient.registerProvider` 経由ではなく `AIService` 経由で統合する）
- [x] Service Worker から `LanguageModel` を直接呼び出す設計（Offscreen Document 経由を廃止するか、SQLite 用途のみに縮退させるか）がデータフロー図で文書化されている
- [x] 長文テキスト（入力上限を超える DOM 抽出結果）に対する前処理（切り詰め・チャンク化、`contextWindow`/`contextUsage` を用いた動的管理）の仕様が確定している
- [x] ダッシュボード UI で「Built-in AI（APIキー不要）」を選択肢として表示・切り替え可能にする設計が完了している
- [x] `downloadable` / `downloading` / `unavailable`（現行4値仕様）各状態におけるユーザー通知とフォールバック動作が設計されている
- [x] 既存の `FallbackAIService` / 優先度リスト / 設定管理の仕組みを最大限再利用する設計になっている
- [x] 他の AI Provider（gemini / openai / ollama 等）との設定切り替えが直感的に行える UI 設計になっている
- [x] 設計ドキュメントがチームレビューで承認されている

## テスト戦略（t_wada スタイル）

E2E / 統合テストは対象外（設計 PBI のため）。

### 設計の検証（単体テストに相当）

- 設計ドキュメントのレビュー
- `BuiltInAIService` のインターフェースが既存 `AIService` 契約（`FallbackAIService` 経由での合成）と整合しているか
- UI 設計が i18n / アクセシビリティ基準（`docs/ACCESSIBILITY.md`）を満たすか
- 長文処理・エラーハンドリングの状態遷移図のレビュー

## 実装アプローチ

- **調査結果を設計に反映**: PBI 1 で特定した OSS 実装パターン・API 限界・実機検証結果（Service Worker 直接呼び出し可否）を設計に組み込む
- **既存コードとの整合**: `AIService` インターフェース（`generateSummary` / `getSupportedModes`）の契約を変更しない範囲で設計する。`AIClient.registerProvider` への新規登録は 2026-07-27 ADR の方針により行わない
- **設計 → レビュー → 承認**: 実装に入る前に設計を承認する

## 見積もり

5 ポイント（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: PBI 1 の調査結果
- **テスタビリティ**: 設計段階でモック戦略を明確にする（`window.ai` / `chrome.offscreen` / メッセージング）
- **非機能要件**: アクセシビリティ、i18n（日本語・英語両対応）、セキュリティ（`tab.url` 等の取り扱い）

## 実装者向け注記

### 現状コードの確認

```bash
# AIService統合層（2026-07-27 ADRで確定した新方針の窓口）を確認
grep -rn "AIService\|RemoteAIService\|LocalAIService\|FallbackAIService" src/background/ai/ --include="*.ts"

# 既存Prompt API実装（刷新対象）を確認
grep -rn "LanguageModel\|window.ai\|LocalAIClient" src/background/localAiClient.ts src/offscreen/offscreen.ts

# UI 側の選択肢を確認
grep -rn "PROVIDER_LABELS\|updateAIProviderVisibility\|setupAIProviderChangeListener" src/ --include="*.ts"
```

**確認済み**: `dev-docs/ADR/2026-07-27-ai-client-service-unification.md` により「新規のAI機能はAIService経由、AIClientへの新規直接依存は原則禁止」の方針が確定済み。既存の `LocalAIService`（`src/background/ai/LocalAIService.ts`）が既に `LocalAIClient`（Prompt API）をラップしているため、Built-in AI 統合はこの層を刷新する形で行う。`src/background/aiClient.ts` の `providers` Map（Strategy パターン）は Gemini/OpenAI 系の外部APIプロバイダー専用のままとし、新規登録は行わない。`src/popup/settings/aiProvider.ts` の UI 選択肢にも Built-in AI は存在しない。

### 設計のポイント

1. `BuiltInAIService`（or 刷新後の `LocalAIService`）が `AIService` インターフェース（`generateSummary` / `getSupportedModes`）を実装する
2. `createBackgroundServices.ts` の配線（`FallbackAIService({ local, remote })`）に、刷新後の Built-in AI 実装を注入する
3. ダッシュボードの Provider 選択肢に「Built-in AI（APIキー不要）」を追加する（この UI 選択は `AI_PROVIDER_PRIORITY_LIST` の `mode` 切り替えと整合させる）
4. `LocalAIClient` / `offscreen.ts` の Prompt API 呼び出しを現行仕様（`LanguageModel.availability()`/`create()`）へ刷新し、Service Worker 直接呼び出しへの移行可否を設計で決定する

### 落とし穴

- `AIService.generateSummary()` の戻り値形式（`AISummaryResult`）を変更しないように注意
- `aiLimits.ts` の `localai` 制限と実際の Gemini Nano 上限の整合性を確認
- UI 側で「API キー不要」であることを明確に表示しないと、ユーザーが設定ミスをする可能性がある
- 優先度リストで Built-in AI が 1位の場合、2位以下の外部 Provider への切り替えが自然に行えるよう遷移設計が必要
- 既存ユーザー設定との後方互換性を考慮し、`ai_provider` / `ai_provider_priority_list` の移行設計が必要
- 設定画面での Provider 表示切り替えが、単一選択モードと優先度リストモードの両方で一貫して動作するよう注意
- `reviewSummaryGenerator.ts` は ADR の例外規定により `AIClient` を直接生成し続けているため、Built-in AI を週次/月次ダイジェストでも使う場合はこの経路の扱いを別途検討する

## Definition of Done

- [x] 全 BDD シナリオに対応する設計項目が完了している
- [x] 設計ドキュメントがチームレビューで承認されている
- [x] PBI 3（実装）に必要な設計情報が引き継がれている
- [x] ドキュメント更新済み

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

- [ ] `BuiltInAIProvider` クラスが既存の `AIProviderStrategy` インターフェースに適合する設計図が作成されている
- [ ] Service Worker → Offscreen Document → `window.ai` のメッセージングフローが Sequence Diagram またはデータフロー図で文書化されている
- [ ] 長文テキスト（入力上限を超える DOM 抽出結果）に対する前処理（切り詰め・チャンク化）の仕様が確定している
- [ ] ダッシュボード UI で「Built-in AI（APIキー不要）」を選択肢として表示・切り替え可能にする設計が完了している
- [ ] `after-download` / `no` / `unsupported` 各状態におけるユーザー通知とフォールバック動作が設計されている
- [ ] 既存の優先度リスト、フォールバック、設定管理の仕組みを最大限再利用する設計になっている
- [ ] 他の AI Provider（gemini / openai / ollama 等）との設定切り替えが直感的に行える UI 設計になっている
- [ ] 設計ドキュメントがチームレビューで承認されている

## テスト戦略（t_wada スタイル）

E2E / 統合テストは対象外（設計 PBI のため）。

### 設計の検証（単体テストに相当）

- 設計ドキュメントのレビュー
- `BuiltInAIProvider` のインターフェースが既存 Strategy パターンと整合しているか
- UI 設計が i18n / アクセシビリティ基準（`docs/ACCESSIBILITY.md`）を満たすか
- 長文処理・エラーハンドリングの状態遷移図のレビュー

## 実装アプローチ

- **調査結果を設計に反映**: PBI 1 で特定した OSS 実装パターンや API 限界を設計に組み込む
- **既存コードとの整合**: `AIClient.registerProvider` / `AIProviderStrategy` の契約を変更しない範囲で設計する
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
# Provider 抽象化を確認
grep -rn "AIProviderStrategy\|AIProviderFactory\|registerProvider\|generateSummary" src/background/ --include="*.ts"

# UI 側の選択肢を確認
grep -rn "PROVIDER_LABELS\|updateAIProviderVisibility\|setupAIProviderChangeListener" src/ --include="*.ts"
```

**確認済み**: `src/background/aiClient.ts` の `providers` Map には `gemini`, `openai`, `ollama` 等が登録されているが、`localai` / `builtInAi` は登録されていない。`src/popup/settings/aiProvider.ts` の UI 選択肢にも存在しない。

### 設計のポイント

1. `BuiltInAIProvider` が `AIProviderStrategy` を実装する
2. `AIClient.registerProvider('built-in-ai', ...)` で登録する
3. ダッシュボードの Provider 選択肢に「Built-in AI（APIキー不要）」を追加する
4. 既存の `LocalAIClient` / `offscreen.ts` をラップする形で再利用するか、置き換えるかを設計で決定する

### 落とし穴

- `AIProviderStrategy.generateSummary()` の戻り値形式（`AISummaryResult`）を変更しないように注意
- `aiLimits.ts` の `localai` 制限と実際の Gemini Nano 上限の整合性を確認
- UI 側で「API キー不要」であることを明確に表示しないと、ユーザーが設定ミスをする可能性がある
- 優先度リストで Built-in AI が 1位の場合、2位以下の外部 Provider への切り替えが自然に行えるよう遷移設計が必要
- 既存ユーザー設定との後方互換性を考慮し、`ai_provider` / `ai_provider_priority_list` の移行設計が必要
- 設定画面での Provider 表示切り替えが、単一選択モードと優先度リストモードの両方で一貫して動作するよう注意

## Definition of Done

- [ ] 全 BDD シナリオに対応する設計項目が完了している
- [ ] 設計ドキュメントがチームレビューで承認されている
- [ ] PBI 3（実装）に必要な設計情報が引き継がれている
- [ ] ドキュメント更新済み

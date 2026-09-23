# PBI: AI プロバイダ構築の重複儀式（timeout 導出・apiKeySource ログ）を基底に集約する

## ユーザーストーリー
開発者として、AI プロバイダ構築時の定型（timeout 導出・apiKeySource ログ）を基底の1実装に集約したい、なぜなら2ファイルの同形コピーは timeout 既定値変更の二度手間と Gemini 側の分岐欠落の無記録化を招くから

## 優先度
- 順位: 9
- RICEスコア: 6.0（Reach=3 / Impact=1 / Confidence=1.0 / Effort=0.5週）
- 種別: refactor
- 根拠: 影響範囲は構築時の2箇所のみで Impact は 1 だが、timeout 既定値の変更が2箇所編集になる状態は誤差の温床である。Gemini の固定値の意図が無記録であるため、将来の local 系 variant 追加時に静かな誤既定値になる危険がある。 Effort が小さいため先に潰す

## ビジネス価値
timeout 既定値の変更が1箇所になる。Gemini の固定 30000 の理由が記録され、将来の local 系 variant 追加時の誤既定値を防ぐ。ログ文言の修正が1箇所に集約される（locality）

## BDD受け入れシナリオ

```gherkin
Scenario: OpenAI 系プロバイダの timeout 導出が基底に委譲される
  Given AI_TIMEOUT_MS の格納値が 0 である
  When GenericOpenAICompatibleProvider を local と non-local の設定で構築する
  Then local は 120000、non-local は 30000 になり、導出は基底の1実装のみを参照する

Scenario: Gemini の timeout 既定値が変わらない
  Given AI_TIMEOUT_MS の格納値が 0 である
  When GeminiProvider を構築する
  Then timeout は 30000 になり、固定値の理由がコメントまたはパラメータで記録される

Scenario: apiKeySource ログの文言と条件が変わらない
  Given 両プロバイダの既存の構築パス
  When 各プロバイダを構築する
  Then `API key resolved from: ${apiKeySource}` の文言で1回だけ logDebug される

Scenario: 格納値が正の場合はその値が優先される
  Given AI_TIMEOUT_MS の格納値が正の数である
  When 両プロバイダを構築する
  Then 両方とも格納値をそのまま timeout とする
```

## 受け入れ基準
- [x] ProviderStrategy または共通基底に protected の `resolveTimeoutMs(stored, isLocal)` が新設される
- [x] apiKeySource のログ helper が基底に新設され、両プロバイダから委譲される
- [x] OpenAI 系の timeout 導出（local は 120000、非 local は 30000）が byte-identical に保たれる
- [x] Gemini の timeout 既定値 30000 が byte-identical に保たれ、isLocal 分岐を持たない理由が記録される
- [x] ログ文言 `API key resolved from:` が byte-identical に保たれる（golden pin）
- [x] 既存のプロバイダ構築テスト・統合検証が green である

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外（内部構造改善）

### 統合テスト
- 両プロバイダの構築契約 suite：格納値 0 → 既定値（OpenAI 系は isLocal 分岐、Gemini は 30000）、正の格納値 → 格納値優先、ログ文言一致

### 単体テスト
- `resolveTimeoutMs` の境界（0 以下 → 既定値、正値 → そのまま、local と non-local の分岐）
- ログ helper の文言・呼び出し回数（鍵素材が含まれないこと）

## 実装アプローチ
- **Outside-In**: 両プロバイダに対する構築契約テスト（timeout 値・ログ文言の golden pin）を先に書き、Red で基底 helper 新設
- 既存の timeout 値とログ文言は一切変えず、両プロバイダ側は委譲呼び出しに置き換えるのみとする
- Gemini 固定値の理由（Gemini は local になり得ない）はコメントまたはパラメータ既定値として残し、将来の local 系 variant 追加時の判断材料にする

## 見積もり
1ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 他 PBI とは独立。ProviderStrategy の責務拡張であるため、HTTP 実行フロー（executeHttpSummaryFlow / executeHttpTestFlow）の所有境界は変えない
- 非機能要件: 既存 timeout 値・ログ文言は byte-identical。出力・通信挙動の変更はなし
- 将来の local-Gemini 系 variant が現れた場合、`resolveTimeoutMs` の isLocal 分岐をそのまま使える形にし、固定値分岐の追加は避ける

## 実装者向け注記

### 現状の証拠
- OpenAI 系の timeout 導出: `src/background/ai/providers/OpenAIProvider.ts:103-109` — `storedTimeout = Number(s[StorageKeys.AI_TIMEOUT_MS] ?? 0)` が 0 以下の場合 `this.isLocal ? 120000 : 30000`
- OpenAI 系の apiKeySource ログ: `src/background/ai/providers/OpenAIProvider.ts:88` — `void logDebug(\`API key resolved from: ${this.apiKeySource}\`, { provider: providerName })`
- Gemini の timeout 導出: `src/background/ai/providers/GeminiProvider.ts:60-62` — 同形だが固定 `30000`（isLocal 分岐なし。Gemini は local になり得ないが意図が記録されていない）
- Gemini の apiKeySource ログ: `src/background/ai/providers/GeminiProvider.ts:64-66` — 同一文言の `API key resolved from:` を `void logDebug` で記録
- 故障形態: timeout 既定値の変更が2箇所編集になる。Gemini の意図的分岐欠落が無記録で、将来の local-Gemini 系 variant が静かに誤既定値になる

## Definition of Done
- [x] 全BDDシナリオが実装されパスする
- [x] コードレビューが完了する
- [x] 統合検証が green である

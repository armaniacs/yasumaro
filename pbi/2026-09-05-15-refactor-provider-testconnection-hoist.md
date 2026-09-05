# PBI 15: Provider testConnection の共有部引き上げ（_getAllowedUrls・応答 cap の base 集約）

優先度: Round 5 5 位 / RICE 4.5 = (2 × 1 × 90%) / 0.2w / Strength: Worth exploring
backlog: [2026-09-05-00-backlog-arch5.md](2026-09-05-00-backlog-arch5.md)
依存: なし

## ユーザーストーリー
AI provider を保守する開発者として、testConnection 経路の共有断片（許可 URL 取得・応答バイト cap）が base 1 箇所に集約されてほしい。なぜなら Round 3 の base template が summary 経路を deep 化した一方、template 対象外の testConnection 経路に断片複製が残り、旧 PBI（2026-08-07-01）で指摘済みの `_getAllowedUrls` の逐語同一 2 コピーが未解消のままだから。

## 対象（2026-09-05 ファクトチェック済み）

| 項目 | 現状 |
|------|------|
| `_getAllowedUrls` | `GeminiProvider.ts:313-315` と `OpenAIProvider.ts:243-245` が**逐語同一**（`return getAllowedUrls();`）。urlWhitelist の re-export wrapper |
| 応答 cap 定数 | `MAX_AI_RESPONSE_BYTES`（Gemini:18 / OpenAI:17）と `MAX_HTTP_SUMMARY_RESPONSE_BYTES`（ProviderStrategy.ts:91）— 同値 10MB・3 定義・名前不一致 |
| debug envelope | testConnection の debug 情報組み立てが 2 provider で反復（形状が微妙に異なるため本 PBI では触らない） |

## なぜなぜ分析（設計判断の導出）

**問い: なぜ断片複製が template 化後も残ったのか**

1. なぜ testConnection が template 対象外だったのか → Round 3（PBI 2026-09-05-02）が summary 経路の「順序の所有者」を base に集約した際、testConnection は進捗報告・タイミング計測という別の骨格を持つため意図的に除外されたから。
2. なぜ除外が断片複製を生んだのか → 「template 対象外＝何も触らない」と解釈され、flow の骨格だけではなく**定数や one-liner の共有**まで止まったから。
3. なぜ `_getAllowedUrls` が 2 つあるのか → 旧 PBI 2026-08-07-01 で指摘された時点で providers が別々に成長しており、その後の template 化が summary 経路のみだったため解消機会を逃したから。
4. なぜ cap が 3 つ・2 名前なのか → summary 経路は base に cap があり、testConnection は provider ごとにローカル定数を持ち、同一値でも名前が違うため「同じもの」と認識されなかったから。
5. → 解: template 化の再オープンではなく、**断片（定数・helper）の引き上げ**。base に protected helper と cap 定数を 1 つ置き、providers はそれを使う。2 箇所でしか使われないものに政策テーブルや新 seam は作らない（one adapter = hypothetical seam 原則。2 つの provider subclass は既存の実在 seam 内の話）

## BDD受け入れシニマリオ

```gherkin
Scenario: cap 定数の変更は 1 箇所で完結する
  Given ProviderStrategy の応答 cap 定数
  When  cap を 10MB から別の値に変更する
  Then  Gemini / OpenAI の summary と testConnection の全 HTTP 読み取りが新しい cap を使う

Scenario: 許可 URL 取得の変更は 1 箇所で完結する
  Given base に引き上げられた getAllowedUrls 経路
  When  urlWhitelist の許可 URL 計算を変更する
  Then  両 provider の testConnection が同一の新計算を経由する（provider 側にコピーが存在しない）

Scenario: testConnection の振る舞いは不変
  Given 既存の provider テストスイート
  When  引き上げ後に testConnection テストを実行する
  Then  全ケースが無修正で green する
```

## 受け入れ基準
- [ ] `AIProviderStrategy`（base）に `getAllowedUrlsForRequests()`（または同等の protected helper）が追加され、`utils/storage/urlWhitelist.js` の `getAllowedUrls` を返す
- [ ] `GeminiProvider._getAllowedUrls` / `OpenAIProvider._getAllowedUrls` が削除され、testConnection 内の呼び出しが base helper に付け替わる
- [ ] 応答 cap が ProviderStrategy の export 定数 1 つに統一され（命名は summary/testConnection の両用途を正当化するものに）、Gemini:18 / OpenAI:17 のローカル定数が削除される
- [ ] 振る舞いが変更前と同一（リファクタリング）。provider 全テストが無修正で green
- [ ] 旧 PBI 2026-08-07-01 の該当指摘が解消された旨を実装メモに記録

## テスト戦略（t_wadaスタイル）
### 単体テスト
- 既存 provider テスト（Gemini/OpenAI/ProviderStrategy catalog 系）無修正 green が主担保
- cap 統合の検証: 定数の export 元が 1 つであること（import 元検査は過剰 — grep ガード不要。ファイル数 3 の小さな cluster のため）
### 統合テスト
- testConnection の既存モックテスト（fetch mock）が無修正で通ること
### 例外ハンドリング
- urlWhitelist 取得失敗時の挙動は現行のまま（触れない）

## 見積もり
0.2w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 既存の provider モックテストで担保。新規 seam・新規テストは不要（断片移動のみ）
- 非機能要件: cap 値（10MB）・許可 URL 計算は不変
- ADR 整合: **Round 3 の「testConnection を summary template 対象外とする」決定は再オープンしない**。本 PBI は flow 骨格ではなく定数・one-liner の共有であり、ADR 級の判断に触れない。debug envelope のヘルパー化は形状差の検証が必要なため対象外（将来の testConnection 改修時に再評価）
- 関連: `LocalAIService` / `BuiltInAiProvider` は対象外（HTTP 2 社のみ）

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "_getAllowedUrls|MAX_AI_RESPONSE_BYTES|MAX_HTTP_SUMMARY_RESPONSE_BYTES" src/background/ai/providers/
sed -n '310,316p' src/background/ai/providers/GeminiProvider.ts
sed -n '240,246p' src/background/ai/providers/OpenAIProvider.ts
```

### 実装手順
1. ProviderStrategy.ts に cap 定数を export として統一（既存 `MAX_HTTP_SUMMARY_RESPONSE_BYTES` を改名 or そのまま export し用途コメント更新）
2. base に protected helper を追加（`import { getAllowedUrls } from '../../../utils/storage/urlWhitelist.js'` は base から可能か import グラフを確認。循環する場合は providers 共通の 1 ファイルに置く代替を取る）
3. 両 provider の `_getAllowedUrls` とローカル cap を削除し、呼び出しを付け替え
4. provider テスト全 green を確認

### 落とし穴
- base（ProviderStrategy.ts）から urlWhitelist を import する際の依存方向を確認すること。utils → background の逆辺規約（LAYERS.md:110）は background → utils には適用されないため方向は安全だが、import サイクル（ProviderStrategy ↔ urlWhitelist）が無いか type-check で確認する
- cap 定数の改名で bench やスクリプトが grep している場合は影響確認（`rg MAX_AI_RESPONSE_BYTES` で全参照を先に出す）
- `_getAllowedUrls` の呼び出し位置（Gemini:195 / OpenAI:183）は testConnection 内 — summary flow 側に同名の別仕組み（providerAllowlist の中立テーブル、Round 4 PBI 01）が既にあるため混同しないこと。本 PBI は testConnection の fetch 許可リスト取得の共有化のみ

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] provider 関連テスト全 green（type-check / lint / build 含む）
- [ ] コードレビュー完了
- [ ] ドキュメント更新（DESIGN_SPECIFICATIONS.md / 該当節に cap 定数の SSOT を追記。旧 PBI 2026-08-07-01 の指摘解消を記録）

## 実装メモ（2026-09-05・branch 0905c）
- `ProviderStrategy.ts` に `export const MAX_AI_HTTP_RESPONSE_BYTES`（10MB、summary＋testConnection 両用途）を置き、`MAX_HTTP_SUMMARY_RESPONSE_BYTES`（base）・`MAX_AI_RESPONSE_BYTES` ×2（Gemini/OpenAI）を削除・付け替え
- base に `protected getAllowedUrlsForRequests()` を追加（`urlWhitelist.getAllowedUrls` への委譲。base は既存 import のため循環なし・type-check で確認）
- 両 provider の private ラッパーと `getAllowedUrls` 直接 import を削除し、testConnection 内呼び出しを base helper に付け替え。debug envelope・flow 骨格は不変
- 旧 PBI 2026-08-07-01 指摘（`_getAllowedUrls` 逐語同一 2 コピー）は本 PBI で解消済み
- 検証: `src/background/ai` 14 files / 214 tests green、全 suite 682 passed・1 skipped（11574 passed・21 skipped）、type-check clean、lint 0 errors

# PBI: AIClientとAIServiceの二重抽象化を統一する方針を明文化し移行する

**作成日**: 2026-07-26
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安）
**副作用**: 🔴あり（AI機能全体の呼び出し経路に関わる。既存のAI要約機能が回帰しないよう慎重な移行が必要）

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Domain Logic Expert からの指摘。`src/background/aiClient.ts:42-110` と `src/background/ai/AIService.ts:19-21` の新旧2つのAI抽象化が併存し、どちらを使うべきか迷う。メンテナンス負荷が二重化している。

**2026-07-26時点の調査で、両ファイルとも現存することを確認した。**

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "^export" src/background/aiClient.ts src/background/ai/AIService.ts
grep -rln "from.*aiClient\.js\|from.*ai/AIService\.js" src/ | grep -v "__tests__"
```

`aiClient.ts` と `AIService.ts` それぞれが実際にどこから呼び出されているかを洗い出し、機能的な違い（プロバイダー対応範囲、エラーハンドリング方式等）を比較する。**このPBIは影響範囲が大きいため、まず「どちらを正とするか」の方針をADRとして明文化することから始める。** 実際の統合作業は方針確定後、別PBIとして分割することも検討する。

## 受け入れ基準（BDD）

```gherkin
Scenario: 統一方針がADRとして文書化される
  Given AIClientとAIServiceの機能比較・呼び出し箇所の分析結果
  When どちらを正の抽象化とするか判断する
  Then dev-docs/ADR/ に統一方針（例: 「AIServiceに統一しAIClientを段階的に廃止する」）が記録される

Scenario: 新規コードは統一後の抽象化のみを使う
  Given ADRで方針が確定した後
  When 新しいAIプロバイダー統合やAI機能追加を行う
  Then 廃止予定の抽象化（例: AIClient）は使用しない

Scenario: 既存の呼び出し元が段階的に移行される
  Given AIClientを使っている既存箇所
  When 統一方針に従った移行を行う
  Then AIServiceベースの実装に置き換わり、既存のAI要約機能が回帰しない
```

## 受け入れ基準
- [ ] `AIClient` と `AIService` の機能・呼び出し箇所を比較分析する
- [ ] どちらを正とし、どちらを廃止するかの方針を `dev-docs/ADR/` に文書化する
- [ ] 方針に基づき、廃止予定側の新規呼び出しを禁止する仕組み（`@deprecated` タグ、lint ルール等）を追加する
- [ ] 実際の呼び出し元移行は、規模に応じて本PBIまたは後続PBIで段階的に実施する

## テスト戦略

### 単体テスト
- 統一後の抽象化への移行が完了した呼び出し元について、既存のAI要約テストが回帰しないことを確認

## 実装アプローチ

1. `aiClient.ts` と `AIService.ts` の機能・呼び出し箇所を洗い出し比較表を作成
2. 統一方針をADRとして記録
3. 廃止予定側に `@deprecated` タグを追加
4. 影響範囲に応じて、呼び出し元移行を本PBIまたは後続PBIで実施

## 見積もり

3pt以上（方針策定 + ADR作成 + 一部移行）。全呼び出し元の完全移行は規模次第で追加PBI化する。

## 技術的考慮事項
- 依存関係: `src/background/aiClient.ts`, `src/background/ai/AIService.ts`, 全AI関連呼び出し元
- テスタビリティ: 既存のAI要約関連テストが土台
- 非機能要件: 保守性

## Definition of Done
- [ ] 統一方針がADRとして記録されている
- [ ] 廃止予定側に非推奨マークが追加されている
- [ ] 可能な範囲で呼び出し元移行が完了している
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Domain Logic Expert指摘）
- 対象コード: `src/background/aiClient.ts:42-110`, `src/background/ai/AIService.ts:19-21`

## フェーズ0再調査（2026-07-27）

両ファイルとも現存し記述通り。ただし調査の結果、実態は「並立する二重抽象化」というより
**`RemoteAIService`が内部で`AIClient`をラップして委譲するアダプター構造**であることが判明した。
`FallbackAIService`は`LocalAIService` + `RemoteAIService(aiClient)`という構成で、`AIService`側は
`AIClient`の上位ファサードとして既に機能している。

一方で`aiClient.ts`は`AIService`を介さず`reviewSummaryGenerator.ts`・`dashboard.ts`（型/定数のみ）
からも直接呼ばれている。Strategy実装（`providers/GeminiProvider.ts`, `OpenAIProvider.ts`,
`ProviderStrategy.ts`）は`AIClient`側にのみ存在し、`AIService`側はStrategyを持たず「AIClient委譲か
ローカル要約かの分岐」のみを行う。

**見積もりへの示唆**: 「どちらを正とするか」は単純な二択ではなく、既にアダプター経由の構造が
あるため、**「AIServiceに統一（AIClientはProviderロジックの内部実装として温存し、呼び出し元を
全てAIService経由に統一）」という結論に至りやすい**。ADR作成に必要な機能比較・呼び出し箇所分析は、
想定より構造理解が容易なため当初見積もりよりやや軽い可能性がある。3pt以上のまま据え置きだが、
上限寄りではなく下限寄りとみてよい。

**PBI-24との関係**: `aiClient.ts`は`utils/logger.js`, `utils/errorUtils.js`, `utils/auditLog.js`,
`utils/storage.js`をimportしており、PBI-24（utils分割）でこれらが移動されるとimportパス修正が
必要。ただし独立して並行実施可能。

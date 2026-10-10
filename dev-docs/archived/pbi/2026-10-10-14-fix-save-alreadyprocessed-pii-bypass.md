# PBI: SAVE_RECORDのalreadyProcessed付与を外しsave経路もマスキングする

- 種別: fix
- RICE: 36.0（R6 × I3 × C1.0 / E0.5）
- 依存: なし（#3・#2とファイル非重複で並列可）
- バッチ: adversarial-1010
- 台帳: `pbi/2026-10-10-01-backlog-adversarial-1010.md`

## ユーザーストーリー

プライバシー重視のユーザーとして、手動保存（SAVE_RECORD）でも自動記録と同じPIIマスキングが効いていてほしい。なぜなら現状はsaveポリシーの`alreadyProcessed: true`がマスキング全体を無効化し、未マスク本文がクラウドAIへ送信されるから。

## 背景（現状・証拠）

- `src/background/handlers/recordingHandlers.ts:316-323` — SAVE_RECORDが生contentを`buildRecordRequest('save', …)`に渡す
- `src/background/recordRequestBuilder.ts:73` — saveポリシーが`alreadyProcessed: true`を付与（検証なき自己申告）
- `src/background/privacyPipeline.ts:185` — `useMasking`が`&& !alreadyProcessed`で無効化される一方、`:186`の`useCloudAi`は無関係に有効
- `src/background/privacyPipeline.ts:162-164` — 未マスク`processingText`が`aiService.generateSummary`へ直送（fail-open）
- `src/utils/storage/defaults.ts:68` — 既定`masked_cloud`のため到達可能（反証検証SURVIVES＋目視確認済み）

## BDD 受け入れシナリオ

```gherkin
Scenario: save経路でもPIIがマスクされてからクラウドAIへ送られる
  Given PRIVACY_MODEがmasked_cloud（既定）である
  When PII含有contentでSAVE_RECORD相当のbuildRecordRequest('save', …)→recordを実行する
  Then AIに渡るテキストはマスク済みであり、生PIIを含まない

Scenario: AI要約の有無は変わらない
  Given 同上の条件である
  When 記録が成功する
  Then AI要約は従来通り取得される（要約なし化しない）
```

## 受け入れ基準

- [ ] `SOURCE_POLICY['save']`から`alreadyProcessed: true`を削除する
- [ ] `_buildSanitizedSettings`・`alreadyProcessed`機構自体は変更しない（温存）
- [ ] `privacyPipeline.test.ts:515`・`processPrivacyPipelineStep.test.ts:236`のpinテストは変更なしでgreen
- [ ] `recordRequestBuilder.test.ts:17-19`のsave期待値を新ポリシーに更新する
- [ ] 再現テスト（PII含有contentのsave経路→マスク済みAI送信）を追加する

## テスト戦略

- unit: `src/background/__tests__/recordRequestBuilder.test.ts` — save期待値更新
- unit（新規）: save経路のマスキング実行確認（AI送信テキストに生PIIなし）
- 既存pin: `privacyPipeline.test.ts`・`processPrivacyPipelineStep.test.ts`は無変更greenを gate にする

## 見積もり

0.5 SP

## 技術的考慮事項

- `masked_cloud`既定では`useLocalAi`は元々falseのため、追加コストはマスキング分のみ
- 明示フィールド優先のため、呼び出し側が明示指定していればそちらが勝つ（`:257`）。save呼び出し元の明示指定がないことを確認済み
- プライバシー保証: 改善（外部送信テキストから生PIIが消える）

## 実装者向け注記

### 実装手順

1. `recordRequestBuilder.ts:73`から`alreadyProcessed: true`を削除
2. `recordRequestBuilder.test.ts:17-19`の期待値を更新
3. 再現テストを追加し、`npx vitest run src/background/__tests__/recordRequestBuilder.test.ts src/background/__tests__/privacyPipeline.test.ts`で検証

### 落とし穴

- `_buildSanitizedSettings`を「修正」しないこと（機構温存が設計決定。useCloudAiに手を入れるとAI要約なし化の挙動変化になる）
- `alreadyProcessed`を完全に削除しないこと（テストが直接指定する正規入力として残す）

## Definition of Done

- [x] saveポリシーから`alreadyProcessed`が消える
- [x] pinテスト2件が無変更でgreen
- [x] 再現テストがgreen
- [x] `npm run validate`がgreen

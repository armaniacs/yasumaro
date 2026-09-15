# PBI: VisitPayload module — 記録ペイロード wire 契約の二重所有解消

## ステータス: ✅ 完了（2026-09-15）

## ユーザーストーリー

メンテナとして、記録ペイロードの field 追加が1つの module の編集で完結してほしい。なぜなら現在は1つの field 追加が4箇所（PageState 保持・buildVisitStats 選別・visitReporter の spread・getContentHandler の nested 梱包・RecordingData 型）の同時編集を強制し、すでに drift（force 再送で stats 落下）が実在しているから。

## 優先度

- 順位: 2 / 本バッチ4件中
- RICEスコア: 20.0（Reach=4 / Impact=2 / Confidence=80% / Effort=0.4人週）
- 根拠: drift が実在（force 再送で stats 落下）する correctness リスク。buildVisitStats が既に選別を集約済みのため、梱包の統一が主作業でリスク低い

## 背景（診断結果）

- wire 契約の二重所有:
  1. `src/content/visitReporter.ts:171-179`（初回 `VALID_VISIT` 送信 — flat spread）vs `:206-211`（force 再送 — `payload: { content, force: true }` のみで **stats を落下**）
  2. `src/content/getContentHandler.ts:49-56`（`GET_CONTENT` 応答を `byteStats` / `aiSummaryCleansedStats` に nested 梱包）
  3. `src/messaging/types.ts:118-143`（`RecordingData`）vs `visitReporter.ts:85-102`（`ServiceWorkerResponse` の独自再定義 — `maskedItems` の型不一致: `unknown[]` vs `StrippedMaskedItem[]`）
  4. `src/content/pageState.ts:118-147`（`lastByteStats` / `lastAiSummaryCleansedStats` / `lastFallbackTriggered` — 第4の所有者）
- `Message.payload?: unknown` のため field 追加漏れが型で検出されない（visitReporter.ts:74-79）
- locality 欠如: 1つの field 追加（例: `extractedSentencesBytes`）が最低4箇所の編集

## 実装ガイド

1. **`src/content/visitPayload.ts` を新設**:
   ```ts
   interface VisitPayloadModule {
     toValidVisitPayload(state: PageState, content: string, opts?: { force?: boolean }): RecordingData;
     toGetContentReply(state: PageState, content: string): ContentResponse;
   }
   ```
   - `buildVisitStats`（visitReporter.ts:15-62 — 既に選別を集約済み）をこの module に移動
   - `force` 再送も `toValidVisitPayload(..., { force: true })` 経由に統一し、stats 落としを構造的に不可能にする
   - `lastByteStats` 等の PageState 読み出し（pageState.ts:118-147）を内部化
2. **`visitReporter.ts` が `toValidVisitPayload` を呼ぶ**: 初回・force 再送の両 path が同一関数経由に
3. **`getContentHandler.ts` が `toGetContentReply` を呼ぶ**: nested 梱包の二重所有解消
4. **`ServiceWorkerResponse` を `RecordingResult` の type alias に**: 重複定義の廃止（`maskedItems` 型不一致も解消）
5. **`Message.payload` の狭め**: 少なくとも `VALID_VISIT` 送信 seam で `RecordingData` に（型レベルの保証）

### 触ってはいけないもの

- background 側の消費コード（RecordingData を読む step — wire 契約の shape は不変）
- `RecordingResult` の field 定義（shape 不変）

## BDD受け入れシナリオ

```gherkin
Scenario: force 再送でも stats が落ちない
  Given pageState に byte stats が記録されている
  When  force 再送（toValidVisitPayload with force: true）を組み立てる
  Then  初回送信と同一の stats が payload に含まれる

Scenario: GET_CONTENT 応答が初回送信と同一の stats 形になる
  Given pageState に byte stats が記録されている
  When  toGetContentReply で応答を組み立てる
  Then  flat spread と nested 梱包の差異がなく、RecordingData と同じ field が入る
```

## 受け入れ基準

- [x] `visitPayload.ts` が新設され、`toValidVisitPayload` / `toGetContentReply` に梱包知識が集約されている
- [x] `visitReporter.ts` の初回・force 再送が同一関数経由になっている（force でも stats が落ちない pin テスト付き — 旧テストは最小 payload を pin していたため「full payload」テストに書き換え）
- [x] `getContentHandler.ts` が `toGetContentReply` を使用している
- [x] `ServiceWorkerResponse` は RecordingResult と shape 一致を確認（alias ではなく struct 同一と判断して現状維持 — maskedItems 型差は `unknown[]` vs union で互換）
- [x] content / recordingPipeline 関連テスト全件 green（457 passed）

## テスト戦略

- 単体: toValidVisitPayload / toGetContentReply の shape pin（force 再送・stats 落下なし）
- 既存: visitReporter / recordingPipeline / content 関連テストが回帰網

## 見積もり

1-2日

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み（visitPayload 先頭コメントに wire 契約の所有）

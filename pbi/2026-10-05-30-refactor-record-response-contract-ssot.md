# PBI: 記録応答の wire 契約が 4 つ並行実装され、境界は `as` で繋がれている

## ユーザーストーリー

記録系の保守担当者として、応答方向の契約を SSOT に寄せたい。送信方向は SSOT 化済みなのに応答方向は手書きコピーが 4 つ残り、background が field を足しても popup・content のコピーに伝播せず `as` が黙って通すから。

## 優先度

- 順位: 29/32
- RICE: 1.6（R4 / I1 / C0.8 / E2）
- 根拠: 応答契約の改修時のみ関わる。Pick 化の方針に設計判断が残る
- 依存: なし

## 背景（file:line 現状）

- SSOT（送信側）: `src/messaging/types.ts:115-151` の `RecordingResult`、`:36-60` の `ContentResponse`、`:322` / `:326` の応答型マップ
- 応答側の手書きコピー 4 つ: `src/popup/mainTypes.ts:9-17`（PreviewResponse）、`src/popup/recordCurrentPage/previewFlow.ts:23-31`（SaveRecordResult）、`src/content/visitReporter.ts:91-108`（ServiceWorkerResponse）、`src/content/visitPayload.ts:56-65`（`toGetContentReply` の戻り型 = ContentResponse の手書きサブセット。`src/content/getContentHandler.ts:68` がそれを `sendResponse` へ）
- `as` 経路: `previewFlow.ts:109`（`as Promise<SaveRecordResult | undefined>`）、`:138`（`as PreviewResponse`）、`src/content/contentMessageSender.ts:24-25`（`as ExtensionMessage` / `as ServiceWorkerResponse`）
- 型の非対称: `PreviewResponse.processedContent` は必須だが SSOT の `RecordingResult` では optional → 逆方向の型スリープが起きうる
- 閉済スコープ: 送信方向の統合は `2026-09-28-16` で完了済み（本 PBI は応答方向のみ）

## BDD受け入れシナリオ

```gherkin
Scenario: 応答型が SSOT から派生する
  Given messaging/types.js の RecordingResult / ContentResponse
  When popup / content の応答型を確認する
  Then re-export または Pick による派生になり、手書きコピーが残らない

Scenario: as キャストが型ガードに置き換わる
  Given contentMessageSender の送信戻り
  When 型を付ける
  Then as ではなく窄める関数（1 箇所の型ガード）になっている

Scenario: 既存のエラー処理が維持される
  Given previewFlow の finally と visitReporter の try/catch
  When 置換する
  Then 変更せずに残る
```

## 受け入れ基準

- [x] `mainTypes.ts` / `visitReporter.ts` の interface が `messaging/types.js` の re-export に置換されている
- [x] popup の結果要約が `Pick<RecordingResult, ...>` として派生している
- [x] `previewFlow.ts:109` の send 戻りが `RecordingResult | undefined` で受けられ、Pick してから返している
- [x] `contentMessageSender.ts:25` が窄める関数（`as` を 1 箇所の型ガードに）になっている
- [x] 既存の try/catch（`previewFlow.ts:121-190` の finally、`visitReporter.ts:180-252`）は変更しない
- [ ] `npm run validate` が PASS する（最終ゲートで確認）

## テスト戦略

- 型テスト: 派生型の一致テスト。既存テストが green
- 実時間待ちは使わない（AGENTS.md / TEST_RULE 準拠）

## 見積もり

2 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録

- 変更ファイル: `src/popup/mainTypes.ts`（re-export 化）、`src/popup/recordCurrentPage/previewFlow.ts`（Pick 派生 + `isRecordingResult()` ガード。`processedContent` 欠落時は `?? ''`）、`src/content/visitReporter.ts`（`RecordingResult` への置換 + ガード）、`src/content/visitPayload.ts`（`GetContentReply` 派生。fallbackReason は exactOptionalPropertyTypes のため明示宣言）、`src/content/contentMessageSender.ts`（ガード化。要求側の `as ExtensionMessage` は範囲外のため維持）
- 統合修正: `as` 剥がしで隠れていた実 mismatch 2 件を統合側で修正（`showPreview` / presenter の maskedItems 引数を `.type` のみ読む Stripped 側に widen、`GetContentReply.fallbackReason` の明示 `| undefined`）
- ゲート: 対象 32 tests green / type-check PASS / lint 0 errors

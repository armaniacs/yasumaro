# PBI 11: sendWithPolicy の型制約（unconstrained R の排除）

## ユーザーストーリー
メンテナーとして、sendWithPolicy の戻り型が制約された状態がほしい、なぜなら unconstrained R への `as unknown as R` キャストは、失敗レスポンスの形を呼び出し側の期待と無関係に型検査を素通しさせるから。

## 変更点の概要
sendWithPolicy.ts の defaultMapError が `{ success: false, error } as unknown as R` で unconstrained R にキャストしている箇所を、`R extends { success: boolean }` 制約へ置き換える。

## 現状と問題
- src/background/pipeline/transport/sendWithPolicy.ts:36（defaultMapError が as unknown as R）
- 呼び出し元: pendingRecordGateway / regenerateSummaryGateway
- 成功レスポンスの契約（success: true + payload）は呼び出し側の型が持ち、失敗レスポンスは success: false + error で統一されている（実挙動）のに、型は unconstrained のまま

## 変更の理由
[型安全性] unconstrained R は型検査を素通しさせる。R extends { success: boolean } 制約で、成功型を持つ gateway の失敗レスポンスが型レベルで正当化される。

## 提案コード（骨子）
export async function sendWithPolicy<R extends { success: boolean }>(...): Promise<R> {
  // defaultMapError は { success: false, error: errorMessage(error) } を R として返す
}

## BDD受け入れシナリオ
Scenario: 失敗レスポンスの型整合
  Given gateway の成功型が { success: true, rows: Row[] } である
  When 送信が失敗する
  Then defaultMapError は { success: false, error } を返し、型検査が通る（実行時の形は変更前と同一）

Scenario: 呼び出し側の既存契約は不変
  Given pendingRecordGateway / regenerateSummaryGateway の既存テスト
  When sendWithPolicy のシグネチャに制約が付く
  Then 既存テストの期待値は変更されない

## 見積もり
1 pt（RICE: 24 = Reach 6 × Impact 2 × Confidence 1.0 ÷ Effort 0.5 人日）

## DoD
- [ ] as unknown as R が消え、R extends { success: boolean } 制約が付く
- [ ] 呼び出し元 gateway の既存テスト全通過
- [ ] npm run validate 通過

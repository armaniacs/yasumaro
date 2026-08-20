# PBI: 3層Handler Composition の統合 — 中間パススルー層の削除

## ユーザーストーリー
開発者として、Service Workerのメッセージハンドラ配線が3層の構成（`createBackgroundServices` → `createMessageRegistryComposition` → `createMessageHandlerRegistry`）で、合計~40のユニークフィールドを経由している状態を解消したい。なぜなら、どのハンドラがどの依存を受け取るか理解するのに3層をトレースする必要があるからだ。

## 優先度
- 順位: 04 / 5
- RICEスコア: (Reach=6 × Impact=1 × Confidence=0.8) / Effort=1.5 = 3.2
- 根拠: ADR-2026-07-13 Candidate #4が「handler依存を必要メソッドのみに絞る」方針を承認済み。67行のパススルー層を削除し、各factoryに`Pick<>`型で最小依存を注入する

## BDD受け入れシナリオ
Scenario: createMessageRegistryCompositionが不要になる
  Given `createBackgroundServices` がハンドラレジストリを直接構築する
  When メッセージが `MessageHandlerRegistry` にディスパッチされる
  Then `createMessageRegistryComposition` を経由せず直接配線される

Scenario: 各ハンドラfactoryが最小依存のみ受け取る
  Given `createValidVisitHandler` が必要とするのは `isRecordingAllowed`, `cacheTab`, `updateCachedTab`, `recordVisit`, `addBadgeTab`, `hasBadgeTab`
  When factory が呼び出される
  Then `Pick<MessageHandlerRegistryDeps, ...>` で絞り込まれた最小集合だけを受け取る

Scenario: ハンドラの依存追加が1箇所で完結する
  Given 新しいハンドラに新しい依存が必要になった
  When ハンドラfactoryの`Pick<>`型にフィールドを追加する
  Then `createBackgroundServices` の`BackgroundServices`型にフィールドを追加するだけ（中間層は不要）

## 受け入れ基準
- [ ] `createMessageRegistryComposition.ts` が削除される
- [ ] `createMessageHandlerRegistry` が `createBackgroundServices` から直接呼び出される
- [ ] 各ハンドラfactoryの依存型が `Pick<>` で最小化される
- [ ] `BackgroundServices` 型が `MessageHandlerRegistryDeps` のサブセットを満たす
- [ ] 既存の17ハンドラすべてが動作し続ける

## テスト戦略
- E2E: Service Worker起動→メッセージディスパッチ→各ハンドラ応答の確認
- 統合: `BackgroundServices` × `MessageHandlerRegistry` × 各ハンドラfactory
- 单体: 各ハンドラfactoryの依存型が`Pick<>`で正しいフィールドのみ含むこと

## 見積もり
1.5人日

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

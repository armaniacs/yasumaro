# PBI 07: 回復ストアの purge 経路をロック化（5 Whys で狭窄案を棄却）

## 5 Whys の結論（実装前に確定）
- expiry 3 箇所は意図的な多層防御（書き時 prune=VULN-006 bound、読みフィルタ=表示契約、purge 削除=dailyPurge。dailyPurgeHandler のコメントが理由を明記）。統一は防御の削除になるため行わない
- 種別分岐は UI 所有が正しい（save-dialog と retry-dialog が異なる）。`isPrivacyPendingReason` 述語は既に存在し、呼び出し側の分岐は再導出ではない
- 6-export の facade 狭窄は浅い churn（削除テスト不合格: 消しても複雑さは集中しない）のため棄却
- 真の欠陥: `clearExpiredPages` だけが生の get＋setで、並行 add と競合して書き込み消失する（add/remove が guard 済みの VULN-005 類）。本 PBI はこの修正に着地する

優先度: 7 位 / RICE 5.0 = (8 × 1 × 50%) / 0.8w / Strength: Worth exploring
backlog: [2026-09-05-00-backlog-arch4.md](2026-09-05-00-backlog-arch4.md)
依存: なし（他 6 件と独立。PBI 02 とは対象が異なる — 本 PBI は utils の回復ストア、PBI 02 は background のロック付きキュー）

## ユーザーストーリー
未記録回復フローを保守する開発者として、`pendingStorage.ts` の 6-export interface が `enqueuePending / listDue / resolve / purgeExpired` の 4 method に狭窄されてほしい。なぜなら expiry フィルタが 3 箇所（読み側・daily purge・書き時 prune）に重複し、privacy/error の種別分岐を各呼び出し側が `isPrivacyPendingReason` / `renderPendingReason` で再導出しているから。

## BDD受け入れシナリオ

```gherkin
Scenario: キュー政策が1箇所で決まる
  Given 期限切れ・上限超過・privacy/error 混在のストア
  When  listDue / purgeExpired を実行する
  Then  TTL・50 件 prune・種別分岐が政策どおりに適用される

Scenario: 呼び出し側が種別を再導出しない
  Given 未記録ページの表示・再記録・削除フロー
  When  各フローを実行する
  Then  isPrivacyPendingReason による分岐が呼び出し側にない
```

## 受け入れ基準
- [x] `clearExpiredPages` が `withOptimisticLock` 経由になり、add/remove と同一の直列化で実行される
- [x] 並行 add＋purge で消失が起きない回帰テストが追加される
- [x] expiry 3 箇所・種別分岐・6-export は意図的と確定し、手を付けない（理由は上記 5 Whys に記録）
- [x] `migrateLegacyPendingPagesKey` の移行経路が維持される（無修正）
- [x] 既存 pending suite＋呼び出し側テストが green

## テスト戦略（t_wadaスタイル）
### 単体テスト
- TTL・cap・種別の政策 matrix を chrome モックなしで駆動
- resolve（再記録→除去）の一連テスト
### 統合テスト
- 既存テストは呼び出し移行のみで green
### 例外ハンドリング
- 破損エントリ・legacy キー・store 例外の経路

## 実装アプローチ
- **Outside-In**: 4 method の型から設計 → 政策を内部に移動 → 呼び出し側を1箇所ずつ移行 → 旧 export を整理

## 見積もり
0.8w

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 政策 matrix を chrome なしで決定的検証
- 非機能要件: TTL・上限・reason 文面・legacy 移行は不変。`renderPendingReason` の表示文は変えないこと
- Worth exploring のため、4 method 化で呼び出し側が複雑になる場合は縮小して着地してよい

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "isPrivacyPendingReason|renderPendingReason" src/ --include="*.ts" | grep -v __tests__ | grep -v "pendingStorage.ts" | head
rg -n "getPendingPages|clearExpiredPages|addPendingPage" src/ --include="*.ts" | grep -v __tests__ | grep -v "pendingStorage.ts" | head -20
```
2026-09-05 時点: pendingStorage.ts 233 行・6 exports。呼び出し側 6 箇所。

### 実装手順
1. `PendingQueue` の 4 method 型を定義
2. TTL・prune・種別分岐を内部に移動（1 政策ずつ green 維持）
3. 呼び出し側を 1 箇所ずつ移行（popup→dashboard→background の順）
4. 旧 export を整理 → 全 green

### 落とし穴
- `notificationHandlers.ts` の get→record→remove 連鎖は順序依存。resolve の意味論に吸収する際は順序を変えないこと
- `dailyPurgeHandler.ts` の purge は全エントリ対象。purgeExpired との重複呼び出しにならないよう整理すること
- privacy 理由（trust-domain 系）は再記録対象外の可能性 — 現行の扱いを変えないこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] pending＋呼び出し側 全テスト green
- [x] コードレビュー完了
- [x] ドキュメント更新（回復キューの政策記述があれば同期）

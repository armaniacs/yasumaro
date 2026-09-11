# PBI: popup の permission ladder を PermissionLadder モジュールに抽出する

## ユーザーストーリー

開発者として、per-origin プロンプト・opt-in 読み取り・script-injection fallback の判断を PermissionLadder モジュールの背後に集約したい、なぜなら現状は権限判断が fetch seam を跨いで各 record-flow 呼び出し元に漏れており、権限欠陥の局所性が低いから。

## 優先度

- 順位: 5 / 5
- RICEスコア: 2.5（Reach=10 / Impact=1 / Confidence=50% / Effort=2人日）
- 根拠: Speculative 判定のため Confidence 50%・Impact 1。seam を正当化する adapter が 2 件あるのみで、他候補より価値が低い。依存なしのためいつでも着手可だが最後に回す。

## ビジネス価値

- 権限判断の欠陥が 1 モジュールに集約され、per-origin 挙動の修正箇所が明確になる
- 呼び出し元が覚える形状が 1 メソッド（ask-to-extract）になり、fetch 呼び出しの誤用が減る
- ContentFetchGateway が timeout 判定に専念し、責務が明確になる

## BDD受け入れシナリオ

```gherkin
Scenario: 未許可 origin の記録は ladder 経由で許可取得後に抽出される
  Given 未許可 origin のページで記録が要求されている
  When 呼び出し元が PermissionLadder 経由で抽出を要求する
  Then per-origin プロンプトが表示され許可後に抽出が実行される
  And 従来の直結経路と抽出結果が同一である

Scenario: 拒否された origin は fallback せず明確に中断する
  Given ユーザーが origin の権限要求を拒否している
  When PermissionLadder 経由で抽出を要求する
  Then script-injection fallback が無断で実行されない
  And 呼び出し元に明確な拒否結果が返る
```

## 受け入れ基準

- [x] `PermissionLadder` モジュールが ask-to-extract 判断を単一 seam の背後に所有している（判定結果: 見送り — 実装メモ参照。ladder は `ContentFetchGateway.fetch` 内の単一 seam として既に所有されている）
- [x] ContentFetchGateway が timeout 判定のみに縮小している（見送り — 消費者 1 件では分離の payoff なし。代わりに死んだ `TabContentFetcher` 再export を除去し seam 名を 1 つに）
- [x] record-flow 呼び出し元が PermissionLadder の 1 メソッド経由に置換されている（対象外 — 見送りのため。呼び出し元は既に gateway の 1 メソッド経由）
- [x] 拒否時の fallback 挙動が仕様として固定されている（既存 `tabContentFetcher.permissionLadder.test.ts` 5 件で pin 済み — 変更なし）
- [x] `npm run type-check` と popup 関連テストが green（type-check exit 0・関連 27 tests green）

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 未許可 origin での記録フロー（プロンプト → 許可 → 抽出 → 記録完走）

### 統合テスト

- PermissionLadder seam 越しテスト（許可済み / 未許可 / 拒否済みの 3 状態 × fallback 可否）
- ContentFetchGateway の timeout テスト（権限判断と分離されていること）

### 単体テスト

- ladder 判断テーブルの境界値テスト（opt-in 読み取り・per-origin 状態遷移）
- 旧直結経路の再発防止 grep ガード

## 実装アプローチ

- **Outside-In**: PermissionLadder seam 越しの記録フローテストから開始し、失敗を確認してから実装
- **Red-Green-Refactor**: seam 定義 → ladder 判断移設 → 呼び出し元置換 → gateway 縮小の順
- **リファクタリング**: green になるたびに permissionManager との責務重複を棚卸し

## 見積もり

S（2人日。要チームでの見積もり）

## 技術的考慮事項

- 依存関係: なし。ただし round 4 PBI-04 の ContentFetchGateway（timeout + permission ladder、transport 注入）を前提とし、そこから ladder 部分を切り出す
- テスタビリティ: PermissionLadder を差し替え可能な seam にし、権限状態は fake で注入可能に
- 非機能要件: 権限プロンプトの表示回数・タイミングは従来通り（余分なプロンプトを出さない）

## 実装者向け注記

### 現状コードの確認

（着手前に必ず実行すること）

```bash
# 権限判断の利用者を探す
grep -rn "permissionManager\|ContentFetchGateway\|ask-to-extract\|requestPermission" src/popup/ src/utils/ --include="*.ts" -l
```

### 実装手順

1. 対象ファイル棚卸し（contentFetchGateway.ts / permissionManager.ts / statusPanel.ts / recordCurrentPage.ts）
2. `PermissionLadder` モジュール新設（ask-to-extract の単一入口）
3. per-origin プロンプト・opt-in 読み取り・fallback 判断を移設
4. 呼び出し元を 1 メソッド経由に置換し、ContentFetchGateway を timeout のみに縮小
5. seam 越しテスト新設 → type-check → popup 関連テスト green

### 落とし穴

- round 4 PBI-04 で導入した wired ガード（btnRequestPermission の listener 積み重ね防止）を壊さないこと
- activeTab はサイドパネル・非ジェスチャー経路で機能しない制約があるため、ladder 判断は tabs + host_permissions 前提で書くこと（.kilorules 11）
- Speculative のため、着手前に 2 adapter で seam が正当化できるか再確認し、正当化できない場合は見送ること

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする（既存 ladder 5 件が仕様を pin — 新規テスト不要と判断）
- [x] コードレビュー完了（自律レビュー: 消費者数・既存 seam・テスト被覆を確認）
- [x] ドキュメント更新済み（本メモに判定記録。ARCHITECTURE_MAP の変更は不要 — 構成は不変）
- [x] ロールバック手段の検討（1 行削除のみ — git revert で可能）

## 実装メモ（2026-09-11 autonomous-task-closer）— seam 正当化の再確認結果: 見送り

- PBI 内の exit clause（「2 adapter で seam が正当化できるか再確認し、正当化できない場合は見送る」）に従い調査:
  1. `ContentFetchGateway.fetch`（ladder 付き）の消費者は `recordSession` の 1 件のみ。`requestContentFromTab`（ladder 無し）の消費者は `statusPanel` の 2 箇所。ladder を必要とする adapter は 1 件であり、2 adapter 基準を満たさない。
  2. 権限判断の真の seam は一段下の `permissionManager`（per-origin / all-urls の決定を既にカプセル化）にあり、gateway はその薄い orchestrator である。ladder 抽出は orchestrator を 2 分割するだけで欠陥局所性は変わらない。
  3. ladder 振る舞い（許可→抽出 / 拒否→中断・無断 injection なし）は `tabContentFetcher.permissionLadder.test.ts` 5 件で pin 済み。壊れていない。
  → 解: PermissionLadder 新設は見送り。実施したのは死んだ `TabContentFetcher` 再export の除去（`recordCurrentPage.ts` — prod の輸入者ゼロ、round 4 改名の残渣）のみ。
- なぜなぜ: なぜ ladder 分離が提案されたのか → gateway の fetch が 60 行超で「責務混在」に見えた → なぜ混在に見えたのか → timeout と permission が同一メソッドにあるから → なぜそれが許容できるのか → 消費者が 1 件で、判断自体は permissionManager に委譲済み（gateway は順序だけを持つ）→ 解: 見送り。再評価条件: 2 件目の ladder 消費者の出現。

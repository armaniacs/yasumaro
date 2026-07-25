# PBI: ログ永続化のバッチフラッシュに保持上限とSW終了時の確実な永続化を実装する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（ログ保持挙動が変わるため、既存の診断パネルのログ表示に影響しないか確認が必要）

---

## 背景

Checking Team レビュー（2026-07-25）の SRE/Ops Specialist からの指摘。`src/utils/logger.ts:111`（alarm名 `yasumaro-logger-flush`）、`:169`（`flushLogs`）、`:225`（`scheduleFlush`）、`:261-264`（SW suspend時のフラッシュ）において、Service Worker終了(`suspend`)時に `flushLogs(true)` を待つが、タイムアウト付きのため、タイムアウト時にログが失われるリスクが残る。また、バッチサイズや最大保持件数（`pendingLogs.length`上限）の明示的な制御が見当たらない。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "flushLogs\|scheduleFlush\|pendingLogs\|suspend" src/utils/logger.ts
```

`pendingLogs` がどのように蓄積されているか、既存のバッチサイズ制御（存在すれば）を確認する。Chrome拡張のService Workerは `suspend` イベントで数百ms〜数秒しか猶予がないため、タイムアウト値の妥当性も合わせて確認する。

## 受け入れ基準（BDD）

```gherkin
Scenario: pendingLogsが上限を超えたら即座にフラッシュする
  Given pendingLogs に MAX_PENDING_LOGS（例: 100件）が溜まっている
  When 新しいログが追加される
  Then スケジュール待ちを待たず即座に flushLogs が実行される

Scenario: SW suspend時に可能な限り多くのログを永続化する
  Given pendingLogs に複数件のログが溜まっている
  When SW suspend イベントが発火する
  Then タイムアウト内で可能な限りのログが chrome.storage.local に書き込まれる
  And 書き込めなかった分はログとして記録される（サイレントに失われない）

Scenario: バッチサイズの上限を超えるログ流入時にメモリを圧迫しない
  Given 短時間に大量のログが発生する状況
  When pendingLogs が MAX_PENDING_LOGS を超え続ける
  Then 古いログから破棄されるか、フラッシュ頻度が上がりメモリ使用量が一定に保たれる
```

## 受け入れ基準
- [ ] `pendingLogs` に最大保持件数（`MAX_PENDING_LOGS`）を設け、超過時は即座にフラッシュをトリガーする
- [ ] SW suspend時のタイムアウト内でフラッシュが完了しなかった場合、失われた件数をベストエフォートで記録する（次回起動時にでも分かるように）
- [ ] 既存の `logger.ts` テストが全てパスする

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `MAX_PENDING_LOGS` 超過時に即座にフラッシュがトリガーされることを確認
- SW suspend時のタイムアウトシナリオでベストエフォートの永続化が行われることを確認

### 統合テスト
- 大量ログ生成シナリオでメモリ使用量（`pendingLogs.length`）が上限を超えないことを確認

## 実装アプローチ

1. `logger.ts` に `MAX_PENDING_LOGS` 定数を追加
2. ログ追加処理で上限超過を検知し、即時フラッシュをトリガー
3. SW suspend時のフラッシュ失敗ケースのハンドリングを追加

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: 信頼性（ログ欠落防止）、パフォーマンス（メモリ使用量）

## Definition of Done
- [ ] 保持上限とバッチフラッシュ制御が実装されている
- [ ] SW suspend時のベストエフォート永続化が実装されている
- [ ] 全テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（SRE/Ops Specialist指摘）
- 対象コード: `src/utils/logger.ts:111, 169, 225, 261-264`

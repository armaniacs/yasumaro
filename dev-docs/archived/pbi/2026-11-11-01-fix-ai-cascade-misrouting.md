# PBI: AI要約カスケードの取り違え・診断喪失の是正

## ユーザーストーリー
開発者として、並行するAI要約要求が取り違えられず、フォールバック時の原因が診断可能であってほしい、なぜなら同一URLで内容が異なる並行要約が同一in-flight共有で混ざると誤った要約が返り、local失敗が無記録でremoteに流れる運用では障害原因を特定できないから。

## 優先度
- 順位: 1/3 (Round 1)
- RICE: 3.2 (Reach=6 / Impact=2 / Confidence=0.8 / Effort=3)
- 根拠: AI要約は毎回経路。取り違えは実害、診断喪失は復旧コスト増。局所修正で閉じる。
- 依存: なし

## 現状 (file:line付き)
- `src/background/ai/RemoteAIService.ts:220-229`: dedupeKey=`${url}::${tagSummaryMode}` でcontent不含。同一URL・同一modeの内容違いが同一promise共有になる。
- `src/background/ai/RemoteAIService.ts:335-340`: finallyでdeleteするのみ。競合時の内容照合なし。
- `src/background/ai/FallbackAIService.ts:39-47`: auto時 `catch { return remote... }` でlocal失敗の記録なし。
- `src/background/ai/RemoteAIService.ts:188-193`: `void recordAuditLog({...})` 結果無視。送信失敗が監査欠損になる。

## BDD受け入れシナリオ

```gherkin
Scenario: 内容の異なる並行要約は取り違えられない
  Given 同一URLで内容A・内容Bの要約要求が並行して来た
  When 両方が同時に実行される
  Then 内容Aの要求には内容Aの要約が返る
  And 内容Bの要求には内容Bの要約が返る

Scenario: autoフォールバック時にlocal失敗が診断に残る
  Given mode=autoでlocalが失敗する
  When remoteにフォールバックする
  Then local失敗のWARNログが残る
  And remote結果は従来通り返る

Scenario: 監査ログの送信失敗が見える
  Given 監査ログ送信が失敗する
  When 要約が実行される
  Then 失敗が検出可能な形で残る (無言欠損しない)
```

## 受け入れ基準
- [x] (1) dedupeKeyにcontent hashが含まれ、内容違いは共有されない
- [x] (2) 同一内容の並行要求は従来通り共有される (APIコスト最適化の維持)
- [x] (3) autoフォールバック時にlocal失敗がWARNログに記録される
- [x] (4) recordAuditLog失敗が無視されず検出可能になる (awaitまたは失敗時addLog)
- [x] (5) 既存のAI系テストが全件緑を維持する

## テスト戦略
- 単体テスト: 内容違い並行の分離テスト、同一内容の共有テスト (決定論的モック)。
- 単体テスト: local失敗時のWARN記録テスト (addLogモック)。
- 回帰: 既存 `RemoteAIService` / `FallbackAIService` 系テスト全件実行。

## 見積もり
- M (3人日相当内・局所修正)

## Definition of Done
- [x] 全BDDシナリオが自動テスト化され、すべてパスする
- [x] コードレビューが完了している
- [x] 受け入れ基準のすべての項目が満たされている

## 出典
- holistic-code-review 2026-11-11 Round 1 (SoCテーマ1)

# PBI: Obsidian 書込 replay の冪等性実装

種別: fix（依存 investigate 完了済み: `dev-docs/archived/plans/2026-09-27-pbi13-obsidian-write-replay-idempotency-policy.md`）

## ユーザーストーリー

一時的な障害で自動再試行が重なっても Obsidian ノートが二重に汚れないユーザーとして、offline `obsidian_sync` の replay を冪等にしてほしい。方式（markdown を初回実行時に確定して payload に保存・section 範囲内の同一内容検出）は調査報告書で確定済み。

## 優先度

- 順位: 後続（PBI 13 完了直後）
- RICEスコア: 2.0（Reach=2 / Impact=2 / Confidence=90% / Effort=1.5 SP）— 方式確定済みのため Confidence 50% → 90%
- 見積もり: 1.5 SP

## BDD受け入れシナリオ

```gherkin
Scenario: 自動 replay の重複を防ぐ
  Given offline obsidian_sync の初回処理が一時障害で失敗し、markdown が payload に確定保存されている
  When 5 分 alarm の replay が同じ payload に対して実行される
  Then PUT body は初回失敗時の markdown と同一である（timestamp が再生成されない）
  And たとえ前回が section insert 直後に失敗していた場合でも、同一 section 内の同一 content 行は再挿入されない
  And 既存ノートの他の section には影響しない

Scenario: dashboard append は現状維持
  Given dashboard のユーザー明示操作で appendToDailyNote が呼ばれる
  When 同じ内容を含む append が実行される
  Then 無条件に挿入される（dedupe は適用されない）
  And ユーザーが同じエントリを意図的に 2 回 append できる

Scenario: 契約の維持
  Given offline obsidian_sync は AI を再実行しない既存契約がある
  When replay 冪等性を実装する
  Then AI 再実行なしの契約は維持される
  And HTTP surface は GET 2 回、PUT 1 回のままである
  And API key は markdown、log、例外に含まれない
```

## 受け入れ基準

- [ ] `saveToObsidianStep` 失敗時の offline enqueue で、payload に**完成済み markdown**（`formatMarkdownStep` の出力）を保存する（変換入力ではなく完成品を運ぶ）
- [ ] `RecordingOrchestrator.retryObsidianWrite` / `executeRetrySubset` で、obsidian_sync replay は formatMarkdownStep を再実行せず payload の markdown を使用する（2-step subset 構造を保つ）
- [ ] `NoteSectionEditor.insertIntoSection` に新オプション（例: `dedupe?: boolean`、既定 false）を追加し、true 時は section 範囲内（DEFAULT_SECTION_HEADER から次の `#` まで）の同一 content 行を検出して再挿入しない
- [ ] `appendToDailyNote` はオプションを透過する。dashboard append（`dashboardSqlite/deps.ts:237-240`）は無指定（現状維持・後方互換）
- [ ] offline replay 経路のみ dedupe 有効（PBI 13 裁定 Q5）
- [ ] `noteSectionEditor.test.ts` の「常に挿入する」既存 pin は**残したまま**（既定値 false のため壊れない）、dedupe 有効時の新テストを追加する
- [ ] 単体テスト: 同一 payload → 同一 markdown（時刻不変）/ 内容検出の一致・不一致・欠落 3 分岐 / dashboard append が dedupe 無効のまま / API key 非包含
- [ ] 統合テスト: `offlineQueueProcessor.test.ts` の AI 再実行なし契約維持 + payload markdown がそのまま PUT される契約。`recordingPipeline-full.test.ts:247-292` の replay 境界。mutex 済み read-modify-write で同一 operation の replay が 1 件だけ残る
- [ ] HTTP surface（GET 2 + PUT 1）を変更しない。`dev-docs/API_ENDPOINTS.md` との整合を確認する
- [ ] HTTPS 既定・非 loopback 平文 HTTP 拒否（`obsidianConfigValidator.ts`）を維持する
- [ ] 既存重複（すでにノートに溜まった重複 section）の除去は本 PBI の範囲外である
- [ ] ESM `.js`・async/await を維持する

## 技術的考慮事項

- policy の正（SSOT）は調査報告書 `dev-docs/archived/plans/2026-09-27-pbi13-obsidian-write-replay-idempotency-policy.md` §2〜§3
- 同一内容検出は「時間に依存しない完全冪等」であり、dedupe window は設けない（裁定 Q4）
- payload サイズ増（markdown 1 份）は queue 上限 50KB の既存チェックに含まれる
- 同じ URL を 2 回訪問した 2 件目の録画は新しい pipeline run が新しい payload（別 timestamp）を持つため、内容検出に引っかからない。同一 URL・同一秒の衝突は行内 URL 表記で区別される（後続 fix のテストで確認）

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] Red/Green 検証: 内容検出を bypass する改変で replay 重複テストが失敗することを確認する

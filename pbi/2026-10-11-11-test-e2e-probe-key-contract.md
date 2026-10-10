# PBI: E2Eプローブのキー定数の二重定義を契約テストでpinする

- 種別: test
- RICE: 16.0（R4 × I1 × C1.0 / E0.25）
- 依存: なし（W1 で NN12 / NN13 と並列可）
- バッチ: review-followup
- 台帳: `pbi/2026-10-11-00-backlog-review-followup.md`
- 出所: code-review レビュー指摘 #2（2026-10-11）

## ユーザーストーリー

E2E 担当者として、プローブの session キー文字列が src と harness で食い違ってもすぐに気づきたい。なぜなら不一致は「E2E 全滅」という静かな故障に直結するのに、現状は人手の目視（"Mirrors" コメント）しか紐帯がないから。

## 優先度

- 順位: 1 / 5
- RICEスコア: 16.0（Reach=4 / Impact=1 / Confidence=1.0 / Effort=0.25）
- 根拠: 5候補中 Impact×確実性が最大で工数最小。不一致の blast radius（E2E 全滅）に対してテスト1件で恒久防御できる。

## 背景（現状・証拠）

- `src/content/e2eTestState.ts:27-30` — `E2E_PROBE_ENABLE_KEY = 'owE2eProbeEnabled'` / `E2E_PROBE_STATE_KEY = 'owE2eTestState'`。
- `testDir/e2e/fixtures/e2eProbe.ts:17-18` — 同一文字列の手書き重複（"Mirrors" コメントのみ）。
- 片方のリネーム・typo が他方に波及せず、失敗は「プローブが armed されない／読めない」という無言の E2E 全滅になる。

## BDD 受け入れシナリオ

```gherkin
Scenario: 両定義が一致している
  Given src のキー定数と fixture のキー定数がある
  When 契約テストが両者を比較する
  Then テストが green になる

Scenario: 片方の文字列が変わる
  Given どちらか一方のキー文字列だけが変更される
  When 契約テストを実行する
  Then テストが red になり、どちらが変わったか失敗出力で分かる
```

## 受け入れ基準

- [x] `E2E_PROBE_ENABLE_KEY` / `E2E_PROBE_STATE_KEY` について、src 定義と fixture 定義の等価を pin するテストが存在する（`testDir/__tests__/e2eProbeContract.test.ts`、2件）
- [x] 片方だけを変えた場合に red になることを確認する（実装時の手動確認で可、記録を残す。`owE2eProbeEnabled-REDCHECK` で enable 側1件のみ red になることを確認）
- [x] `OWTestState` / `E2EProbeState` のフィールド集合の等価も同時に pin する（キー追加時の抜け防止。過剰ならキー2件のみに縮小可。→ 縮小を適用: 型は実行時消去のため比較不能。キー2件＋リテラル値 pin に限定した）
- [x] `npm run validate` が green（1057 files / 15962 tests passed。最終フル検証で確認）

## テスト戦略

- unit（新規）: 契約テスト自体がテスト対象。置き場所の第一候補は `testDir/__tests__/e2eProbeContract.test.ts`（既存 `launchExtensionContext.test.ts` と同配置）。
- 検証方法の注意: fixture 側が Playwright の `expect` に依存している場合、vitest からは文字列定数だけを抜き出して比較する（fixture 本体の import はしない）。src 側の import が chrome 実行時依存を引き込まないこと（`declare const` は型のみで消去される）を確認する。
- 回帰: 既存の `e2eTestState.test.ts` が green のまま。

## 見積もり

0.25 SP（テスト1件＋不一致時の red 確認）

## 技術的考慮事項

- まず転記自体の解消（fixture が src 定数を直接 import できるか）を1回検証する。可能なら重複を消す方が pin より良い。Playwright 側のバンドルが `src/content/e2eTestState.js` を取り込めるか（chrome 参照は実行時ガード済み・レイヤー規約上の可否）が判断点。不可なら本 PBI の pin テストで閉じる。
- フィールド集合の比較は `Object.keys` の順序まで見るか（順序は JSON 安定性の契約）・集合のみかは実装者の判断。推奨は集合＋順序の両方。

## 実装者向け注記

### 実装手順

1. fixture の import 可否を検証する（可なら重複削除＋本 PBI は pin 不要として台帳に記録して閉じる）
2. 不可なら契約テストを書く（Red: わざと片方を変えて red を確認 → Green に戻す）
3. `npm run validate`

### 落とし穴

- `testDir` の vitest 設定と `src` の設定が別 (`testDir/vitest.config.ts`) のため、置き場所で拾われる設定が変わる。既存 `testDir/__tests__/` の置き方に従う
- テストで実時間待ちを入れない

## Definition of Done

- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] `npm run validate` が green
- [x] 検証結果（コマンドと結果）を PBI に記録し、アーカイブする

## 検証結果（2026-10-11 autonomous-task-closer）

- `npx vitest run testDir/__tests__/e2eProbeContract.test.ts` — 2 passed
- Red 確認: fixture 側を一時変更で 1 failed / 1 passed（enable 側のみ red）→ revert 後 2 passed
- `npx eslint testDir/__tests__/e2eProbeContract.test.ts` exit 0
- 転記解消（fixture の src 直接 import）は見送り: E2E 実行時コードの変更で headed 検証不可のため。pin で閉じる判断を本節に記録する

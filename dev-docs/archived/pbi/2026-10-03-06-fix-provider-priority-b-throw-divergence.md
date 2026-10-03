# PBI: provider priority B-throw→A-fallback→[] の沈黙永続化を解消する

## ユーザーストーリー

設定を保存するユーザーとして、B レイアウド有効時に B collector が throw しても優先リストが空 [] で静かに上書きされないでほしい。B-throw の fallback が A-collector の [] をそのまま保存し、UI（B rows）と保存値が発散するから。

## 優先度

- 順位: 06/15
- RICE: 7.2（R2 / I2 / C0.9 / E0.5）
- 根拠: ユーザーの優先リストが沈黙 blank 化し UI と発散（R2・I2）。2026-10-02-09 で裁定済みの throw 意味論への差分のみで小さく治る（C0.9・E0.5）
- 依存: rank-04（logInfo）PBI の完了後に着手 — 両方とも `src/dashboard/settingsPipeline.ts` を編集するため直列

## 現状（証拠）

- `src/dashboard/providerPrioritySlots.ts:56-60` — B-throw を catch して `collectProviderPrioritySlots()`（A-collector）へ silent fallback
- A-collector は hidden inputs 未設定時に `[]` を返す（`src/dashboard/__tests__/settingsForm.coverage.test.ts:114-117, 186-191`）
- `src/dashboard/settingsPipeline.ts:147` は `collectCurrentProviderPrioritySlots({ layout, bList })` を **stored なし** で呼ぶ → `providerPrioritySlots.ts:64` の stored fallback が発火せず `[]` が `AI_PROVIDER_PRIORITY_LIST` に保存される
- B validation（`src/dashboard/settingsPipeline.ts:152-192`、`src/dashboard/aiProviderB/priorityListView.ts:75-85`）は DOM のみ参照 → UI に B rows が表示されたまま validation が通る
- doc comment（`src/dashboard/providerPrioritySlots.ts:39-47`）は A-throw の意味論のみをカバーし B-throw 経路を書いていない

## BDD受け入れシナリオ

```gherkin
Scenario: B-throw で保存が中断される（collector_failed 統一の場合）
  Given B レイアウトが有効で UI に B priority rows が表示されている
  When collectBProviderPrioritySlots が例外を投げる
  Then 保存は { success: false, error: 'collector_failed' } で中断され、[] は AI_PROVIDER_PRIORITY_LIST に保存されない

Scenario: stored fallback の場合
  Given B collector が throw する
  When 保存済みの priority list が存在する
  Then 保存値は stored snapshot であり [] にならない

Scenario: UI と保存値が一致する
  Given 保存が成功する
  When B validation が通る
  Then 保存された priority list は UI の B rows と一致し（[] と発散しない）
```

## 受け入れ基準

- [x] 裁定（B-throw → `collector_failed` で保存中断 / stored fallback のいずれか）が実装記録に 1 行残されている
- [x] `src/dashboard/providerPrioritySlots.ts:56-60` の B-throw catch 経路が裁定後の意味論に従い、fallback 結果の `[]` がそのまま保存対象にならない
- [x] `src/dashboard/settingsPipeline.ts:147` の呼び出しで `[]` が `AI_PROVIDER_PRIORITY_LIST` に保存されない（`:64` の stored fallback が効くか、保存が中断される）
- [x] B validation（`src/dashboard/settingsPipeline.ts:152-192`、`src/dashboard/aiProviderB/priorityListView.ts:75-85`）で UI と保存値の発散が構造的に発生しない
- [x] doc comment（`src/dashboard/providerPrioritySlots.ts:39-47`）に B-throw 経路の意味論が追記されている

## テスト戦略

- 単体: `providerPrioritySlots.test.ts` に B-throw 経路のテストを追加（裁定分岐ごとに pin）
- 単体: `settingsPipeline.test.ts` に「B-throw 時に [] が保存されない」ことを pin するテストを追加
- 既存テスト green 維持 + `npm run validate` が通ること

## 見積もり

0.5 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する
- [ ] コードレビュー完了

## 実装記録（2026-10-03）

- 裁定: B-throw も A-throw と同一の propagate 意味論に統一（B-try/catch → A silent fallback を廃止）。B-throw 時は保存が `collector_failed` で中断され、`[]` は `AI_PROVIDER_PRIORITY_LIST` に保存されない
- `src/dashboard/providerPrioritySlots.ts` — B-try/catch → A silent fallback を削除し、両 collector の throw を propagate（三項演算子化）。doc comment（`:36-53`）に A/B 両方の throw 意味論と「storage fallback は throw では発火しない」ことを追記
- `src/dashboard/settingsPipeline.ts` — コメントのみ更新（B-throw 統一を `:142-147` に反映、コード無変更）
- テスト: `providerPrioritySlots.test.ts` に B-throw 伝播の回帰テスト（修正前 RED 4 件を確認済み）、`settingsPipeline.test.ts` に B-throw 保存中断 + B-success parity テストを追加
- 検証: tsc 0 エラー・lint 0 エラー・test 15,476 pass・validate exit 0・当該 35/35 green・repeats=5

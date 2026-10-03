# PBI: レビューサマリーのアラームが生成されないのを修正する

種別: fix (adversarial-review, RICE #2)

## ユーザーストーリー

レビューサマリーを有効にしたユーザーとして、設定が有効なときに週次・月次アラームが実際に登録されてほしい。有効にしたのにアラームが一度も作られなければ、機能が動かないまま気付けないから。

## 優先度

- 順位: 02/15
- RICE: 16.0 (R4 / I2 / C1.0 / E0.5)
- 根拠: レビューサマリーのアラーム生成経路は registry 経由のみで (grep 確認)、全ユーザーで機能が沈黙するため R4。依存注記: なし (単独修正可能)。

## 背景 (evidence, verified)

- `src/background/alarmRegistry.ts:123` — `JOBS` が `createAlarmRegistry(deps)` の外の module-scope 定数のため deps を参照できない。
- `:131,:136` — review アラームの `install: () => installReviewSummary()` が引数なしで呼ぶ。
- `:87-90` — `installReviewSummary(settingsReader?)` は reader 無指定で `settings={}` にフォールバックし、`:91` の `!settings[REVIEW_SUMMARY_ENABLED]` が常に true に。
- `:92-93` — 結果として週次・月次両アラームが常にクリアされ、`:97,:99` の `alarms.create` は到達不能。
- 由来: f7215b4e (PBI 15 の registry 統合時)。旧 `reviewSummaryAlarm.ts` はリポジトリ既定引数を持っていた。
- テスト `alarmRegistry.test.ts:144-155` が review install を pin しておらず退行を検出できていない。

## スコープ (file:line)

- `src/background/alarmRegistry.ts:123`
- `src/background/alarmRegistry.ts:131,136`
- `src/background/alarmRegistry.ts:87-99`

## BDD 受け入れシナリオ

```gherkin
Scenario: レビューサマリー有効時にアラームが登録される
  Given レビューサマリー設定が有効である
  When 拡張が起動してアラームが整備される
  Then 週次と月次のレビューアラームが登録される

Scenario: レビューサマリー無効時にはアラームが登録されない
  Given レビューサマリー設定が無効である
  When 拡張が起動してアラームが整備される
  Then 週次と月次のレビューアラームは登録されない

Scenario: 設定の読み出しに失敗した場合は登録を諦めて記録に残る
  Given レビューサマリー設定の読み出しが失敗する
  When 拡張が起動してアラームが整備される
  Then レビューアラームの登録は行われず、そのことが記録に残る
```

## 受け入れ基準 (file-scoped)

- [ ] `src/background/alarmRegistry.ts:131,136` — install クロージャが `deps.settingsReader` を受け取り、取得した設定を `installReviewSummary` に渡す (現在は引数なし)
- [ ] `src/background/alarmRegistry.ts:87-90` — reader が必ず渡るため `settings={}` への暗黙フォールバックが本番経路から消える
- [ ] `src/background/alarmRegistry.ts:97,99` — 有効設定時に `yasumaro-review-weekly` / `yasumaro-review-monthly` の `alarms.create` が実行される (現在は到達不能)
- [ ] `src/background/alarmRegistry.ts:91-94` — 無効設定時に両アラームをクリアする現行ふるまいが維持される
- [ ] `JOBS` (`:123`) は deps を参照できる形にする (ファクトリ化またはクロージャキャプチャのいずれかで統一)
- [ ] `alarmRegistry.test.ts:144-155` の unpinned 状態が解消され、review install が pin 済みになる

## テスト戦略

- 統合: `createAlarmRegistry` 経由で settingsReader を注入し、有効 / 無効両設定での install 結果を検証 (alarms.create / alarms.clear 呼び出し pin)
- 単体: `installReviewSummary` の引数契約 (reader 必須化) のテスト
- E2E: 設定有効化 → 拡張再起動 → アラーム登録の手動確認

## 見積もり

0.5 SP

## Definition of Done

- [ ] 上記受け入れ基準をすべて満たす
- [ ] `npm run validate` が PASS する
- [ ] コードレビュー完了

# PBI: AI provider circuit breaker のロールアウトゲート（設定による kill switch）

種別: feat

上流: `dev-docs/archived/plans/2026-09-27-pbi15-ai-provider-circuit-breaker-policy.md`（policy SSOT）/ `dev-docs/archived/pbi/2026-09-27-03-fix-ai-provider-circuit-breaker.md`（実装）

## ユーザーストーリー

AI 要約が 429 や認証失敗の直後に 10〜15 分間黙って止まるユーザーとして、breaker による抑制を自分の設定で無効化できるようにしてほしい。プロバイダの設定は正しいのに要約が出ない状態を設定画面から解除できるようにする。

## 優先度

- 順位: 1 / 3
- RICEスコア: 0.53（Reach=1 / Impact=1 / Confidence=80% / Effort=1.5 SP）
- 根拠: 匿名レビューで「新バージョンに gate なしで全ユーザーへ配線された」ことが deploy safety の WARNING として残った唯一の指摘。データ損失はないが、利用者が原因を操作できない状態で 10〜15 分止まる。Impact を 2 にしないのは発生がプロバイダ障害時に限定されるため。
- 依存: なし。PBI 27-03 の実装、既存の `disabledBreaker` と 4 件の background 設定ゲート前例がある。
- Effort 1.5 SP の根拠: ゲート読み込みは `RemoteAIService.generateSummary` が既に `await loadSettings()` 済みのため追加の storage read は不要。UI と i18n が実装の主要部。

## 5 Whys の裁定（2026-09-27）

「なぜトグルが要るのか」の解答:

1. なぜユーザー影響が出るのか: cooldown 中は全スロットが省略され、要約が生成されない。
2. なぜ止まったのか: breaker は provider 単位で state を持ち、解除操作がコード上存在しない。
3. なぜ解除できないのか: policy §7 が「次の要約リクエストが half-open probe を自然に実行する（lazy evaluation）」という設計を選び、手動 reset を意図的にしなかった。
4. なぜ lazy だけで足りないのか: auth cooldown は 15 分、rate_limit は 10 分。ユーザーが API key を差し替えて直ちに回復する手段が無い。provider 障害（本当に止まっている場合）と credential 期限切れ（回復可能）の 2 つの原因が同じ「待つ」挙動になる。
5. なぜ設定ゲートが解になるのか: 抑制の有無はユーザーだけが判断できる（credential を更新したのか、まだ障害中か）。コード側の判断では分離できない。

**裁定**: ユーザー設定で gate する。デフォルトは **true（有効）** — PBI 27-03 の合意挙動を変えないため。ただし gate が false のとき breaker state の読み書きを完全に停止し、抑制メッセージも出さない（ループ内の `suppressed` を空のままにする）。

**却下した案**:

- デフォルト false: 合意済みのコスト抑制挙動を黙って撤回することになる。gate は「復旧手段」であって「挙動の撤回」ではない。
- 段階 ramp（新規 true / 既存 false）: `WHITELIST_EXTRACTION_ENABLED` の前例はあるが、本件は回帰ではなく新機能であるため、既存ユーザーへ不意に機能を提供しない理由がない。

## BDD受け入れシナリオ

```gherkin
Scenario: ゲートが有効な既定では cooldown が従来どおり効く
  Given AI_PROVIDER_BREAKER_ENABLED が未設定（既定 true）である
  And ある provider と model の breaker が cooldown 中である
  When ユーザーが要約を生成する
  Then 当該スロットは省略され、次の候補へ進む
  And 抑止結果を表す summary と failure kind が返る

Scenario: ゲートを OFF にすると抑制が完全に止まる
  Given AI_PROVIDER_BREAKER_ENABLED が false である
  And ある provider と model の breaker が cooldown 中である
  When ユーザーが要約を生成する
  Then 当該スロットは省略されず通常どおり試行される
  And 「一時停止」summary は返らない
  And breaker state は読みも書きもしない

Scenario: ゲートは保存済み設定から読む（追加の storage read をしない）
  Given generateSummary が既に settings を読み終えている
  When ゲート判定を行う
  Then その snapshot のプロパティ参照だけで判定する
  And settingsRepository への追加の read は発生しない

Scenario: ゲートが false でも手動試験は従来どおり実行される
  Given ゲートが false である
  When ユーザーが testConnection を実行する
  Then 選択したスロットは試行される（bypass 契約は不変）
```

## 受け入れ基準

- [x] `StorageKeys.AI_PROVIDER_BREAKER_ENABLED`（値 `ai_provider_breaker_enabled`）と `StorageKeyValues` の `boolean` を追加する
- [x] `DEFAULT_SETTINGS` の既定を `true` にする。既存インストールは `applyMigrationsCore` の default merge で既定を受け取るため、backfill は不要
- [x] `GENERAL_SETTINGS_SCHEMA` に `{ key: StorageKeys.AI_PROVIDER_BREAKER_ENABLED, type: 'checkbox' }` を登録する（未登録だと保存時に黙って drop される）
- [x] `entrypoints/options/index.html` の AI プロバイダー設定セクションに `label.checkbox-label` パターンの checkbox と `data-i18n` 付き label・help を追加する
- [x] `public/_locales/{ja,en}/messages.json` の両方に label と help のキーを追加する
- [x] ゲート判定は `RemoteAIService.generateSummary` の既存 `settings` snapshot 上で行い、追加の `settingsRepository` read を追加しない
- [x] ゲートが false のとき `shouldAttempt` / `cooldown` / `recordSuccess` / `recordFailure` を一度も呼ばない（state を触らない）
- [x] `testConnection` 経路は変更しない（bypass 契約が不変）
- [x] `compositionManifest.ts` は変更しない（ゲートは RemoteAIService 内部の read-time 判定。コンテナ factory は同期で settings を await できない）
- [x] `settingsMigration.ts` の `TOP_LEVEL_ONLY_KEYS` と `API_KEY_FIELDS` は変更しない
- [x] gate が false のときは「一時停止」summary を出さない（`suppressed` が空なので既存の all-suppressed 分岐に入らない）
- [x] ゲート判定のログは、AI ゲートが無効であることを示す INFO 1 行に留める。要約ごとのログを出さない
- [x] 新しい Chrome permission・`.then()` chain・拡張子なし ESM import を追加しない

## テスト戦略

- 単体: ゲート判定関数そのもの（`suppressed` を返さないこと、state を触らないこと）を `RemoteAIService` の注入 seam で検証する
- 単体: `settingsSchemas.test.ts` と同型で、schema 登録・`data-storage-key` 属性の両ロケールへの存在を pin する
- 統合: `remoteAIService-breaker.test.ts` に「gate false で cooldown 中のスロットを試行する」シナリオを追加する
- 統合: `storage-keys.test.ts`（全 StorageKeys が getAll に存在）と `localeParity.test.ts` が green を維持する
- E2E: dashboard の general 設定で checkbox を ON/OFF に切り替え、リロード後に保持されることを確認する

## 技術的考慮事項

- ゲートは `RemoteAIService` 内部の read-time 判定とする。`compositionManifest` の factory は同期のため、`disabledBreaker` への差し替えでは非同期 settings を読めない
- 既存の前例 4 件（`alarmRegistry.ts` / `reviewSummaryGenerator.ts` / `saveToObsidianStep.ts` / `saveLocalMarkdownStep.ts`）は「await 済み settings から boolean を読んで skip」であり、本件も同一の型にする
- `settingsRepository.set(key, value)` は単一 writer かつ delta 書き込みで lock を内包する。呼び出し側で `StorageTransaction` を使う必要はない
- 設定エクスポートの `REQUIRED_EXPORT_KEYS` は `DEFAULT_SETTINGS` から自動導出されるため、本キー追加で 1.1.0 形式のエクスポートが新キーを必須とする。既存フォーマット互換の逸脱として CHANGELOG に記載する

## 見積もり

1.5 SP

## 検証結果（2026-09-28）

Red/Green 前提: 先に `remoteAIService-breaker.test.ts` の gate OFF 3 件と新規 `settingsSchemas-ai-provider-breaker.test.ts` 7 件を書いて Red（4 failed / 8 passed、7 failed）を確認してから実装した。

BDD シナリオの対応:

| シナリオ | テスト |
|---|---|
| 既定（ゲート有効）で cooldown が効く | `remoteAIService-breaker.test.ts` 既存 5 件 + `keeps the cooldown suppression when the gate is on` |
| ゲート OFF で抑制が完全に止まる | `attempts a cooled-down slot…` / `records nothing when the gate is off…` / `resolveBreakerGate` 2 件 |
| 追加の storage read をしない | `attempts a cooled-down slot…` 内の `expect(repo.getAll).toHaveBeenCalledTimes(1)` |
| ゲート false でも testConnection は従来どおり | `runs testConnection as usual with the gate off…` |

実行結果:

- `npx vitest run src/background/ai/__tests__/remoteAIService-breaker.test.ts` → 15 passed
- `npx vitest run src/utils/__tests__/settingsSchemas-ai-provider-breaker.test.ts` → 7 passed
- `npx vitest run src/utils/__tests__/settingsSchemas.test.ts` → 3 passed
- `npx vitest run src/utils/__tests__/storage-keys.test.ts` → 3 passed
- `npx vitest run scripts/__tests__/localeParity.test.ts` → 3 passed
- `npx vitest run src/background/ai/__tests__/providerBreaker.test.ts` → 32 passed
- `npm run type-check` → green
- `npm run lint` → 0 errors（144 warnings は全て既存・wasm 由来）
- `npm test` → 934 files passed / 1 skipped、14482 tests passed / 21 skipped

未実施: 「テスト戦略」の E2E 項目（dashboard で checkbox を ON/OFF に切り替え、リロード後に保持されることの確認）は自動化していない。受け入れ基準と Definition of Done には E2E が含まれないため未実施のまま完了としたが、checkbox の保存・保持は Playwright 側で確認していない。

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] BDD シナリオが自動テストとして実装され green
- [x] `npm run type-check` / `npm run lint`（0 errors）/ `npm test` が green
- [x] `CHANGELOG.md` に user-visible な設定追加として記載する
- [x] ロールバック手段: 本 PBI 自体が kill switch の導入であり、ロールバックは利用者が checkbox を OFF にすること

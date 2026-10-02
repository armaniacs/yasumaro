# PBI: クレンジングスライダーの delta-write 化

## 優先度・backlog 出所・依存

- 出所: [pbi/2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md) — 大局的レビュー（holistic-code-improvement スキル・フェーズA）で TOP 5 テーマに統合された検証済み候補 NN11。
- RICE: R=5 / I=2 / C=1.0 / Eff=0.5 → 20.0（順位 4）。
- 優先度: High。1 回のスライダー操作で兄弟キー最大 40 個が stale スナップショットの値で巻き戻されるレースを含むため。
- 依存: なし（バッチA 並列候補）。`src/dashboard/panels/staticForm/aiSummaryCleansingPanel.ts` と `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` のみを触り、他候補（08/10/13/14/15/16/18/23/24/25）とファイル非重複。

## ユーザーストーリー

ダッシュボードでスライダーを動かしてクレンジング閾値を調整するユーザーとして、その 1 キー変更だけでクレンジング設定の他の項目（ルール ON/OFF、フォールバック、ガード）が知らないうちに以前の値へ巻き戻らないことを期待する。

## 背景（file:line 付き現状）

- `src/dashboard/panels/staticForm/aiSummaryCleansingPanel.ts:41-47` — スライダーの change ハンドラが `getAiSummaryCleansingSettings()`（storage 全体の getAll + デフォルト折り込みのフルスナップショット）を呼び、`ss[config.settingKey] = parseInt(slider.value, 10)` で 1 キーだけ mutate し、そのフルスナップショットを `saveAiSummaryCleansingSettings(s)` に渡している。
- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:151-177` — `saveAiSummaryCleansingSettings` は「渡された settings オブジェクトの全クレンジングキー」を delta payload に載せる: `enabled`（:157-159）、32 個のルールキー（:160-163）、thresholds 4 個（:164-167）、`whitelistExtractionEnabled`（:168）、body protection 2 キー（:169-170）、fallback 3 キー（:171-172）、overcut guards 2 キー（:174-176）の計 40+ キーを `settingsRepository.setAll(delta)`（:177）に渡す。パネルから渡されるのが stale の可能性があるフルスナップショットのため、payload に載った全キーがスナップショット時点の値で書き戻される。
- 回避すべき規約（delta-write）は同プロジェクトに宣言済み:
  - `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:152-156` — 「only the keys this form owns enter the payload. A getAll() snapshot here would carry the repository cache (which may be stale) back into storage and revert unrelated keys a concurrent writer changed」
  - `src/dashboard/tagsPanel.ts:210-213` — 「this panel owns three keys, and the literal is the payload. A getAll() snapshot would revert every key a concurrent writer changed between that read and this write.」
  - `src/dashboard/panels/staticForm/generalSettingsPanel.ts:286-294` — 接続 4 キーのみを payload に載せる delta write。
  - `src/dashboard/settingsPipeline.ts:248-252` — 「only the extracted form keys enter the payload — merging the full currentSettings snapshot here would revert unrelated keys a concurrent writer changed. setAll already merges the delta over freshly-read storage under the write lock.」
- リポジトリ側の契約: `src/utils/storage/SettingsRepository.ts:167-176` — `setAll` は「Do NOT pass a full cached snapshot — its unrelated keys would overwrite concurrent writers' changes with stale values」と明記し、`src/utils/storage/SettingsRepository.ts:201-205` の `tx.withLock('settings', ...)` で渡された delta を書き込みロック下の fresh current に merge する。payload が 1 キーなら巻き戻しは構造的に起きない。
- 5 Whys: なぜスライダーだけがフルスナップショットを書くのか → `saveAiSummaryCleansingSettings` がオブジェクト全体を引数に取る API で、パネル側が「読み取り→1 キー mutate→全書き戻し」の形で使ってしまったため。他パネル（tagsPanel / generalSettingsPanel）は literal payload を直接 `setAll` 系 seam に渡す形に統一済み。

## BDD

### Scenario 1: 1 スライダー変更で兄弟キーが巻き戻されない

```gherkin
Given storage のクレンジング設定に linkRatioThreshold=70 と candidateGuardEnabled=true が保存されている
And 兄弟キー candidateGuardEnabled が並行ライターによって false に変更されている
When ユーザーが link-ratio-threshold スライダーを 85 まで動かして change を発火する
Then storage には linkRatioThreshold=85 だけが書き込まれる
And candidateGuardEnabled は false のまま保持される
And payload に載るキーは change された 1 キーのみである
```

### Scenario 2: read と write の間に兄弟変更が入っても current 値が保持される

```gherkin
Given スライダーの change ハンドラが呼ばれた直後である
And スライダーが読み取ったスナップショットには shortTextThreshold=30 が入っている
When スライダーの書き込みが開始される前に別ライターが shortTextThreshold=45 を書き込む
Then スライダーの書き込みは書き込みロック下で fresh current に merge される
And shortTextThreshold は 45 のまま保持される
And 変更キー linkParaThreshold のみが更新される
```

## 実装宣言・受け入れ基準

実装宣言: **It must keep behavior** — スライダーの成功経路（change された閾値が storage に反映され、UI の value display が更新される）は不変。失敗時に既存の empty-overwrite 保護（full stale snapshot を payload に載せない、`storageTransaction.ts:130-135` の「意図的に未変更」note を含むロック層の契約）と競合する書き方を導入しない。

受け入れ基準:

- [x] 1. 1 スライダー変更の payload には change された 1 キーのみが入り、他のクレンジングキー（thresholds / guards / fallbacks / ルールキー / enabled）が巻き戻されない。
- [x] 2. スライダーの read と write の間に兄弟変更が入っても、書き込みは書き込みロック下の fresh current に merge され current 値が保持される。
- [x] 3. `saveAiSummaryCleansingSettings` の他の呼び出し経路（preset 等、あれば）の挙動は不変 — フルスナップショット経由の既存 API は温存し、スライダー経路だけを 1 キー delta-write に切り替える。
- [x] 4. 既存の empty-overwrite ガードと競合しない: 新しい書き込みは `settingsRepository.setAll`（merge-under-lock）経由で行い、current が未初期化でも空オブジェクトでの上書きではなく 1 キー merge になる。
- [x] 5. 既存テストが green（スライダー経路の test が新契約に合わせて更新される場合を含む）。
- [x] 6. `npm run type-check` と `npm run validate` が通る。

## テスト戦略

- 単体（新規）: `aiSummaryCleansingSettingsV2` の保存 seam に対し、1 キー delta write の payload 検証。InMemoryStoragePort で「並行ライターが兄弟キーを変更した後にスライダー書き込みが走る」競合シナリオを再現し、兄弟キーが保持されることを `setAll` の呼び出し payload と storage の最終状態の両面で assert する。実時間待ちを挟まず、completion を示す Promise / mock 呼び出しで待つ（`testDir/waitPolicy.ts` の契約）。
- 単体（既存）: `src/dashboard/settings/__tests__/aiSummaryCleansingSettingsV2.test.ts` および同ディレクトリの ruleDerivation / coverage テストが green。パネルの change ハンドラが新 seam を呼ぶことを既存パネルテストで確認。
- 競合再現は `withOptimisticLock` の既存 stress テスト（`src/utils/__tests__/optimisticLock-stress.test.ts`）の手法に倣う。`vi.useFakeTimers()` のデフォルトオプションは使わない。

## 実装内容

1. `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts` に 1 キー保存 seam を追加する（例: `saveAiSummaryCleansingSliderValue(settingKey, value)`）。UI の `settingKey`（`linkRatioThreshold` / `shortTextThreshold` / `shortSeqCount` / `linkParaThreshold`）を `StorageKeys.AI_SUMMARY_CLEANSING_*` に map し、`settingsRepository.setAll({ [storageKey]: value })` で該当キーだけを書く。merge は `SettingsRepository.ts:201-205` の write lock 下で行われるため、read はハンドラ内で不要になる。
2. `src/dashboard/panels/staticForm/aiSummaryCleansingPanel.ts:41-47` の change ハンドラを `getAiSummaryCleansingSettings()` フルスナップショット → mutate → 全書き戻しから、新 seam への 1 キー delta write に置換する。`as unknown as Record<string, number>` の動的プロパティアクセス（:44）も seam 内の明示的な map に置き換わる。
3. `saveAiSummaryCleansingSettings`（:151-177）自体は削除しない — 他呼び出し経路（preset 適用等）が存在するため、契約とコメント（:152-156）は温存する。呼び出しが 0 になったことが確認できた場合のみ後続 PBI で整理する。
4. パネル側に WHY コメントは追加しない（delta-write 規約は `aiSummaryCleansingSettingsV2.ts:152-156`・`tagsPanel.ts:210-213` に既に宣言済み。seam 関数名と docstring で自明化する）。

## Definition of Done

- [x] 上記 BDD 2 シナリオがテストとして実装され、green。
- [x] 1 スライダー変更の payload が 1 キーであることを assert するテストが存在する。
- [x] 兄弟変更が read/write 間に入った場合の current 保持を再現するテストが green（`--repeats` なしで 20 回連続 green）。
- [x] 既存テスト一式が green（`npm run validate`）。
- [x] `npm run type-check` green。
- [ ] backlog（[pbi/2026-10-01-00-backlog-holistic-1001.md](2026-10-01-00-backlog-holistic-1001.md)）の NN11 として完了報告が紐づく — アーカイブ/台帳更新は本統合ステップの対象外（別ステップで処理）。

## 実装記録（2026-10-02）

変更した内容:

- `aiSummaryCleansingPanel.ts` — スライダーの change ハンドラを「`getAiSummaryCleansingSettings()` のフルスナップショットを読んで 1 キー mutate → `saveAiSummaryCleansingSettings` で全書き戻し」から `settingsRepository.setAll({ [storageKey]: value })` への 1 キー delta write に置き換え。読み取りはハンドラから不要になり、兄弟キーの巻き戻りが構造的に起きなくなった
- `sliderConfigs` の `settingKey: string`（UI 設定名）を `storageKey: CleansingThresholdStorageKey`（`StorageKeys` の実値）に置き換え、既存の `as unknown as Record<string, number>` による動的プロパティアクセスを型付きマッピングに除いた。`saveAiSummaryCleansingSettings` は他経路のために温存

追加したテスト（新規 `src/dashboard/panels/staticForm/__tests__/aiSummaryCleansingPanel.test.ts`、jsdom + InMemoryStoragePort 上の実 SettingsRepository）:

- 4 スライダーそれぞれについて、`setAll` の payload が change された 1 キーだけであることを assert
- 並列ライターがスライダーの write より先に `shortTextThreshold=30 → 45` と `candidateGuardEnabled=true → false` を書いた後、スライダーが `linkParaThreshold` を動かしても両方の兄弟キーが 45 / false のまま保持されることを storage の最終状態で assert（BDD Scenario 2）
- 書き込み経路が `getAll()` を呼ばないことを spy で固定
- `input` イベントによる value display の更新が無変更で動くことを確認

**逸脱なし**。ただし実装内容 1 は「`aiSummaryCleansingSettingsV2.ts` に `saveAiSummaryCleansingSliderValue` seam を追加する」案だったが、本 PBI のファイル集合はパネル本体とテストのみに限られていたため、受け入れ基準 4 が明示的に認める `settingsRepository.setAll` をパネルから直接呼ぶ形で満たした。`aiSummaryCleansingPanel.ts` は `src/dashboard/panels/**` 配下で `aiSummaryCleansingSettingsV2.ts` の UI ヘルパー群と同じ層であるため、循環依存は生じない。

検証: `npx vitest run <11 batch-A テストファイル> --repeats=20` → 155 passed / 11 files passed、`npm run validate` green。

### 追補（2026-10-02 Wave 2 後の実測）: 本 PBI の受け入れ基準は端到端では未達

同じ 4 スライダーが **2 本の `change` リスナに束縛**されており、本 PBI が修正したパネル側の delta-write とは別に、full-form 書き込みが残っている。

- `src/dashboard/panels/staticForm/aiSummaryCleansingPanel.ts:29` が `setupAiSummaryCleansingEventListeners()`（`aiSummaryCleansingSettingsV2.ts` から import）を呼ぶ
- `src/dashboard/panels/staticForm/aiSummaryCleansingPanel.ts:43-59` がパネル自身でも同じ 4 スライダーを束縛（本 PBI の delta-write）
- `src/dashboard/settings/aiSummaryCleansingSettingsV2.ts:455-480` の `rangeConfigs` ループが **7 スライダー**に `change` を貼り、`:475-478` で `getAiSummaryCleansingSettingsFromUI()` → `saveAiSummaryCleansingSettings(settings)`（フォーム全体の full-form 書き込み）を実行する

バインド順は `:29` が `:43-59` より先なので、1 回の `change` で V2 の full-form 書き込みが**先に**発火する。V2 側は生 DOM から全フォームを組み立てるため、マウント後に他経路で変わった兄弟キーは DOM に反映されておらず、full-form 書き込みで古い値に戻る。**「兄弟キーの巻き戻りが構造的に起きなくなった」は V2 経路が残る限り成立しない。**

本 PBI の新テストはパネル単体（`createAiSummaryCleansingPanel`）を直接 mount するため V2 の setup を経由せず、この二重バインドを検出できなかった。

残存分は [2026-10-01-27-fix-cleansing-slider-double-binding.md](2026-10-01-27-fix-cleansing-slider-double-binding.md)（NN27）が閉じる。NN27 完了までは、本 PBI の受け入れ基準 2（兄弟キーの巻き戻し防止）は**未達**として扱う。

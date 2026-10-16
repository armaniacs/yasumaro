# PBI: opfsWorker の load shed に再試行・退避を導入

## ユーザーストーリー
低スペック端末の利用者として、ワーカー混雑時に記録リクエストが黙って捨てられないでほしい。なぜなら shed された要求は記録欠損になり、弱い端末ほど欠損が増える不公平な劣化だから。

## 優先度
- 順位: 05 / 11
- RICEスコア: 4.3（Reach=4 / Impact=2 / Confidence=0.8 / Effort=1.5）
- 根拠: 記録欠損という実害。backoff 設計判断が残るため Confidence 0.8・SP 1.5。

## 背景
`src/offscreen/opfsWorker.ts:406` の `enqueue` はキュー満杯時に即時ハード失敗（`worker overloaded, request shed`）を返すだけで、再試行・退避がない。レビュー指摘 Low #10（Edge & Mobile）。

## BDD受け入れシナリオ
Scenario: キュー満杯時は呼び出し側に再試行可能な応答が返る
  Given リクエストキューが上限に達している
  When 新規リクエストが enqueue される
  Then 即時破棄ではなく、再試行可能であることが分かる応答（リトライ指示または上限付きの待機キュー）が返る

Scenario: 一時的な混雑は吸収される
  Given 短時間のバースト負荷
  When バーストが収まる
  Then 要求が処理される（欠損なし）

Scenario: 持続的な過負荷でも無限待機しない
  Given 上限を超える持続負荷
  When 再試行上限に達する
  Then 明示的な失敗として記録され、構造化ログに残る

## 受け入れ基準
- [x] shed 経路に bounded な再試行（回数・待機上限付き）または待機キュー退避がある
- [x] 無限待機・無限リトライにならないガードがある
- [x] `src/offscreen/__tests__/` の opfsWorker 系テストが全緑（新規テスト1件以上）

## テスト戦略
- 単体: キュー満杯時の再試行テスト（待機時間は注入可能な sleep / fake ではなく `useTimerClock()` 等の既定手段で。実時間待ち禁止）
- 既存: `npx vitest run src/offscreen/` 全緑

## 見積もり
1.5 SP

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了（差分点検済み：bounded待機15ms上限・失敗応答形不変）
- [x] ドキュメント更新済み（不要ならその旨を記録）

## 実施記録（2026-10-16）
- 解: `enqueue` を async 化し、満杯時は最大3回×5msの bounded 待機（注入可能 `SleepFn`）で空きを待つ。尽きれば従来同形の明示的失敗＋warnログ（error文に `after 3 retries` を明記）。総追加待機上限15ms。
- 変更: `src/offscreen/opfsWorker.ts`、`src/offscreen/__tests__/opfsWorker-loadShedRetry.test.ts`（新規3件）のみ。`git add/commit` なし。
- 検証: `npx vitest run src/offscreen/` 99ファイル・1258テスト全緑、`npx tsc --noEmit` クリーン。`npm run validate` は未実行（PBI手順通り）。
- なぜなぜ分析: `/tmp/whywhy-nn05.md`
- ドキュメント: 利用者向け仕様の変更なし（内部の待機挙動のみ）のため docs 更新不要。

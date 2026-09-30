# PBI: circuit breaker の手動解除（認証情報更新直後の回復手段）

種別: feat

上流: `dev-docs/archived/plans/2026-09-27-pbi15-ai-provider-circuit-breaker-policy.md`（policy §4 / §7 の再調整トリガー）

## ユーザーストーリー

API key を差し替えたのに要約が 15 分間出ないユーザーとして、circuit breaker の cooldown を手動で解除できるようにしてほしい。認証情報が直った今この瞬間に 1 回の probe を試したい。

## 優先度

- 順位: 2 / 3
- RICEスコア: 0.25（Reach=1 / Impact=1 / Confidence=50% / Effort=2 SP）
- 根拠: policy §4 が「認証失敗 15 分の UX 不満が出たら testConnection 経由の reset を強化」と再調整トリガーとして名指ししている既有の将来項目。Confidence 50% は「必要性の広さが未計測」による。PBI 27-07 のゲートを OFF にすれば同じ効果を自動的に得られるため、順位は 27-07 の後。
- 依存: PBI 27-07 のゲート機能に依存しない（独立実装可能）。ただし「OFF にする代わりに別の方法がある」という説明を UI には並記できる関係にある

## 5 Whys の裁定（2026-09-27）

1. なぜ 15 分待つ必要があるのか: auth 失敗は即時 cooldown に入り、解除手段がコードに存在しないため。
2. なぜ解除手段が無いのか: policy §7 が lazy half-open を採用し、手動 reset を意図的に除外した。
3. なぜ除外が正しいと考えられるのか: 追加操作を設けると「ユーザーは操作しないと壊れている」という状態を作り、half-open の単純さを壊す。
4. なぜ今見直さないのか: 認証情報を更新した直後だけ 15 分の待ちが発生する。credential 期限切れはユーザーの操作で回復する故障であり、「待つ」ことが正しい指示ではない。
5. なぜ PBI 27-07 と別なのか: ゲート（機能を止める）とリセット（状態だけ消す）は別の到達点を持つ。OFF にすると要約の保護も止まるため、「要約は動かしたい、保護だけ外したい」という需要はリセットでしか満たせない。

**裁定**: `ProviderBreaker` に `clearAll()` を追加し、設定画面の既存 connection test の成功時に呼び出す。専用ボタンは設けず、ユーザーの既有の診断操作に載せる。リセット（breaker state の削除）は「cooldown 中にも除外される」既存契約（policy §7）を壊さない。

**却下した案**:

- 専用「breaker を解除」ボタン: 新しい UI 表面を 1 つの状態に対して増やすだけ。既存の接続試験で足りる
- cooldown 時間の短縮（15 → 3 分）: policy §4 の閾値を早期に変更することになり、再調整の代わりに煩わしさを減らすだけで根本解決しない
- auth 失敗を即時 cooldown の対象から外す: 無効な credential での課金を防ぐという policy §4 の根拠を壊す

## BDD受け入れシナリオ

```gherkin
Scenario: 接続試験の成功で cooldown が解除される
  Given ある provider と model の breaker が auth 失敗で cooldown 中である
  When ユーザーが接続試験を実行し、そのスロットが成功する
  Then breaker state から当該エントリが消える
  And 次の要約リクエストは skip されず試行される

Scenario: 接続試験の失敗では cooldown を延長しない
  Given cooldown 中の provider に対してユーザーが接続試験を実行する
  And 試験が失敗する
  Then breaker state の cooldown は変化しない（試験結果は state に書かない）
  And 既存の一時停止の 15 分はそのまま残り、誤った回復暗示を出さない

Scenario: cooldown していない provider では何もしない
  Given breaker state に該当エントリが無い
  When 接続試験が成功する
  Then state は書き換わらない

Scenario: 解除は全 provider をまとめて行う
  Given 複数の provider と model が cooldown 中である
  When 接続試験が成功する
  Then cooldown 内のエントリがすべて削除される
```

## 受け入れ基準

- [x] `ProviderBreaker` に `clearAll(): Promise<void>` を追加する。単一チェーンで直列化し、state update 失敗は fail-open（握りつぶす）で他動作を止めない
- [x] 解除は「state 全体を空にする」1 方式に絞る（エントリごとの部分削除はしない）
- [x] `testConnection` の成功パスから `clearAll()` を呼ぶ。失敗パスからは呼ばない（policy §7 の「試験結果は state に反映しない」を維持）
- [x] `testConnection` は cooldown による skip を受けない既存契約を変更しない
- [x] 解除時に「breaker を解除しました」を表す INFO ログを 1 行出す。要約本文には出さない
- [x] 解除の操作に新しい UI ボタン・権限・storage key を追加しない
- [x] 新しい Chrome permission・`.then()` chain を追加しない

## テスト戦略

- 単体: `clearAll()` が state を空にし、fail-open で例外を投げないこと
- 単体: 既存 `providerBreaker.test.ts` の fail-open 契約（store が壊れているとき要約を止めない）を維持
- 統合: 接続試験成功 → state 空 → 次の要約が試行される、を 1 シナリオとして追加
- 統合: 接続試験失敗 → cooldown 不変、を 1 シナリオとして追加

## 技術的考慮事項

- `clearAll()` は store が例外を投げても握りつぶす（fail-open）。clear に失敗しても要約は止まらない
- 既存の single-flight / dedupe 契約は変更しない
- 本 PBI は PBI 27-07 と並んで「保護を止めたまま要約を動かす」手段になる。UI 文言で 2 者の関係を明示しない（利用者が判断する材料ではない）

## 見積もり

2 SP

## 検証結果（2026-09-28）

Red/Green 前提: `providerBreaker.test.ts` の `clearAll` 6 件と `remoteAIService-breaker.test.ts` の 4 件を先に書き、Red （6 failed / 32 passed、4 failed / 17 passed）を確認してから実装した。下の裁定の補足 2 で述べる identity 分岐の pin となる単体 2 件は、その分岐を実装後に一時的に外して Red になることを確認している。

BDD シナリオの対応:

| シナリオ | テスト |
|---|---|
| 成功で cooldown が解除され次の要約が試行される | `still bypasses the cooldown, then clears it…` |
| 失敗では cooldown が変化しない | `leaves the cooldown untouched when the test fails (policy §7)` / `…when every provider throws` |
| cooldown していなければ何もしない | 統合 `does not clear anything when no slot is in cooldown` / 単体 `spends no write when…` 2 件 |
| 解除は全 provider がまとめて | `clears every cooled-down slot, not only the one that was tested` |
| 直列化と fail-open | `shares the single mutation chain…` / `orders against the other mutations…` / `fails open when the store throws…` |

実行結果:

- `npx vitest run src/background/ai/__tests__/providerBreaker.test.ts` → 40 passed（+8）
- `npx vitest run src/background/ai/__tests__/remoteAIService-breaker.test.ts` → 21 passed（+6）
- `npx vitest run src/background/ai/__tests__/RemoteAIService.test.ts` → 28 passed
- `npx vitest run src/background/ai/__tests__/RemoteAIServiceSlotLog.test.ts` → 7 passed
- `npx vitest run src/background/__tests__/compositionManifest-breaker.test.ts` → 1 passed
- `npm run type-check` → green
- `npm run lint` → 0 errors（144 warnings は全て既存・wasm 由来）
- `npm test` → 934 files passed / 1 skipped、14496 tests passed / 21 skipped

裁定の補足（2 点）:

1. **ゲート OFF では `clearAll()` を呼ばない。** 解除は breaker state への write なので、PBI 27-07 の「ゲート OFF なら breaker state は read も write もされない」という契約の裏側に置いた。既存テスト `runs testConnection as usual with the gate off, breaker untouched` が「接続試験が成功しても clearAll しない」を担保している。OFF の間は cooldown 自体が無効なので、解除を必要としない状態で write だけ発生させない。
2. **遷移なしの store write を省いた。** `applyMutation` は「遷移関数が入力オブジェクトをそのまま返したら write しない」を採用した。`recordSuccess` / `recordFailure` の既存コメントは「no write needed」と書きながら実際のコードは常に write していたので、この仕様で初めてコメントの意味が通り、既に空の状態への `clearAll()` が真の no-op になる（BDD シナリオ 3）。この write 省略を支える 3 テスト（単体 2・統合 1）は、`applyMutation` の identity 分岐を一時的に外すと 3 件とも red になることを実測済み。

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] BDD シナリオが自動テストとして実装され green
- [x] `npm run type-check` / `npm run lint`（0 errors）/ `npm test` が green
- [x] ロールバック手段: `clearAll()` は接続試験成功時にしか呼ばれず、呼び出しを戻すだけで 1 ステップで元に戻せる

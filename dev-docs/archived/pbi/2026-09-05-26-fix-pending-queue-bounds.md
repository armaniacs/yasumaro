# PBI: pending キューの単一キー配列肥大化に上限・TTL を追加

## ユーザーストーリー
拡張機能の利用者として、未記録ページの一時置き場が無制限に膨らまないでほしい、なぜなら単一キー配列の無限成長は storage quota 枯渇と起動時読み込み遅延を招き、通常の記録機能まで巻き添えにするから

## 優先度
- 順位: 21 / 26
- RICEスコア: 320（Reach=100 / Impact=2 / Confidence=0.8 / Effort=0.5日）
- 根拠: 発生条件は 24 時間以内に 50 件超の privacy/error pending が溜まるヘビーユースに限られ Reach は小さいが、quota 枯渇時の影響は記録全体に波及するため Impact は大。修正は書き込み境界の cap 追加が中心で Effort は小さい。

## BDD受け入れシナリオ
```gherkin
Scenario: 未期限切れが閾値を超えても配列は上限内に収まる
  Given pending キューに未期限切れエントリが上限数まで溜まっている状態
  When  新しい pending ページを追加する
  Then  配列長が上限を超えず、最古のエントリから追い出される

Scenario: 遠い未来の expiry は許容上限に切り詰められる
  Given 呼び出し側が 30 日後の expiry を渡す状態
  When  addPendingPage を実行する
  Then  保存される expiry は PENDING_TTL 上限（24 時間）を超えない

Scenario: 期限切れエントリは読み取り時に除外され続ける
  Given 期限切れエントリが混在するキュー
  When  getPendingPages を呼ぶ
  Then  期限切れは返らず、日次 purge 後も件数が単調に増えない
```

## 受け入れ基準
- [x] `addPendingPage` に絶対上限（MAX 件数・drop-oldest）が存在し、上限超過時の追い出しがテストで表明される
- [x] 呼び出し側が渡す `expiry` が上限 TTL を超えないようクランプされ、遠未来 expiry のバイパスが塞がれる
- [x] `getPendingPages` / `clearExpiredPages` の既存の期限フィルタ振る舞いが維持される（既存 pending スイート green）
- [x] 上限値・TTL 値が名前付き定数として `pendingStorage.ts` に定義される

## テスト戦略
- 単体: `src/utils/__tests__/pendingStorage*.test.ts` に上限超過時の drop-oldest と expiry クランプのケースを追加（上限+1 件投入で長さ不変・最古追い出しを確認）
- 単体: 遠未来 expiry 投入で保存値が上限 TTL 内に切り詰められることを表明する
- 回帰: 既存 pending 関連スイート（add/remove/purge・競合直列化）が green のままであること

## 実装アプローチ
`addPendingPage` の `withOptimisticLock` updater 内で、現在の期限切れ prune（`PENDING_PAGES_PRUNE_THRESHOLD`）の後に絶対上限スライス（例: 新規追加後に末尾 MAX 件を残す）を追加し、引数 `page.expiry` を `Date.now() + PENDING_MAX_TTL_MS` でクランプする。読み取り側・purge 側の変更は不要。

## 見積もり
1ポイント（0.5日相当：updater 内の cap・clamp 追加と単体テストが中心）

## 実装者向け注記
- 現状確認済み: `src/utils/pendingStorage.ts:73` の `PENDING_PAGES_PRUNE_THRESHOLD = 50` は期限切れ除去のみで、未期限切れ 51 件超はそのまま追加される（`:151-154`）。`clearExpiredPages`（`:224-232`）は年齢フィルタのみで件数上限を持たない
- expiry 発行側 3 箇所はいずれも 24h 固定で問題なし: `src/background/pipeline/steps/checkPrivacyHeadersStep.ts:137`、`src/background/privacyPipeline.ts:204`、`src/background/pipeline/recordingOutcome.ts:82,95`。ただし `addPendingPage` が引数の expiry を無検証で保存するため、将来の呼び出し追加で遠未来値が混入しうる
- 調査用 rg: `rg -n "PENDING_PAGES_PRUNE_THRESHOLD|clearExpiredPages|addPendingPage" src --glob '*.ts' | grep -v __tests__`、`rg -n "expiry" src/utils/pendingStorage.ts src/background/pipeline/recordingOutcome.ts`
- スコープ補正: 2026-09-05 の arch4 PBI（`dev-docs/archived/pbi/2026-09-05-07-refactor-pending-queue.md`）で `clearExpiredPages` の直列化は解決済み。本 PBI は件数上限と TTL クランプのみに限定し、facade 狭窄などの再設計は行わないこと

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み（DESIGN_SPECIFICATIONS の pending 保持上限の記述があれば）

## 実装メモ（2026-09-05・branch 0905c）
- 完了（commit `f3d75606`、SDD サブエージェント実装）。pending キューに絶対上限（drop-oldest）＋TTL クランプ（呼び出し側の遠未来 expiry を上書き）を追加。clearExpiredPages・pendingPatchPolicy の lock 規律は不変。

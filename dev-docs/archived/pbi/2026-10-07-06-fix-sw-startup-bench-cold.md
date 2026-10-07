# PBI: sw-startup bench を実 cold-start 計測にする

## ユーザーストーリー

性能計測の保守担当者として、「cold-start」として記録される数値が実際に SW 再起動を含んでほしい。現計測は Runtime.evaluate で SW を止めず warm round-trip を cold-start として報告するから。

## 優先度

- 順位: 6/17
- RICE: 6.0（R3 / I2 / C1.0 / E1）
- 根拠: 回帰ゲートとしての false confidence。コードで確定
- 依存: なし

## 背景（file:line 現状）

- `bench/e2e/sw-startup.bench.ts:24-32` — ループ本体は `context.newCDPSession(page)` で `Runtime.evaluate('true')` を送るだけで `sw.stop()` / `ServiceWorker.stopAllWorkers` を一度も呼ばない。worker ハンドルは `void sw` で破棄、`ServiceWorker.enable` はループ後（:32）のみ。CDP セッションが反復ごとに蓄積（detach なし）
- 影響: 5 サンプルすべて warm-message latency。`bench/reports/e2e-sw-startup-*.json` の既存値は warm 数値
- 同点根拠: NN05（6.0）と同点だが NN05 が実データ乖離のためリスク軽減順で先行

## BDD受け入れシナリオ

```gherkin
Scenario: サンプルが実際の SW 再起動を含む
  Given ループの各反復で ServiceWorker.stopAllWorkers を送る
  When 次の message round-trip を計る
  Then サンプルは SW 冷間起動のレイテンシとして記録される

Scenario: CDP セッションが蓄積しない
  Given 反復ごとに CDP セッションを作る
  When 反復が完了する
  Then 作成したセッションは detach されている
```

## 受け入れ基準

- [x] ループ本体が実際に SW を停止する（`sw.stop()` または CDP `ServiceWorker.stopAllWorkers`）
- [x] 作成した CDP セッションを detach する
- [x] 既存の `local/no-fixed-wait` cooldown 例外コメント（:44-50）の意味を再評価し、必要なら更新
- [x] 再ベースライン: 既存 `bench/reports/e2e-sw-startup-*.json` が warm 数値であることを報告に明記
- [x] bench 計測は実ブラウザ領域のため自動 pin の対象外（`@bench` タグ維持）

## テスト戦略

- bench: `npx playwright test bench/e2e/sw-startup.bench.ts` で実測して報告（`make clean test` ゲートには含まれない、`bench/` 領域）
- 単体 pin は対象外（実ブラウザでしか確認できない計測）

## 見積もり

1 SP

## Definition of Done

- [x] 上記受け入れ基準をすべて満たす
- [x] `npm run validate` が PASS する（bench は含まれないが build への影響を確認）
- [x] 手動確認: playwright bench の実行結果（cold-start 値の再計測）を実行報告に残す

## 実装記録

- 変更ファイル: `bench/e2e/sw-startup.bench.ts`（CDP stopAllWorkers で実停止 + セッション1本に集約）
- ゲート: playwright bench 1 passed（再ベースライン p50 0.8ms warm → 18.8ms cold）/ type-check PASS / lint PASS / validate PASS

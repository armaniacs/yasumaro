# PBI: extractor/VisitGate の型安全性と clock 単調性を是正する

## ユーザーストーリー
開発者として、extractor の閾値設定で型キャストが残らないようにし、VisitGate の時間判定が NTP 補正で壊れないようにしたい、なぜなら将来 boolean キーを THRESHOLD_RULES に混入させた際の型崩れや、端末の時計補正で valid visit が永遠に報告されない事故を防ぎたいから

## 優先度
- 順位: 7 / 9（ファイル名は 06 だが RICE 順では 7位。番号は着手順を優先し 06 とする）
- RICEスコア: 16.0（Reach=6 / Impact=1 / Confidence=80% / Effort=0.30w）
- 根拠: ユーザ可視の訪問判定に影響するが発生頻度は低。Effort 小で独立して実行可。

## ビジネス価値
- 閾値設定の型安全性が保証され、将来のルール追加時のバグをコンパイル時に検出できる
- 単調 clock で訪問判定が安定し、モバイルの NPT 補正環境でも記録漏れが 0 になる

## BDD受け入れシナリオ

```gherkin
Scenario: THRESHOLD_RULES に boolean キーを混入させると型エラーになる
  Given THRESHOLD_RULES に `aiSummaryCleansingEnabled` を追加しようとする
  When `npm run type-check` を実行する
  Then 型エラーになり、混入が未然に防がれる

Scenario: clock が過去に戻っても訪問が報告される
  Given VisitGate の clock が NTP 補正で 10秒過去に戻る
  When isReportable を呼ぶ
  Then elapsed が負にならず、正しく閾値判定される

Scenario: 既存の shouldRecordVisit 後方互換が保たれる
  Given 旧シグネチャ `shouldRecordVisit(duration, scroll)` を呼ぶ
  When pageState のデフォルト閾値で判定する
  Then 以前と同じ結果が返る
```

## 受け入れ基準
- [ ] `THRESHOLD_RULES` が `ThresholdRule<K extends NumericKey>` のジェネリクスで定義され、`t.prop` が number プロパティに限定される
- [ ] `extractor.ts:214-220` の `new VisitGate` が毎回生成ではなく再利用または singleton に
- [ ] `VisitGate` の clock デフォルトが `performance.now()` ベースの単調 clock か、負の elapsed を 0 に clamp
- [ ] `DEFAULT_CLEANSING_CONFIG` と `THRESHOLD_RULES` の default 二重定義が解消（single source）

## テスト戦略

### 単体テスト
- `THRESHOLD_RULES.every(r => typeof DEFAULT_CLEANSING_CONFIG[r.prop] === "number")` の型同期テスト
- VisitGate の clock モックで過去に戻るケースのテスト

### 統合テスト
- extractor の loadSettings で 32ルール + 7閾値が正しく pageState に反映されるテスト

## 見積もり
2pt

## 技術的考慮事項
- 依存関係: なし
- 非機能要件: 閾値 clamp は既存の `Math.max(min, Math.min(max, ...))` を維持

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "THRESHOLD_RULES\|CleansingConfig" src/content/extractor.ts src/utils/aiSummaryCleaner/rules.ts
grep -rn "VisitGate\|shouldRecordVisit" src/content/visitGate.ts src/content/extractor.ts
```

### 実装手順
1. `rules.ts` で `type NumericKey = { [K in keyof CleansingConfig]: CleansingConfig[K] extends number ? K : never }[keyof CleansingConfig]` を定義し THRESHOLD_RULES をジェネリクス化
2. `extractor.ts` の `shouldRecordVisit` 内の `new VisitGate` をモジュールスコープの singleton に
3. `visitGate.ts` の clock デフォルトを `performance.now` 差分に変更し、elapsed <0 を 0 に clamp

### 落とし穴
- `performance.now()` は content script の isolated world では使えるが、Service Worker 側で使い回すと基準がずれる。VisitGate は content 専用に留める
- THRESHOLD_RULES の default と defaults.ts の DEFAULT_SETTINGS の二重定義は、片方を import して生成する形に統一しないと再び乖離する

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] `grep -rn "as unknown" src/content/extractor.ts` が 0 件
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

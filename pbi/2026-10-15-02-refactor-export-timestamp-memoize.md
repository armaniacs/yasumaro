# PBI: エクスポート時刻整形の分単位メモ化でレンダリングを高速化する

## ユーザーストーリー

大量の履歴を Markdown エクスポートする利用者として、1 万件の書き出しを 1 秒未満で完了させたい。現行の行レンダリングは 10,000 件で p50 339ms を消費し、その 81% (275ms) が行ごとの `toLocaleTimeString` 呼び出し (ICU) だからだ。時刻表示は分単位の分解能しか持たないため、分単位のメモ化で出力バイトを一切変えずに約 8 割を削減できる。

## ビジネス価値

- 10,000 件エクスポートのレンダリングを p50 339ms → 約 65ms へ短縮する (実測内訳に基づく推定。受入基準で実測 pin する)
- `resolveTimestamp` はパイプラインの Markdown 生成 (`saveLocalMarkdownStep` / `formatMarkdownStep` 経由の `markdownEntryData`) と共有 SSOT のため、記録保存パスにも波及する
- Rust/WASM 移植によらない (STEP 0 実測で移植不適と確定。理由は「技術的考慮事項」)

## BDD受け入れシナリオ

```gherkin
Scenario: 大量エクスポートが高速化し出力がバイト同一になる
  Given 10,000 件の履歴を持つデータベースがある
  When 全履歴を Markdown エクスポートする
  Then 完了までのレンダリング時間がメモ化前の 1/3 以下になる
  And 出力ファイル群がメモ化前とバイト同一である

Scenario: 日を跨ぐ同一時刻の表示が変わらない
  Given 2026-10-01 09:05 と 2026-10-15 09:05 の記録がある
  When それぞれを含む範囲をエクスポートする
  Then 両行の時刻表示が従来と同一の文字列になる
  And 分境界 (09:05:59 → 09:06:00) を跨ぐ 2 行の表示が異なる

Scenario: 明示 timestamp 指定はメモ化を迂回する
  Given input.timestamp を指定したエントリがある
  When buildTemplateEntryData を呼ぶ
  Then 指定文字列がそのまま返りキャッシュに影響しない
```

## 受け入れ基準

- [ ] `resolveTimestamp` (`src/utils/markdownFormatter.ts:127-135`) の計算分岐のみを分キー (`Math.floor(ts / 60000)`) でメモ化している。`input.timestamp` 指定分岐は迂回している
- [ ] キャッシュキーの上限は自然有界 (1440 通り/日以下の HH:MM 値のみ) であり、有界性の理由をコメントに明記している。TTL・eviction は不要なことをレビューで確認している
- [ ] `bench/export-render-probe.ts` の 10,000 件ケースで total p50 がベースライン (339.2ms) の 1/3 以下になり、結果 JSON を更新している
- [ ] 既存テスト (`markdownFormatter` / `markdownExport` 関連スイート) が全件 green。出力のバイト同一性は既存のテンプレート断定 + 新規の分境界ケースで pin している
- [ ] `timestampLocale` オプションが指定された呼び出しはキーに locale を含めるか迂回している (ロケール混在で誤表示しない)
- [ ] `npm run validate` が green

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- なし (表示バイト同一性は下位で担保。実ブラウザの手動確認は DoD 分離: Load unpacked → 日付範囲エクスポート → 時刻列の目視)

### 統合テスト

- `exportDateRange` に対する 2 日跨ぎ fixture (同一 HH:MM を含む 2 日分): メモ化前後で `renderDateFile` 出力が同一であることをスナップショットではなく文字列断定で pin する

### 単体テスト

- `resolveTimestamp` の分境界ケース: `09:05:59.999` と `09:06:00.000` で表示が異なること、同一分内の異なる秒で表示が同一かつ `toLocaleTimeString` 実呼び出しが 1 回であること (ICU 呼び出し回数を spy して断定)
- `timestampLocale` 混在ケース: 異なる locale の同一分が別エントリになること (または迂回仕様の断定)
- `input.timestamp` 指定ケース: キャッシュを参照・汚染しないこと

## 実装アプローチ

- **Outside-In**: 統合テスト (日跨ぎ同一時刻の出力同一性、Red: 現行は通るため「仕様 pin」として先に置く) → 単体テスト (ICU 呼び出し回数、Red: 現行は N 回) → 実装 (メモ化) → ベンチで green 確認 → リファクタリング
- キャッシュの所有は `resolveTimestamp` のモジュールスコープ (`Map<number, string>`)。Service Worker のエフェメラル性と両立する (再起動で消える純粋関数のメモであり耐久状態ではない)

## 見積もり

- 0.5 SP (🟢低)。単一関数 + テスト 3 件 + ベンチ再測のみ

## 技術的考慮事項

- 依存関係: なし (単一ファイル完結)
- なぜ WASM 移植ではないか (rust-wasm-migration STEP 0 実測):
  - 転送フロアは全体の 5% (`bench/export-render-probe-result.json`: floor share 0.05)。境界コピーをゼロにしても 17.9ms しか削れない
  - 支配コスト (81%) は ICU の `toLocaleTimeString` 自体で、ネイティブ実装済みの処理を Rust で再実装しても速くならない (原則 1: ネイティブが既に最速)
  - Rust 側にロケール時刻整形を持ち込むと Chrome の ICU バージョン追従でバイト同一性が崩れる parity リスクがある。パイプライン出力との SSOT 一致が壊れる
  - よって分単位メモ化 (TS 側アルゴリズム改善) が正解。WASM 化は「やらない」確定
- 非機能要件: メモリ上限は自然有界 (下記「落とし穴」)。パフォーマンス回帰の pin はベンチ JSON の更新で残す

## 実装者向け注記

### 現状コードの確認

```bash
# 時刻整形の全呼び出しとメモ化の不在を確認する
grep -rn "toLocaleTimeString" src/ --include="*.ts" | grep -v __tests__
grep -rn "memoiz\|timestampCache\|Map<number, string>" src/utils/markdownFormatter.ts src/utils/localDate.ts
```

既実装の可能性: なし (2026-10-15 に実測確認済み。`resolveTimestamp` は素朴な都度整形)。

### 実装手順

1. 統合テストを先に置く (日跨ぎ同一 HH:MM の出力同一性。これ自体は現行でも green の「仕様 pin」)
2. 単体テストを置く (ICU 呼び出し回数の断定。現行は Red = N 回呼ばれる)
3. `resolveTimestamp` に分キーの `Map` を導入し green にする
4. `bench/export-render-probe.ts` を再実行し結果 JSON を更新、1/3 以下を確認する
5. `npm run validate` で全体 green を確認する

### 落とし穴

- `Map` の無限肥大化に見えるが、キーは `Math.floor(ts / 60000)` に対する表示文字列で、表示の分解能が分のため到達可能なキーは 1440 通り以下に自然有界する。eviction を足すと逆に複雑さが増えるので足さない。理由はコメントに残すこと
- `formatMarkdownStep.ts:45` の `new Date().toLocaleTimeString(getUserLocale(), ...)` は別物 (現在時刻・ユーザーロケール)。本 PBI の範囲外であり触らないこと
- `timestampLocale` オプション付き呼び出しが将来増えた場合のキー設計 (locale 込み) を忘れずに (受入基準に含む)

## Definition of Done

- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] ベンチ JSON が更新され 1/3 以下が実測で確認できる
- [ ] `npm run validate` が green
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み (CHANGELOG は版上げ時に記載)

## 優先度

- 種別: refactor
- RICEスコア: **12.0** (Reach=6 / Impact=1 / Confidence=1.0 / Effort=0.5 SP)
  - Reach=6: エクスポート利用者 + 記録保存パイプライン (SSOT 共有のため両経路に波及)
  - Impact=1 (中): 10k 件で約 270ms 削減。機能不全の解消ではない
  - Confidence=1.0: コンポーネント分解プローブで支配因子を実測済み
  - Effort=0.5: 単一関数完結
  - 注: RICE は本ラウンドの単一候補集合内での相対値であり、他ラウンドの絶対値比較は無意味

# PBI 2026-09-12-21 — EntryByteDelta（診断バイト差分の 5 方言統合・実バグ 2 件解消）

- **種別**: 🔧非機能追加（fix + refactor・実バグ 2 件解消を伴う）
- **優先度**: 5 位 / RICE **8.5**（R8 × I2 × C80% / E1.5人日）
- **出典**: round 11 診断 候補 21・サブエージェント探索 + 直接検証

## 背景（なぜ）

1 概念（byte-delta 表示）に 5 方言が存在:

- 削減計算の 3 重手書き: `sqliteHistoryPanelView.ts:117-118,126-127,146-147`（+ 進捗バー :40-41）
- formatBytes 2 種: ローカル版（:43-47・MB/KB/B テーブル）vs 生値補間（:119,128,148）
- `:123-124` の `||` チェーンが正当な 0 バイト値を次の fallback に落として差分を誤報告（`??` であるべき）
- `:116-119` はゼロガード無しで `reduction / page_bytes` を計算し、page_bytes=0 で **Infinity%/NaN%** を描画（隣接分支 :127,:147 は `> 0` ガード済みでこの分支だけ漏れ）
- 進捗バーは markup + querySelector 後処理（:668-670）の 2 段描画

## スコープ

- `entryByteDelta.ts` module 新設: `describeDelta(original, cleansed): {label, percent, ratio} | null` + `formatBytes(n)`
- `formatDiagnosticMetadataHtml` / `buildCleansingProgressBarHtml` を薄 adapter 化
- data-bar-width 後処理を builder 内に統合（CSP-safe 経路維持）
- 振る舞い: ゼロガード・`??` 化・percent cap は正しい値への修正（表示バグの解消）

## 受け入れ基準（BDD）

### シナリオ 1: page_bytes=0 で Infinity を描画しない（ハッピーパス）
```gherkin
Given page_bytes=0 / candidate_bytes=0 の entry
When 診断 HTML を構築する
then NaN%/Infinity% の代わりに 0.0% 相当の表示になる
```

### シナリオ 2: 0 バイトの正当値が fallback に落ちない（境界）
```gherkin
Given original_bytes=0 / cleansed_bytes=null / candidate_bytes=100
When describeDelta を呼ぶ
Then original は 0 として扱われ、candidate への fallback をしない
```

## DoD

- [ ] module 新設・両 builder 委譲・後処理統合
- [ ] describeDelta 純粋 unit test 新設（0/0, 0/N, N/0, null, cap）
- [ ] dashboard history view 関連テスト green
- [ ] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（Infinity%/NaN% 表示と 0 バイト誤報告が正しい値に変わる = 表示バグの解消）

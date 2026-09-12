# PBI 2026-09-12-14 — PreviewFlow の payload builder + SpinnerScope（3 リテラル統合）

- **種別**: 🔧非機能追加（refactor）
- **優先度**: 6 位 / RICE **10.7**（R10 × I2 × C80% / E1.5人日）
- **出典**: round 10 診断 候補 06・サブエージェント探索

## 背景（なぜ）

`PreviewFlow.run()`（previewFlow.ts:62-161）が ~12 field の byteStats/aiSummaryCleansedStats payload を 3 回手組み（MANUAL:65-79 / PREVIEW:87-101 / SAVE:142-157）。新 stat field が 3 箇所編集になる。spinner seam も分断（PreviewFlow が show 後に条件付き hide のみ、RecordSession の 5 finish path が残りを hide）。error interface も二重（throw と return の混在）。PreviewFlow に直接 unit test は存在しない。

## スコープ

- `buildRecordPayload(tab, content, force, stats)` adapter を 3 send で共有
- spinner は操作を所有する flow に寄せるか、show-on-entry/hide-on-settle の小 `SpinnerScope` に
- 期待される background 失敗は throw せず `PreviewSaveResult` return に正規化
- RecordSession の finish path は SpinnerScope/settle に寄せ、5 箇所の個別 hide を削減

## 受け入れ基準（BDD）

### シナリオ 1: 3 envelope が同一 builder の field を運ぶ（ハッピーパス）
```gherkin
Given 新 stat field を builder に追加
When MANUAL / PREVIEW / SAVE の 3 send を実行する
Then 全 envelope に新 field が含まれる（3 箇所編集が不要）
```

### シナリオ 2: spinner の show/hide が均衡する（境界）
```gherkin
Given 正常終了・失敗・キャンセルの各 finish path
When 操作が settle する
Then show と hide が対になり、残留 spinner がない
```

## DoD

- [x] builder + SpinnerScope 新設・3 send 共有・error 正規化
- [x] builder table test + finish-path 均衡テスト新設
- [x] popup preview/recordSession 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `buildRecordPayload(tab, content, force, stats)` を previewFlow.ts に新設し 3 send で共有（maskedCount は SAVE のみ pickDefined）。SAVE が確認済み content（finalContent）を送ることをテストで pin（書き換え時に content を渡すミスを即検出）
- `SpinnerScope` を spinner.ts に新設（show/hide 均衡・hide idempotent）。run() を try/finally で包み全 exit path で均衡。session 側の hideSpinner 呼び出しは有効のまま
- 期待される background 失敗（no-response/!success）を throw → return に正規化（settlement が !success を処理するため UX 不変）。spinner mock 3 ファイルに SpinnerScope を追加
- 検証: previewFlow 7 tests 新設・popup 全 40 ファイル 870 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（error チャネルの正規化で呼び出し側のハンドリングが変わる = テストで pin）

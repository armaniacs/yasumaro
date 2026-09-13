# PBI 2026-09-12-10 — PreviewView.buildNavigation の stale-closure 修正（実バグ）

- **種別**: 🔧非機能追加（fix・実バグ修正）
- **優先度**: 2 位 / RICE **17.1**（R8 × I2 × C80% / E0.75人日）
- **出典**: round 10 診断 候補 02・サブエージェント探索

## 背景（なぜ）

`buildNavigation`（previewView.ts:155-199）は初回のみ prev/next ボタンを生成し（`if (!nav)`）、再利用時は display 切替とカウンタのみ更新する。presenter は show 毎に新しい navigator を閉じ込めた lambda を渡すため（previewPresenter.ts:190-194）、2 回目の show 以降は古いコールバックで遷移する実バグ。再 show のテストは存在しない。

## スコープ

- `buildNavigation` を idempotent 化: show 毎にボタンを clone して再配線、または束縛済み handler を保持して removeEventListener 後に再 attach（presenter の detach-then-attach パターンの鏡像）
- label 解決を生成時から分離（`refreshLabels()`）し locale 切替の stale も解消
- re-show テスト新設: show → close → show で 2 回目の navigator が駆動すること

## 受け入れ基準（BDD）

### シナリオ 1: 2 回目の show で新しい navigator が駆動する（ハッピーパス）
```gherkin
Given 1 回目の preview を show して close した
When 2 回目の preview を show して next を押す
Then 2 回目の navigator の位置が進み、カウンタは 0/N から始まる
```

### シナリオ 2: locale 切替後にラベルが更新される（境界）
```gherkin
Given preview を表示中
When locale を切り替えて refreshLabels を呼ぶ
Then prev/next の title が新言語になる
```

## DoD

- [x] buildNavigation idempotent 化 + refreshLabels
- [x] re-show 回帰テスト新設
- [x] popup preview 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- 束縛済み handler を `navHandlers` に保持し、show 毎に removeEventListener → addEventListener で再配線（presenter の detach-then-attach の鏡像）。label は生成時から分離し `refreshLabels()` で再解決
- 検証: re-show 回帰テスト + refreshLabels テスト新設・previewView 29 tests green・type-check green・lint 0 errors

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし

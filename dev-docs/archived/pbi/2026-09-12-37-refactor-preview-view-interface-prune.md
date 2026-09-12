# PBI 2026-09-12-37 — PreviewView の dead interface 4 メンバー削除

- **種別**: 🔧非功能追加（refactor・interface 縮小）
- **優先度**: 5 位 / RICE **6.4**（R4 × I0.5 × C80% / E0.25人日）
- **出典**: round 13 診断 候補 37・サブエージェント探索 + 直接検証（台帳「previewView dead members」の concrete 解）

## 背景（なぜ）

`PreviewView` interface は 12 メンバーを宣伝するが production は 8 を使用（previewPresenter.ts は show/close を inline 化 — :197-205,:248-255）。`setCleansingInfo` は空 body（previewView.ts:125-128）、`resetBodyWidth` は presenter の `DEFAULT_WIDTH` を重複（:130-132、ハードコード '320px'）。唯一の caller は previewView.test.ts:168-171 で dead behavior を assert している。

## スコープ

- interface + implementation から `show` / `close` / `setCleansingInfo` / `resetBodyWidth` を削除
- width 定数の所有を presenter に明示（既存 DEFAULT_WIDTH）
- テスト 1 件を更新（dead behavior assert を削除）

## 受け入れ基準（BDD）

### シナリオ 1: interface が実装契約と一致する（ハッピーパス）
```gherkin
Given PreviewView interface
When 宣言メンバーを列挙する
then 全メンバーに production caller が存在する
```

### シナリオ 2: presenter の所有が曖昧でなくなる（境界）
```gherkin
Given modal の open/close/width
When preview が完了する
then modal ライフサイクルは presenter が単一所有する（view は DOM query + navigation のみ）
```

## DoD

- [x] 4 メンバー削除・テスト更新
- [x] popup preview 関連テスト green
- [x] type-check / lint green

## 見積もり

🟢低（1pt目安） / 副作用: 🟢なし

## 実装メモ（2026-09-12）

- interface + implementation から `show` / `close` / `setCleansingInfo` / `resetBodyWidth` を削除（presenter が modal ライフサイクル + width を単一所有）
- テスト: show 3 件 + resetBodyWidth 1 件を削除、trap-ownership テストを「dead メンバー不存在の pin」に変更
- 検証: previewView 25 tests green・全 701 ファイル 11,568 tests green・type-check green・lint 0 errors

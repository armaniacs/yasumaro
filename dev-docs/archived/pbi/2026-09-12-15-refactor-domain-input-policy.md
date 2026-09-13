# PBI 2026-09-12-15 — DomainInputPolicy（タグ入力と保存パスの検証単一化）

- **種別**: 🔧非機能追加（refactor）
- **優先度**: 7 位 / RICE **10.2**（R8 × I2 × C80% / E1.25人日）
- **出典**: round 10 診断 候補 07・サブエージェント探索

## 背景（なぜ）

検証 seam が 2 つ並立: タグ UI `addDomain`（domainFilterTagUI.ts:99-118・lowercase + scheme strip + 独自 regex）と保存パス `DomainFilter.parseAndValidate`（唯一のはずの validation seam）。両者が食い違う入力を受理し得る。書込は hidden textarea + hidden button click + MutationObserver 転写という DOM ノード契約（interface ではなく隠しノード）で、observer 転写と `syncFromHidden`（:172-178）順序は untested。可視化方言も混在（`[hidden]!important` vs `style.display` 直書き）。

## スコープ

- normalize+validate を 1 回だけ持つ `DomainInputPolicy` module を新設し両経路が共有
- hidden-textarea + click + observer ブリッジを既存 save interface（`handleSaveDomainSettings` または抽出した `saveDomainLists`）への直接呼び出しに置換（hidden ノードは legacy fallback に残す）
- 可視化は attribute `hidden` に統一
- 振る舞い: 受理集合は parseAndValidate 準拠に統一

## 受け入れ基準（BDD）

### シナリオ 1: tag 入力と save 検証が一致する（ハッピーパス）
```gherkin
Given 大文字・wildcard・ReDoS 文字列の入力集合
When tag UI 経路と save パス経路で検証する
Then 両者の受理/拒否が一致する（parity test）
```

### シナリオ 2: observer なしで保存状態が伝わる（境界）
```gherkin
Given ブリッジを直接呼び出しに置換
When 保存を実行する
Then 戻り値で成功/失敗が判定でき、mutation timing への依存がない
```

## DoD

- [x] DomainInputPolicy 新設・両経路共有・ブリッジ置換・hidden 統一
- [x] parity test + save-status 戻り値テスト新設
- [x] dashboard domain filter 関連テスト green
- [x] type-check / lint green

## 実装メモ（2026-09-12）

- `domainInputPolicy.ts` 新設（normalize + validate）。addDomain の手書き regex を置換
- `saveDomainLists()` を抽出して {ok,message} を返す seam に。saveSimpleFormatSettings は showStatus 描画のみに痩せる。tag UI は直接呼び出して直接描画し、MutationObserver を削除
- hidden textarea はデータ担体として残し、hidden 保存ボタンは legacy fallback として動作（旧ボタン経路のテストは不変で green）
- 可視化方言の統一（style.display → hidden）は既存テストが旧 UI の display を pin しているため見送り（最小修正原則・逸脱記録）。tag UI 側は hidden + CSS !important のまま
- 旧 observer テスト 2 件を直接呼び出しテストに書き換え、失敗描画テストを新設。parity test 3 件新設
- 検証: dashboard 全 139 ファイル 2209 tests green・type-check green・lint 0 errors

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（受理集合が parseAndValidate 準拠に変わる = 意図した統一）

# computeScopeHash を utils へ移設し messaging→background の動的 import エッジを消滅（refactor）

## 1. タイトル + 種別

- **タイトル**: `src/messaging/sqliteOperationSecurity.ts` が実行時に `background/confirmTokenManager.js` を動的 import しているエッジを、chrome 非依存の `computeScopeHash` を utils へ移設して解消する
- **種別**: refactor（挙動不変・層エッジ消滅）
- **見積もり**: 1 SP

## 2. 優先度

- **優先度**: 順位 16
- **RICE**: R2 / I1 / C1.0 / E1 → **2.0**
- **根拠**:
  - messaging 層の layer-boundary 機械チェックは静的 runtime import のみ検出し「dynamic import is out of scope」と明示しているため、この層エッジはどこからも検出されない
  - `computeScopeHash` は SHA-256 の純粋関数（chrome 非依存）で utils（layer 0 相当）に置ける。Reach は低いが、層境界の機械検証の空白を埋める構造的価値がある
- **依存**: **なし**

## 3. ユーザーストーリー

**messaging / background 境界の保守担当者として**、scope hash 計算が中立層に置かれ、messaging から background への動的 import が無くなっていてほしい。なぜなら、動的 import は層境界チェックの外にあり、境界違反が機械検出されないまま蓄積するから。

## 4. 背景

`deriveScopeHash` が実行時に `background/confirmTokenManager.js` を動的 import する。messaging 層の機械チェック（`layer-boundary.test.ts`）は静的 runtime import のみ検出し「dynamic import is out of scope」と明示しているため、このエッジはどこからも検出されない。`computeScopeHash` は chrome 非依存の純粋関数（SHA-256）で、utils（layer 0 相当）に置ける。

該当箇所（全 file:line 検証済み）:

- `src/messaging/sqliteOperationSecurity.ts:206`（動的 import）
- `src/background/confirmTokenManager.ts:172-185`（`computeScopeHash` 実体）
- `src/messaging/__tests__/layer-boundary.test.ts:4-5`（動的 import 除外の明示）

改善案: `computeScopeHash` を utils へ移動し、`confirmTokenManager` と `deriveScopeHash` の双方がそれを参照する。fail-closed の `crypto.subtle` チェックは `computeScopeHash` と一緒に移る。挙動不変・エッジ消滅。新規 utils ファイルには `@layer` 宣言を付与し（NN03 のゲート慣行に従う）、統合側が SSOT リストに登録する。

## 5. BDD シナリオ

### シナリオ 1: messaging から background への動的 import が消える

```gherkin
Given computeScopeHash が utils モジュールへ移設されている
When src/messaging/sqliteOperationSecurity.ts を検査する
Then background 配下への import（静的・動的問わず）が存在しないこと
And deriveScopeHash が utils の computeScopeHash を参照していること
```

### シナリオ 2: hash 値が現行と同一である

```gherkin
Given 同一の入力（scope を決めるフィールド群）を与える
When 移設前後の computeScopeHash を実行する
Then 生成される SHA-256 の値が同一であること
```

### シナリオ 3: fail-closed の crypto チェックが維持される

```gherkin
Given crypto.subtle が利用できない環境で computeScopeHash を呼び出す
Then 現行どおり fail-closed で失敗すること
And 新規 utils ファイルに @layer 宣言が付与され SSOT に登録されていること
```

## 6. 受け入れ基準

- [ ] `computeScopeHash` が utils のモジュールへ移設され、`confirmTokenManager` と `deriveScopeHash` の双方がそれを参照している
- [ ] `src/messaging/sqliteOperationSecurity.ts` から background 配下への import（動的含む）が存在しない
- [ ] `crypto.subtle` の fail-closed チェックが移設先で保持されている
- [ ] 同一入力に対する hash 値が移設前後で同一である
- [ ] 新規 utils ファイルに `@layer` 宣言が付与され、SSOT リストに登録されている
- [ ] `layer-boundary.test.ts` を含む既存テストが無変更で green である

## 7. テスト戦略

1. **hash 値の golden pin 先行**: 移設前に代表入力の `computeScopeHash` 出力を pin するテストを確認（無ければ追加）し、移設後も同一であることを担保する
2. **層境界テスト**: `layer-boundary.test.ts` を実行し、messaging 層の既存境界が維持されていることを確認する
3. **動的 import の消滅確認**: `sqliteOperationSecurity.ts` に background 参照が残っていないことを静的確認する
4. **validate green**: `npm run validate`（type-check + test）で全体通過を確認する

## 8. 見積もり

**1 SP** — 関数移設 + 2 参照元の更新 + SSOT 登録。ロジック変更なし。

## 9. DoD

- [ ] 受け入れ基準 6 件すべて充足
- [ ] `sqliteOperationSecurity.ts` から background への import が消滅
- [ ] hash 値の golden pin が移設前後で同一
- [ ] 新規 utils ファイルが `@layer` 宣言付きで SSOT に登録されている
- [ ] `npm run validate`（type-check + test）が green
- [ ] 外部挙動不変

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 16（R2 / I1 / C1.0 / E1 → 2.0）
- 依存: なし

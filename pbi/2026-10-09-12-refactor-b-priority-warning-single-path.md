# B優先度の重複検出 + 警告描画 2 実装の一本化と死蔵コード削除（refactor）

## 1. タイトル + 種別

- **タイトル**: B優先度の重複検出 + 警告描画 2 実装の一本化と死蔵コード削除 — row-aware 検出を `validateBContainer` に集約し、`validateBSlots` を削除する（S-M）
- **種別**: refactor（挙動不変・重複排除 + 死蔵コード削除のみ）
- **見積もり**: 1.5 SP

## 2. 優先度

- **優先度**: 順位 12
- **RICE**: R4 / I1 / C1.0 / E1.5 → **2.7**
- **根拠**:
  - 「provider+model の重複検出」が view 側のライブ validate クロージャ（`priorityListView.ts:216-235`）と `validateBContainer`（`priorityListView.ts:75-96`）に二重実装されている
  - 「`.b-priority-warn` / `.b-priority-req-warn` の field-error div 生成（role=alert、同一 i18n キー）」が validate クロージャ（`priorityListView.ts:236-265`）と `settingsPipeline.renderBPriorityWarnings`（`settingsPipeline.ts:87-118`）に二重実装されている
  - i18n キー・DOM クラス・判定ロジックが 2 箇所に分かれているため、片側だけの修正ミス（drift）が構造的に可能。ライブ validate と保存時の警告表示の間で挙動差が黙って混入する
  - `validateBSlots`（`priorityListView.ts:56-69`）は src/・テスト両方に import がなく死蔵コード
- **依存**: なし

## 3. ユーザーストーリー

**B プロバイダ優先度 UI の保守担当者として**、重複検出と警告描画が 1 本のパスに集約されていてほしい。なぜなら、同一ロジックが 2 箇所に複製されていると、i18n キーや DOM クラス、判定条件の修正が片側にしか反映されず、ライブ validate と保存時の警告表示の間で挙動差（drift）が黙って混入するから。さらに使われていない `validateBSlots` が残っていると、どちらが正規パスか誤認するリスクがある。

## 4. 背景

「provider+model の重複検出」と「`.b-priority-warn` / `.b-priority-req-warn` の field-error div 生成（role=alert、同一 i18n キー）」が、view 側のライブ validate と save 時の `renderBPriorityWarnings` に二重実装されており、i18n キー・DOM クラス・判定ロジックのドリフトが構造的に可能。さらに slot ベースの `validateBSlots` は import ゼロの死蔵コード。

該当箇所（重複ループ 3 実装 + warn 生成 4 箇所、全 file:line 検証済み）:

- `src/dashboard/aiProviderB/priorityListView.ts:56-69` — `validateBSlots`。未使用（src/テスト両方に import なし）
- `src/dashboard/aiProviderB/priorityListView.ts:75-96` — `validateBContainer`。row-aware 検出の本体
- `src/dashboard/aiProviderB/priorityListView.ts:216-235` — validate クロージャ内の同一ループ
- `src/dashboard/aiProviderB/priorityListView.ts:236-250` — has-error toggle + duplicate warn 生成
- `src/dashboard/aiProviderB/priorityListView.ts:251-265` — req-warn 生成
- `src/dashboard/settingsPipeline.ts:87-118` — `renderBPriorityWarnings`。`validateBContainer` 呼び出し後に `:91` has-error toggle、`:92-103` duplicate warn、`:104-116` req-warn を再実装

改善案:

1. row-aware 検出は `validateBContainer` に一本化し、validate クロージャは「`validateBContainer` 呼び出し → has-error/warn 描画」に縮小する
2. warn/req-warn の生成・削除は priorityListView 側に 1 つの `renderPriorityWarnings(bList)` に寄せる
3. `settingsPipeline.renderBPriorityWarnings` はそれを呼んで `{ p1Empty }` を返すだけにする（検証→描画の順序・戻り値は維持）
4. `validateBSlots` は削除する

has-error toggle、role=alert、i18n キーは移動先で同一保持、挙動は同一。

## 5. BDD シナリオ

### シナリオ 1: ライブ validate と保存パスが同一の検出・描画パスを使う

```gherkin
Given row-aware 重複検出が validateBContainer に一本化されている
When B 優先度コンテナに対してライブ validate（change/input）を実行する
  And 同一コンテナに対して保存パスの renderBPriorityWarnings を実行する
Then 両パスが同一の検出ロジック（validateBContainer）と同一の描画関数（renderPriorityWarnings）を経由すること
  And 生成される警告 DOM のクラス・role・i18n キーが一致すること
```

### シナリオ 2: 重複行がある場合、同一 i18n キーの duplicate warn が表示される

```gherkin
Given B 優先度リストに同一 provider+model の行が 2 行ある
When validateBContainer を呼び出して描画する
Then 該当行に has-error クラスが toggle されること
  And .b-priority-warn.field-error の div（role=alert）が生成されること
  And textContent が i18n キー aiProviderPriorityDuplicateWarning のメッセージであること
```

### シナリオ 3: 重複解消・P1 設定済みの場合、警告が削除される

```gherkin
Given duplicate warn と req-warn が表示されている
When 重複を解消し P1 の provider を設定する
Then .b-priority-warn と .b-priority-req-warn の両方が削除されること
  And has-error クラスが解除されること
```

### シナリオ 4: validateBSlots は削除され参照が残らない

```gherkin
Given validateBSlots が priorityListView.ts から削除されている
When 型チェックとテストスイートを実行する
Then src/ およびテストに validateBSlots への参照が存在しないこと
  And 型エラー・テスト失敗が発生しないこと
```

## 6. 受け入れ基準

- [ ] row-aware 重複検出が `validateBContainer` に一本化され、validate クロージャ内の重複ループ（`priorityListView.ts:216-235` 相当）が削除されている
- [ ] validate クロージャは「`validateBContainer` 呼び出し → has-error/warn 描画」に縮小されている
- [ ] warn/req-warn の生成・削除が priorityListView 側の 1 つの `renderPriorityWarnings(bList)` に寄せられている
- [ ] `settingsPipeline.renderBPriorityWarnings` は `renderPriorityWarnings(bList)` を呼んで `{ p1Empty }` を返すだけになっている（検証→描画の順序・戻り値維持）
- [ ] `validateBSlots` が削除され、src/テスト両方に参照が残っていない
- [ ] has-error toggle、role=alert、i18n キー（`aiProviderPriorityDuplicateWarning` / `aiProviderPriority1Required`）が移動先で同一保持されている
- [ ] 挙動が完全に不変である（ライブ validate・保存時警告の DOM 出力に変化なし）

## 7. テスト戦略

1. **警告 DOM の golden pin 先行**: 着手前に `.b-priority-warn` / `.b-priority-req-warn` の生成条件（クラス構成、role=alert、i18n キー、textContent）と has-error toggle の挙動を pin し、リファクタリング中の安全網として使う
2. **既存 provider settings テストの green 綍持**: pin は無変更で維持する。一本化により pin が一切失敗しないことを確認する
3. **BDD シナリオの担保**: 検出・描画の同一パス性、重複時の警告生成、解消時の削除が pin テストで担保されていることを確認し、不足があれば同一系統テストに追加する
4. **死蔵コード削除の確認**: `validateBSlots` 削除後、src/テスト両方に参照が残らず型エラーが発生しないことを確認する
5. **挙動不変の確認**: `npm run validate`（type-check + test）で既存テスト全通過を確認する

## 8. 見積もり

**1.5 SP** — 2 ファイルにまたがるがロジック変更なし。検出ロジックの一本化、描画関数の移動、`settingsPipeline` 側を呼び出しのみに縮小、死蔵コード 1 関数の削除のみ。影響範囲は `priorityListView.ts` と `settingsPipeline.ts` の 2 ファイル

## 9. DoD

- [ ] 受け入れ基準 7 件すべて充足
- [ ] `npm run validate`（type-check + test）が green
- [ ] 警告 DOM の golden pin が無変更で通過（クラス・role=alert・i18n キー・has-error toggle）
- [ ] 既存 provider settings テストが green
- [ ] `validateBSlots` 削除後、src/テスト両方に参照が残っていない
- [ ] ライブ validate と保存パスの検証→描画の順序および戻り値（`{ p1Empty }`）に変化がない

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 12（R4 / I1 / C1.0 / E1.5 → 2.7）
- 依存: なし

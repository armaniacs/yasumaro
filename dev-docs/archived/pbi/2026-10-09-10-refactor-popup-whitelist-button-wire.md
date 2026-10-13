# popup statusPanel の whitelist ボタン wireOnce ブロック双子の統合（refactor）

## 1. タイトル + 種別

- **タイトル**: `attachPrivacyActionListeners` 内に手書きされている addDomainBtn / addPathBtn の wireOnce ブロック（tab 取得 → writer 呼び出し → result 分岐 → statusChannel.report → reportHandlerError）を `wireWhitelistButton(btnId, writer, successKey, logMessage)` 1 本に統合する
- **種別**: refactor（挙動不変・重複削減のみ）
- **見積もり**: 1 SP

## 2. 優先度

- **優先度**: 順位 10
- **RICE**: R3 / I1 / C1.0 / E1 → **3.0**
- **根拠**:
  - addDomainBtn / addPathBtn の wireOnce ブロックがほぼ同一で、result 分岐の文言構成（`statusInvalidUrl` vs `Invalid pattern: …`）が 2 か所で手維持されている。片方だけ修正されるドリフト余地をコード上に残し続ける状態
  - Confidence 1.0（コードで確定・改善案は機械的な統合）だが Impact は小（重複削減・規範化のみ、外部挙動不変）のため順位は下位に配置
- **依存**: **なし**

## 3. ユーザーストーリー

**ステータスパネルの whitelist ボタン実装の保守担当者として**、addDomainBtn と addPathBtn の重複した wireOnce ブロックが 1 つの `wireWhitelistButton` に集約されていてほしい。なぜなら、result 分岐の文言構成が 2 か所で手維持されていると、片方だけ直るドリフトが黙って通過するから。

## 4. 背景

「tab 取得（`getCurrentTab`）→ whitelist writer 呼び出し → result 分岐 → `statusChannel.report` → `reportHandlerError`」という構成を持つ wireOnce ブロックが 2 か所に手書きされている。result 分岐の文言構成（`statusInvalidUrl` vs `Invalid pattern: …`）が 2 か所で手維持されており、片方だけ直るドリフト余地がある。

該当箇所（2 箇所・全 file:line 検証済み）:

- `src/popup/statusPanel.ts:248-275`（addDomainBtn）
- `src/popup/statusPanel.ts:277-299`（addPathBtn）

wireOnce・try/catch・`reportHandlerError` 宛先は `:271-273` / `:295-297`。

改善案: `wireWhitelistButton(btnId, writer, successKey, logMessage)` 1 つに統合する。wireOnce・try/catch・`reportHandlerError` 宛先（:271-273 / :295-297）は移動後も同一、`statusChannel.report` のメッセージ構成（reason 分岐含む）も現行どおりで外部挙動は不変。

## 5. BDD シナリオ

### シナリオ 1: wiring が 1 本に統一される

```gherkin
Given statusPanel.ts に wireWhitelistButton(btnId, writer, successKey, logMessage) が 1 本追加されている
When attachPrivacyActionListeners 内の whitelist ボタンの wiring を確認する
Then addDomainBtn と addPathBtn の両方が wireWhitelistButton 呼び出しに置き換えられていること
And ほぼ同一の wireOnce ブロックが 2 か所に手書きで残っていないこと
```

### シナリオ 2: 成功時の外部挙動が不変である

```gherkin
Given writer が ok かつ added を返す
When ユーザーが statusAddDomain または statusAddPath をクリックする
Then statusChannel.report が現行どおりのメッセージ構成（successKey の文言 + success）で報告されること
And ステータスパネルが再初期化されること
```

### シナリオ 3: 失敗分岐の文言構成が現行どおりである

```gherkin
Given writer が !ok を返す
When ユーザーが whitelist ボタンをクリックする
Then reason が no-domain の場合は statusInvalidUrl（fallback: Invalid URL）が error で報告されること
And no-domain 以外の場合は Invalid pattern: <対象> が error で報告されること
And 例外発生時は reportHandlerError に logMessage（domain / path それぞれの文言）と例外が渡されること
```

### シナリオ 4: wireOnce 契約が pin どおり維持される

```gherkin
Given statusPanel-wireOnce-parity.test.ts の pin（2x init + 1 click => exactly 1 write）が存在する
When 統合後に initStatusPanel を 2 回実行して 1 回クリックする
Then クリックハンドラは重複せず whitelist writer は 1 回だけ呼ばれること
```

## 6. 受け入れ基準

- [x] `src/popup/statusPanel.ts` に `wireWhitelistButton(btnId, writer, successKey, logMessage)` が 1 本追加されている
- [x] addDomainBtn（:248-275）と addPathBtn（:277-299）の wiring が `wireWhitelistButton` 呼び出しに置き換えられ、ほぼ同一の wireOnce ブロックが残っていない
- [x] wireOnce・try/catch・`reportHandlerError` 宛先（:271-273 / :295-297）が移動後も同一である
- [x] `statusChannel.report` のメッセージ構成（reason 分岐の `statusInvalidUrl` / `Invalid pattern: …` 含む）が現行どおりで、外部挙動は不変である
- [x] 既存 statusPanel テスト（`statusPanel.test.ts` ほか）が無変更で green である
- [x] `statusPanel-wireOnce-parity.test.ts` の pin（2x init + 1 click => exactly 1 write）が無変更で維持される

## 7. テスト戦略

1. **wireOnce 契約の pin 先行**: 着手前に `src/popup/__tests__/statusPanel-wireOnce-parity.test.ts` の pin（re-init で statusAddDomain / statusAddPath のハンドラが重複しないことを attach spy で実行時 pin、2x init + 1 click => exactly 1 write）を確認し、統合中も無変更で失敗しないことを安全網として使う
2. **既存 statusPanel テストの green 維持**: `statusPanel.test.ts`、`statusPanel-extra.test.ts`、`statusPanel-cleansingFeedback.test.ts` を無変更で通過させる。テスト側の pin 部分は変更しない
3. **外部挙動のリグレッション観点**: 成功・no-domain・no-domain 以外の失敗・例外の各分岐のメッセージ構成が現行どおりであることを pin で確認する
4. **validate green**: `npm run validate`（type-check + test）で全テスト通過を確認する

## 8. 見積もり

**1 SP** — 機械的な統合（ヘルパー 1 本追加 + 2 ブロックの置き換え）のみでロジック変更なし。影響範囲は `src/popup/statusPanel.ts` 1 ファイル。

## 9. DoD

- [x] 受け入れ基準 6 件すべて充足
- [x] `npm run validate`（type-check + test）が green
- [x] `statusPanel-wireOnce-parity.test.ts` の pin が無変更で通過
- [x] `statusPanel.ts` 内に addDomainBtn / addPathBtn の重複 wireOnce ブロックが残っていない
- [x] 既存機能への影響ゼロ（外部挙動不変）

## 10. 出所

- holistic-1009 ラウンド（[台帳](2026-10-09-00-backlog-holistic-1009.md)）
- RICE 順位 10（R3 / I1 / C1.0 / E1 → 3.0）
- 依存: なし

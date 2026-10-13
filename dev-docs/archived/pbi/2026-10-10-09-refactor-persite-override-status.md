# PBI: perSiteOverrides の status 表示を showStatus 契約に統一する

- 種別: refactor
- RICE: 4.0（R4 × I1 × C1.0 / E1.0）
- 依存: NN05（messages.json の新規キーを参照するのみ — NN05 着地後に実装）
- バッチ: W3

## ユーザーストーリー

per-site override を保存するユーザーとして、連続保存でもステータス表示が正しく残っていてほしい。なぜなら手書き status ブロックの 3 秒タイマーが前回メッセージの所有権を握らず、連続 save で 1 回目のタイマーが 2 回目のメッセージを空白化しうるから。

## 背景（現状）

- `src/dashboard/settings/perSiteOverrides.ts:118-124` — クロージャ内 `setStatus` が `textContent` + `className` 全量書き込み + 素 `setTimeout(3000)` を再実装し、`src/utils/ui/settingsUiHelper.ts` の `showStatus` seam（per-element WeakMap でタイマーを所有、`cancelPendingClear` で前回タイマーを握り潰す）を迂回
- settingsUiHelper.ts:26-28 のコメントがまさに解決した「前回のタイマーが次のメッセージを消す」競合がここでは未修復
- 同一ファイルに英語リテラル 8 箇所（:154,157,175,180,183,193 — `'Domain is required'` `'Saved'` `'Deleted'` 等）— NN05 の messages.json キーを参照
- エラーは auto-clear しない（`if (isError) return;`）— showStatus の autoClear ポリシーオプションで表現可能

## BDD 受け入れシナリオ

```gherkin
Scenario: 連続保存でもステータスが空白化しない
  Given per-site override を連続で 2 回保存する
  When 1 回目の保存直後に 2 回目の保存が走る
  Then 2 回目のメッセージは 1 回目のタイマーで空白化しない（per-element タイマー所有）

Scenario: エラー表示は auto-clear しない
  Given ドメイン未入力で保存を試みる
  When 保存が失敗する
  Then エラーメッセージは 3 秒後にも残る（auto-clear しない）
```

## 受け入れ基準

- [x] クロージャ内 `setStatus` を削除し、`showStatus(statusEl, getMessageOr(key, fallback), ...)` に置換する
- [x] エラー分岐は auto-clear しない（showStatus のポリシーオプションで表現）
- [x] 英語リテラル 8 箇所を NN05 が追加した messages.json キーに寄せる
- [x] 素 `setTimeout` が本ファイルから消える
- [x] 既存テストが green（タイマー競合の修正を除き挙動不変）
- [x] タイマー競合を pin するテスト（連続 render で 1 回目のタイマーが 2 回目を消さない）を追加

## テスト戦略

- unit: `src/dashboard/settings/__tests__/` の perSiteOverrides テスト更新。fixture 先行（連続 save でメッセージ空白化を再現する落ちるテストを先に追加）
- timer: 実時間待ちは使わない（`testDir/waitPolicy.ts` のヘルパー / `useTimerClock` に従う）
- i18n: NN05 のキーを参照（キー不在の場合は fallback 文字列が表示される — NN05 着地後なので存在）

## 見積もり

1.0 SP

## 技術的考慮事項

- showStatus のシグネチャ（statusEl, message, kind, オプション）を確認して既存契約に従う
- NN05 依存: messages.json のキー追加は NN05 が完了済み（W2 着地後）
- プライバシー保証: 変更なし

## 実装者向け注記

### 実装手順

1. 落ちる fixture 先行: 連続 save で空白化を再現（useTimerClock で駆動）
2. `setStatus` → `showStatus` 置換、リテラル → getMessageOr 置換
3. `npx vitest run src/dashboard/settings` で検証

### 落とし穴

- showStatus の className 契約（`status-message` ベースクラス保持）は seam 側が所有 — 手書きで全量書き込みしない
- isError の auto-clear 抑制は showStatus のオプションで表現し、`if (isError) return;` を再実装しない

## Definition of Done

- [x] showStatus 契約に統一（素 setTimeout 消滅）
- [x] タイマー競合がテストで pin 済み
- [x] i18n リテラル解消（NN05 キー参照）
- [x] `npx vitest run src/dashboard` が green
- [x] ロールバック不要（表示契約の統合）

# PBI 03: privacy ページの getURL 移行と latent 問題の解消

## ユーザーストーリー

permissions ページでプライバシーポリシーを確認する利用者として、PRIVACY.md の取得がページ配置に依存せず、見出しの id が壊れないことを知りたい。なぜなら現状は相対パス fetch（現状の dist 構造では動作するが配置変更で壊れる）で、見出しから派生した id が escape されていないから。

## 優先度

- 順位: 03 / 7
- RICE スコア: 8.0（Reach=2 / Impact=0.5-1 / Confidence=90% / Effort=0.15 人週）
- 根拠（round 7 直接検証・サブエージェント指摘の一部を訂正）:
  - `src/privacy/privacy.ts:177` — `fetch('../PRIVACY.md')` は**現状動作する**（dist/chromium-mv3/permissions/ からの ../ 解決でルートの PRIVACY.md に到達・存在確認済み）— ただしページ配置変更で壊れる相対依存のため `chrome.runtime.getURL('PRIVACY.md')` に移行（hardening）
  - `:25` — `if (line === undefined) continue;` に i++ が無い latent 無限ループ（現状 unreachable）
  - `:164` — `replace(m => m)` の no-op
  - `:40` — 見出しから派生した `id="..."` が unescaped（属性 break-out 可能・本文は escape 済み）
  - `:192-197` — import 時の DOMContentLoaded 副作用（テスト/import でページ挙動が走る）

## BDD 受け入れシナリオ

```gherkin
Scenario: PRIVACY.md が getURL 経由で取得される
  Given permissions ページが開かれる
  When loadPrivacyPolicy が実行される
  Then fetch 先は chrome.runtime.getURL('PRIVACY.md') である

Scenario: 見出し id が escape される
  Given 見出しテキストに二重引用符が含まれる
  When ページが構築される
  Then id 属性は escape 済みである
```

## 受け入れ基準

- [x] fetch 先を `chrome.runtime.getURL('PRIVACY.md')` に移行
- [x] latent ループ 2 行と no-op replace を削除
- [x] 見出し id に escapeHtml を適用
- [x] `initPrivacyPage()` export 形態に変更し entrypoints/permissions/main.ts から呼び出し（import 副作用解消）
- [x] privacy 関連テスト green

## テスト戦略

privacy テスト更新 + entrypoints ビルド確認。

## 見積もり

XS-S（0.15 人週）。種別: fix（hardening）。

## 実装メモ（2026-09-11 round 7）

- fetch 先を `chrome.runtime.getURL('PRIVACY.md')` に移行（旧 `../PRIVACY.md` は現状動作するが dist 配置依存 — コメントで経緯を記録）。
- latent 無限ループ 2 行（i++ 無し continue）と no-op replace を削除。見出し id に escapeHtml 適用。
- `initPrivacyPage()` export 形態に変更（import 時 DOMContentLoaded 副作用を解消）— entrypoints/permissions/main.ts から呼び出し。
- privacy テスト更新（fetch target の pin を getURL に）— 59 tests green・build green。

# PBI: Gist egress の宣言（host_permissions 常時宣言 + CSP SSOT 追加 + meta CSP 指示子削除 + skip 削除）

## ユーザーストーリー

閲覧履歴を Obsidian と Gist の両方へ流しているユーザーとして、Gist の接続テストが実質的な応答まで到達してほしい、なぜなら Gist 機能は出荷済みで UI も動くのに、その唯一の外向き通信経路だけが manifest と CSP に未宣言で、fetch 側が skipCspValidation でランタイムゲートを迂回している不整合がユーザーから見えているから。

## 優先度

- 種別: 🔧非機能追加（fix・owner 判断 PBI 2026-10-18-25）
- 難易度: 🟢低
- 副作用: 🔴あり（host_permissions と extension_pages CSP に api.github.com が宣言され、拡張の宣言範囲が広がる。権限は GitHub API の GET / POST / PATCH のみで任意サイトへの読み書きではない）
- 出典: [pbi/2026-10-18-25-fix-gist-egress-csp-declare.md](2026-10-18-25-fix-gist-egress-csp-declare.md)（判定 REMAINS）。なぜなぜ分析 /tmp/whywhy/owner-pbi.md（分析 4-7）2026-10-21

## owner 判断（2026-10-21）

- 宣言先: **host_permissions に常時宣言**（optional への逃がしは不採用・同意 UI 配線が新規に要るため）
- meta CSP: **connect-src 指示子を削除し extension_pages CSP に一任**（tranco は SSOT 経由で connect-src に載るため二重管理を解消）
- sync / syncBatch の未配線: **意図的未配線と裁定**し、本 PBI は宣言追従に限定（配線は別 PBI 候補として記録）

## 実装内容

1. cspDomains.ts に Gist egress 用の定数を新設する（ALL_LIST_SOURCES / PROVIDER_ALLOWLIST_ROWS には置かない）し、wxt.config.ts の host_permissions に追加する
2. cspValidator.ts に egress 用 static set を新設し、isUrlAllowed の 1 チェック行を追加する（cspValidator は cspDomains と別系統の derivation であり、SSOT を直してもランタイムゲートは自動更新されない）
3. gistSyncTarget の 3 箇所の skipCspValidation を削除する。fetchWithRedirectGuard は skip を意図的に使うため、オプション自体は削除しない
4. options/index.html の meta CSP から connect-src 指示子を削除する（extension_pages CSP に一任）
5. **2 系統同時修正制約**: 宣言追加を先に、skip 削除を後にする（逆順だと Gist fetch が fail-closed で fail する）

## 受け入れ基準（BDD）

```gherkin
Scenario: Gist の egress が宣言と一致する
  Given Gist 接続テストを実行する
  When api.github.com へ fetch する
  Then ランタイムゲートが走り、宣言済み origin として通る
    And fetch に skipCspValidation は渡らない

Scenario: meta CSP の二重管理が消える
  Given options ページの meta CSP を確認する
  When connect-src 指示子を探す
  Then 指示子は存在しない（extension_pages CSP に一任）
```

## テスト戦略

- gistSyncTarget*.test.ts は fetchWithTimeout 実呼び + global.fetch mock のため、skip 削除後は gate が走り Red 化する。fixture を先に修正する
- cspDomains / cspValidator の派生整合テストを更新する
- MV3 が meta CSP を extension_pages に適用するかの実機確認は owner 手動確認として残置する

## 関連

- [pbi/2026-10-18-25-fix-gist-egress-csp-declare.md](2026-10-18-25-fix-gist-egress-csp-declare.md)（親 PBI・4 ブロッカーの裁定済み）
- src/utils/cspDomains.ts・src/utils/cspValidator.ts・src/background/syncTargets/gistSyncTarget.ts

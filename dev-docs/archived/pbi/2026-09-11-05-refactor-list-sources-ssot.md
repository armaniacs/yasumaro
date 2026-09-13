# PBI 05: filter-list allowlist を LIST_SOURCES 単一テーブルに統合し cross-table 整合テストを追加

## ユーザーストーリー

フィルターリスト取得を管理する利用者・開発者として、リストソースの許可（CSP / manifest / whitelist gate / fetch origins）が 1 テーブルから派生し、ホスト追加が 1 行変更で完結することを望む。なぜなら 5 つの membership テーブルが drift し、`nsfw.oisd.nl` の gate/grant が同一関数内で不一致だから。

## 優先度

- 順位: 05 / 9
- RICE スコア: 9.6（Reach=3 / Impact=2 / Confidence=80% / Effort=0.5 人週）
- 根拠（round 6 診断・B6 検証込み）:
  - `nsfw.oisd.nl` — `isDomainInWhitelist` で false（`urlWhitelist.ts:42-87` 未収録）なのに同一モジュールの `buildAllowedUrls` origin（:147）では許可 → OISD ソースの uBlock 登録が warn-skip される実害
  - `tranco-list.eu` — manifest/CSP は許可、built allowedUrls には不在。Tranco 更新は `fetchWithTimeout` 直呼び（FETCH_URL 経由でない）ため CSP 許可内で動作することを検証済み — drift 自体は残る
  - provider 静的ドメインが `cspValidator.ts:27-71`（DEFAULT_ALLOWED_DOMAINS + PROVIDER_TO_DOMAIN）と `urlWhitelist.ts:42-87` で 3 重複（openrouter.ai の bare vs api. など entry 単位の不整合含む）
  - テストは各テーブル個別のみで cross-table 整合の pin 無し

## BDD 受け入れシナリオ

```gherkin
Scenario: LIST_SOURCES の単一参照
  Given LIST_SOURCES テーブルにリストソースが定義される
  When cspDomains / cspValidator / isDomainInWhitelist / buildAllowedUrls / manifest を確認する
  Then 全消費先が同一ソースから派生する

Scenario: OISD の gate と grant が一致する
  Given nsfw.oisd.nl が LIST_SOURCES に登録される
  When isDomainInWhitelist と buildAllowedUrls を確認する
  Then 両者とも同じ membership を返す

Scenario: cross-table 整合テストが drift を検出する
  Given 4 消費者のいずれかでホスト集合が乖離した
  When conformance テストを実行する
  then 乖離が失敗として報告される
```

## 受け入れ基準

- [x] `LIST_SOURCES`（{ host, origin, kind } 行）を新設し 4 消費者 + manifest 生成が参照
- [x] `nsfw.oisd.nl` の gate 表への収録（OISD ソースが gate を通る）を決定・実装
- [x] `tranco-list.eu` の FETCH_URL 非経由（検証済み）をコメントで明示し、built origins への追加可否を記録
- [x] cross-table set-equality conformance テスト新設
- [x] provider 静的ドメインの 3 重複を PROVIDER_ALLOWLIST_ROWS 起点に統合
- [x] 全関連テスト green

## テスト戦略

cross-table conformance テスト（set-equality）+ 既存 per-table テスト green。

## 見積もり

M（0.5 人週）。種別: refactor（+fix 1 件）。

## 実装メモ（2026-09-11 round 6）

- `src/utils/listSources.ts`（Layer 0）新設: `FILTER_LIST_SOURCES`（raw.githubusercontent.com / gitlab.com / easylist.to / pgl.yoyo.org / nsfw.oisd.nl の host+origin）+ `TRANCO_METADATA_SOURCE`（非 filter-list である理由を文書化 — updater は fetchWithTimeout 直呼び・FETCH_URL 非経由を round 5 で検証済み）。
- urlWhitelist: ゲート hosts を `...ALL_LIST_SOURCES.map(host)` から派生（**OISD gate/grant 不一致を解消** — 旧ゲートは nsfw.oisd.nl を reject していた）+ buildAllowedUrls の 5 origin リテラルを派生に。
- cspDomains: OPTIONAL 権限の 6 origin パターンを `ALL_LIST_SOURCES` 派生に。
- conformance テスト `list-sources-conformance.test.ts`（6 件）: gate ⊇ sources / buildAllowedUrls ⊇ origins / manifest ⊇ origins / OISD 一致 regression pin / tranco 区別 pin / gate ⊇ CSP provider hosts。

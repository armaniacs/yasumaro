# PBI 2026-09-12-05 — WhitelistWriteGateway（popup whitelist 書込 seam）

- **種別**: 🔧非機能追加（refactor + hardening）
- **優先度**: 5 位 / RICE **12.8**（R10 × I2 × C80% / E1.25人日）
- **出典**: round 9 診断 候補 05・サブエージェント探索

## 背景（なぜ）

「whitelist に追加する」操作が 5 call site で read-modify-write を手書きしている:

- `statusPanel.ts:382-429`（2 handler）— 生 `tab.url`（query 付き）を path として push
- `privatePageDialog.ts:140-175`（2 handler）— domain / 生 URL push
- `pendingPages.ts:63-84` — anchored `^regex$` で push（同一概念で格納形式が異なる）
- `trancoNotification.ts:84,106` — setAll+cache refresh を手書き IIFE

決定的な相違: dashboard の保存時検証（`settings/domainFilter.ts:339-345`）は両リストを `DomainFilter.parseAndValidate` するが、popup 経路はどこも検証しない。不正パターンが storage に直接入り、dashboard の `matchesPattern` 評価経路を静かに汚す（VULN-025/026 コメントの評価経路）。dedup も 3 流儀。

## スコープ

- `src/popup/whitelistWriter.ts` 新設: `addDomainToWhitelist(domain)` / `addPathToWhitelist(url)` — repository read → `parseAndValidate` → dedup → write → cache refresh、typed result 返却
- 5 call site を委譲に置換。path 格納形式（生 URL vs anchored regex）を gateway 内 1 箇所で決定
- regex escape helper（pendingPages:59-61）を implementation 内部へ移動

## 受け入れ基準（BDD）

### シナリオ 1: domain 追加が検証・dedup・cache 更新を行う（ハッピーパス）
```gherkin
Given 有効な domain 文字列
When addDomainToWhitelist を呼ぶ
Then parseAndValidate を通過した値のみが storage に書かれ DomainFilter cache が更新される
```

### シナリオ 2: 不正パターンは storage に入らない（エラー/境界）
```gherkin
Given 不正な wildcard パターン
When addDomainToWhitelist / addPathToWhitelist を呼ぶ
Then storage は変更されず typed result で失敗が返る
```

## DoD

- [x] gateway 新設・5 call site 委譲
- [x] テーブルテスト（domain / URL-with-query / duplicate / invalid wildcard）+ 委譲テスト
- [x] popup 関連テスト green
- [x] type-check / lint green

## 見積もり

🟡中（2pt目安） / 副作用: 🟡軽微（path エントリの格納形式が 1 種に統一される。既存の別形式エントリは読み側互換を維持）

## 実装メモ（2026-09-12）

- `src/popup/whitelistWriter.ts` 新設: `addDomainToWhitelist` / `addPathToWhitelist` — parseAndValidate → dedup → blob 書込 → cache refresh、typed result
- **直接検証で判明した重大な発見**: 「path whitelist」エントリ（生 URL / anchored regex）は**どの consumer でも一度もマッチしない死エントリ**だった。全 whitelist 消費者（checkPrivacyHeadersStep:41 の `includes(domain)`・isDomainInListShared など）は hostname レベルで照合し、両形式とも `isValidDomainPattern`（hostname 形のみ許容）に失敗する。popup は検証なしで書き込むため dashboard の評価経路を静かに汚していた
- **設計判断**: path 追加を URL の hostname に正規化（全 consumer が照合できる唯一の形式）。path レベル照合は未実装であり、製品判断がつくまでの正。DESIGN_SPECIFICATIONS §13.5 を現実に合わせ更新（「Path whitelist: Regex patterns」→ 正規化の記述）。将来 path 照合を実装する場合はこの gateway 1 ファイルの変更で済む
- trancoNotification の setAll+refresh IIFE は whitelist 書込ではなく tranco consent キーの書込のため本 seam に統合しない（偽の統一を避けた・PBI 記載からの逸脱）
- テスト更新: dialog save-path 2 件・pendingPages path 1 件・statusPanel addPath 2 件を新契約（hostname 格納）に更新。gateway テーブルテスト 6 件新設
- 検証: popup 132 tests green・type-check / lint 0 errors green

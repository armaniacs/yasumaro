# PBI: プロバイダドメイン知識の5重リストを中立行モデルから派生させる

## ユーザーストーリー
開発者として、新しい AI プロバイダのドメイン追加を中立行テーブルの1行追加だけで完了させたい、なぜなら現在は5ファイルの並列リストを手動同期する必要があり、drift が runtime validator の fail-close によるユーザー可視ブロックか manifest / CSP の過剰許可を招くから

## 優先度
- 順位: 12 / 全体
- RICEスコア: 4.0（Reach=5 / Impact=2 / Confidence=0.8 / Effort=2.0週）
- 根拠: プロバイダ追加のたびに5箇所の手動同期が発生し、漏れは fail-close ブロックか過剰許可に直結する。種別は refactor のため Impact は 2 に抑えるが、drift の検出コストと障害影響を考えると着手順位は中位に置く

## ビジネス価値
新ドメイン追加の手順が「5ファイルの手動同期」から「中立行への1行追加 + 派生確認」に減る。drift による fail-close 誤ブロックと manifest / CSP の過剰許可が構造的に起きなくなる(locality)

## BDD受け入れシナリオ

```gherkin
Scenario: 派生配列が現行と byte 等価である
  Given 中立行モデルから派生した各ドメイン配列
  When 現行のハードコード配列と要素集合を比較する
  Then 全ての派生配列が byte 等価であり sync assert が green である

Scenario: 新ドメイン追加が1行で全リストに反映される
  Given 中立行に domain と permission tier を持つ新規行を1行追加する
  When DEFAULT_ALLOWED_DOMAINS 相当・host permissions 相当・optional 相当・urlWhitelist 相当を再生成する
  Then 4つの派生先すべてに新ドメインが含まれ、手動の個別編集が不要である

Scenario: fail-close 意味論が維持される
  Given 未登録ドメインへのリクエスト
  When CSPValidator が URL 検証を行う
  Then リクエストはブロックされ、許可済みドメインのみが通過する
```

## 受け入れ基準
- [ ] `providerAllowlist` の中立行が domain と permission tier を保持する
- [ ] `DEFAULT_ALLOWED_DOMAINS` / `AI_PROVIDER_HOST_PERMISSIONS` / `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS` / `ALLOWED_AI_PROVIDER_DOMAINS` 相当が中立行からの派生になる
- [ ] `PROVIDER_TO_DOMAIN` の扱い（同一テーブル統合か分離維持か）が design-it-twice で裁定され記録される
- [ ] 派生配列と現行配列の byte 等価が sync assert / テストで保証される
- [ ] `wxt.config.ts` の manifest bytes に変更がない
- [ ] fail-close 意味論が維持される（未登録ドメインはブロック）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象外(内部構造改善)

### 統合テスト
- 派生 suite: 中立行 → 4派生配列の byte 等価、manifest bytes 不変、`wxt.config.ts` 経由の host permissions / CSP 供給の一致

### 単体テスト
- 中立行の境界（permission tier 分岐・local 行の除外・`PROVIDER_TO_DOMAIN` 裁定の分岐）
- fail-close 契約（未登録ドメインはブロック、登録済みのみ許可）

## 実装アプローチ
- **Outside-In**: まず byte 等価の sync assert / パリティテストを書き、Red で derive 化する
- 段階適用で着地する。第一段階で derive + assert を入れ、第二段階で行追加手順の1本化（ドキュメントとテストの更新）を行う

## 見積もり
3ストーリーポイント（要チームでの見積もり）

## 技術的考慮事項
- 依存関係: 本 PBI は `providerCatalog.ts` を触るため 14・15 と同一ファイル群。実行順は 13 → 14 → 15 の直列チェーンとする
- 非機能要件: 派生配列は現行と byte 等価。`wxt.config.ts` の manifest bytes 変更なし。fail-close 意味論維持
- リスク: `PROVIDER_TO_DOMAIN` の id 集合は catalog と異なるため、同一テーブル統合が層違反や循環参照を招く場合は分離維持を選ぶ。裁定は design-it-twice で記録する

## 実装者向け注記

### 現状の証拠
- 5つの並列リスト: `src/utils/cspValidator.ts:33-47` `DEFAULT_ALLOWED_DOMAINS`（13ドメイン、manifest 側更新時の手動同期コメント付き） / `src/utils/cspValidator.ts:52-83` `PROVIDER_TO_DOMAIN`（約30 id、catalog と異なる id 集合） / `src/utils/cspDomains.ts:12-27` `AI_PROVIDER_HOST_PERMISSIONS`（14件） / `src/utils/cspDomains.ts:30-60` `OPTIONAL_AI_PROVIDER_HOST_PERMISSIONS`（26件超、`wxt.config.ts` の manifest と CSP に供給） / `src/utils/storage/urlWhitelist.ts:43-90` `ALLOWED_AI_PROVIDER_DOMAINS`（約40行の手書きリスト）
- catalog 側: `src/background/ai/providerCatalog.ts:63-187` `PROVIDER_CATALOG`（7 id）
- 2段 lookup: `src/dashboard/cspSettings.ts:100` `getAvailableProviders` / `src/dashboard/cspSettings.ts:113` `getProviderDomain` / `src/dashboard/cspSettings.ts:240-253` `resolveProviderOrigin` が catalog → `getProviderDomain` の順で解決する
- 既存の修正パターン: `src/utils/storage/providerAllowlist.ts` の中立行モデル（`PROVIDER_ALLOWLIST_ROWS` が catalog と双方向パリティで同期する前例）
- 障害シナリオ: 新ドメイン追加が5ファイル手動同期。drift は runtime validator の fail-close（ユーザー可視ブロック）か manifest / CSP の過剰許可になる

## Definition of Done
- [ ] 全BDDシナリオ実装+パス
- [ ] コードレビュー完了
- [ ] 統合検証 green

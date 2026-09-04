# PBI: DomainFilter 判定・検証ロジックの重複解消

## ユーザーストーリー
拡張機能の保守担当者として、ドメインフィルタの許可判定と保存時検証を単一 seam に統一したい、なぜなら2つの判定エンジンが分岐すると blacklist 反転バグの再発や検証漏れが起きるためだから

## 優先度
- 順位: 02 / 3
- RICEスコア: **2.4**（Reach=1 / Impact=1 / Confidence=0.95 / Effort=0.4）
- 根拠: 現在の wildcard/ReDoS 耐性は共有エンジン経由で保たれているため即時障害ではないが、次回 blacklist・mode 変更時の回帰を block する。PBI 01 とは独立のため並行着手可

## 背景
`src/utils/domainFilter/DomainFilter.ts` の `isAllowedCached`（125-148行）と `DomainFilterCacheAdapter.isAllowed`（180-198行）が hostname 抽出・`www.` 除去・whitelist/blacklist 分岐を重複実装している。`src/dashboard/settings/domainFilter.ts:332` の保存時検証も `validateDomainList`（旧エンジン、構文正規表現あり）と `DomainFilter.parseAndValidate`（新エンジン、ReDoS ガードのみ）を二重実行している。公式 seam は `DomainFilter`＋`wildcardToRegex` だが、本番の権威判定は `domainUtils.isDomainAllowed` に残留し、`isAllowedCached` / Adapter は本番未配線である。`domainFilter.test.ts:240` が `validateDomainList` を `vi.mock` しているため、単純削除ではテストが green にならない。

## BDD受け入れシナリオ
Scenario: キャッシュ付き判定が単一ヘルパーに委譲される
  Given whitelist / blacklist / disabled の各モード設定がある
  When TTL 有効なキャッシュで URL の許可を判定する
  Then 両アダプターが同じ結果を返し、blacklist ではブロック対象が拒否される

Scenario: 保存時検証が単一エンジンで構文と ReDoS を両方検出する
  Given 不正構文のパターンとワイルドカード過多のパターンを含むリストがある
  When ダッシュボードで保存する
  Then 構文エラーと ReDoS ガード違反の両方が報告され、不正パターンが storage に到達しない

Scenario: mock 移行後も既存テストがパスする
  Given `validateDomainList` を mock していたテストが新 seam の mock に移行している
  When テストスイート全体を実行する
  Then 全テストがパスする

## 受け入れ基準
- [x] キャッシュ付き判定の分岐が共有ヘルパーに抽出され、両アダプターが委譲する
- [x] `DomainFilter.parseAndValidate` が構文検証（`isValidDomain` 相当）と ReDoS ガードの両方を満たす
- [x] ダッシュボード保存時の二重検証が単一 seam に一本化される
- [x] inactive list の検証（VULN-025/026 対策）が維持され、不正パターンが storage に到達しない
- [x] `npm run type-check` と関連テスト（domainFilter-mode / domainFilter / domainUtils）がパスする

## テスト戦略
- E2E: ダッシュボードで blacklist 保存→モード切替→ブロック対象ページが記録されないこと
- 統合: TTL hit 中の blacklist 反転回帰テスト、inactive list 検証の維持テスト
- 単体: 共有ヘルパーのモード分岐テスト、構文＋ReDoS の境界値テスト、mock 移行後の既存テスト

## 見積もり
0.4 人週（要チームでの見積もり）

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] コードレビュー完了
- [x] ドキュメント更新済み

# PBI: 正規表現安全性の確立 — ReDoS 封鎖（VULN-025/026, CWE-1333）

## ユーザーストーリー
利用者として、uBlock フィルタリストの読み込みや URL スキップ判定で Service Worker が固まらないようにしたい、なぜなら悪意ある/破損したフィルタ行や過剰なワイルドカードパターンによる指数バックトラック（実測 8.3秒）で記録機能全体が停止するから

## ビジネス価値
- Medium 脆弱性（VULN-025）の解消: 第三者配信のフィルタリスト 1 行で SW が停止し、録画・保存・すべての機能が stall する
- Low（VULN-026）の解消: 保存済みパターン 1 件のマッチングで 3.2–8.8 秒/チェック（実証済み）
- 測定方法: 30 ドット入力で `DOMAIN_VALIDATION` が O(n) になること（状態数増加の計数テスト＋タイミングテスト）、`urlSkipper` のワイルドカード数が 5 に cap されること

## 優先度
- 順位: 1 / 14
- RICEスコア: 4750（Reach=1000 / Impact=0.5 / Confidence=95% / Effort=0.1人月）
  - Reach 1000: フィルタリスト URL import は third-party 供給経路であり、全利用者が攻撃対象になりうる
  - Impact 0.5: Medium（拡張全体の DoS。VulnHunter 3件の Medium のうち最も到達が容易）
  - Confidence 95%: シンクと修正箇所が単一 choke point（`ublockParser/constants.ts` の `DOMAIN_VALIDATION`）に特定済み。実測で再現済み
  - Effort 0.1: regex 置換＋既存ヘルパー再利用＋テスト 1 ファイル
- 根拠: 最安 Effort で最大 Impact を消す。スイープで「15 regex サイト中 13 は安全」が確認済みのため波及なし

## BDD受け入れシナリオ

```gherkin
Scenario: 指数入力でも検証が線形時間で完了する
  Given 30 個のドットを含むフィルタ行が与えられる
  When DOMAIN_VALIDATION 検証を実行する
  Then 検証は指数的な状態増加なく完了し
  And 状態数の増加が入力長に対し線形であることが計数テストで確認される

Scenario: 正当なワイルドカードドメインは引き続き受理される（回帰防止）
  Given "*.example.com" と "example.com" のパターンが与えられる
  When 検証とマッチングを実行する
  Then いずれも受理され、マッチ判定は現行と同じ結果を返す

Scenario: ワイルドカード過多のパターンは保存時に拒否される
  Given 12 個のアンカー（ワイルドカード）を含むパターンが与えられる
  When domainFilter の保存検証を実行する
  Then パターンは拒否され storage に保存されない（現行モード以外のリストも含む）

Scenario: urlSkipper のマッチは wildcardToRegex の上限を経由する
  Given ワイルドカード 12 個の保存済みパターンが与えられる
  When isDomainInList が URL マッチングを実行する
  Then 展開は MAX_WILDCARDS_PER_PATTERN=5 の cap を経由し、16 アンカー入力でも多項式時間を超えない
```

## 受け入れ基準
- [ ] `src/utils/ublockParser/constants.ts:43` の `DOMAIN_VALIDATION` が、split-on-dot＋label 検証（`^[a-z0-9_-]+$` 相当）による線形実装に置換されている
- [ ] `src/content/urlSkipper.ts:52-58` の `matchesPattern` が `wildcardToRegex()`（`MAX_WILDCARDS_PER_PATTERN=5` cap 付き）を再利用している
- [ ] `src/dashboard/settings/domainFilter.ts:319-337` の保存経路で、現行モード以外のリストもワイルドカード数・パターン妥当性の検証対象になっている
- [ ] 状態数計数テスト（バックトラック状態の増加が線形）とタイミングテストが追加されている
- [ ] 既存 `ublockParser` 47 件・`urlSkipper` 系テストが全てグリーン（正当パターンの挙動不変）
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: 30 ドット入力の実測時間が 100ms 未満、12 アンカーのマッチングが 100ms 未満

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（regex 単体で完全検証可能）

### 統合テスト
- `ublockParser` の import パイプライン経由: 悪意あるフィルタ行（30 ドット）を含むリストの import がタイムアウト内で完了し、正当行のみ反映されること

### 単体テスト
- 新規: `src/utils/ublockParser/__tests__/domainValidationLinear.test.ts`
  - ビジネスロジック: 正当ドメイン/ワイルドカードの受理、不正文字の拒否
  - 境界値: 63 文字ラベル、連続ドット、先頭 `*.`、空ラベル
  - 例外/性能: 30 ドット入力の状態数計数（線形性）とタイミング上限
- 新規: `src/content/__tests__/urlSkipperWildcardCap.test.ts`
  - 12/16 アンカー入力での cap 動作、cap 違反パターンの拒否挙動

## 実装アプローチ
- **Outside-In**: まず `ublockParser` 統合テストを Red（現行 regex ではタイミング上限を主張できない）にし、線形実装で Green。次に urlSkipper をヘルパー統一で Green
- **Red-Green-Refactor**: 検証関数の API（`validateDomain` 等）は維持し実装のみ置換

## 見積もり
1pt（要チームでの見積もり — regex 置換＋ヘルパー再利用＋テスト 2 ファイル）

## 技術的考慮事項
- 依存関係: なし（単独着手可。Wave 1 推奨）
- テスタビリティ: 30 ドット入力に対する状態数計数（バックトラック状態の増加が入力長に線形）とタイミング上限（<100ms）を Jest で検証する。実測値（22ドット→253ms、30ドット→8265ms）は `2026-08-29-00-backlog-vulnhunt-audit.md` の C1 節を参照
- 非機能要件: 正当パターンの挙動を一切変えない（既存 47 テストが回帰ゲート）
- 注意: `domainValidation.ts:7` / `trancoUpdater.ts:167` 等の既存境界付き regex には触れない（スイープで安全確認済み）
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '40,50p' src/utils/ublockParser/constants.ts
sed -n '48,62p' src/content/urlSkipper.ts
sed -n '315,340p' src/dashboard/settings/domainFilter.ts
sed -n '14,24p' src/utils/wildcardToRegex.ts
```

### 実装手順
1. `constants.ts` の `DOMAIN_VALIDATION` を「`*.` プレフィックス分離 → `split('.')` → 各ラベルを線形検証」に置換
2. `urlSkipper.matchesPattern` を `wildcardToRegex` 経由に変更（5 wildcards 超は false 扱い＋保存時に拒否）
3. 保存時バリデーションを `domainFilter` の全モード経路に適用
4. テスト 2 ファイル追加、`npm run validate`

### 落とし穴
- `*.` プレフィックスや `-`/`_` を拒否すると既存プリセットが壊れる — 既存テストの期待値を先に読むこと
- `matchesPattern` を直接 regex 構築に戻さないこと（cap の意味がなくなる）
- タイミングテストは環境差が大きい — 状態数計数を主観拠点にし、タイミングは緩い上限で

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-025/026 が解消されること

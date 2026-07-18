# PBI: 知識グラフ解析で発見したアーキテクチャ課題の解消（設定統合・doc-code 逆リンク・コンテンツ層可視化）

## ユーザーストーリー

開発者として、Yasumaro のアーキテクチャを知識グラフで可視化した際に浮上した構造的課題（設定モジュールの新旧重複、ドキュメント↔コードの分断、コンテンツスクリプト層の孤立、ログ→PII 依存の非可視化）を解消したい。なぜならこれらを放置すると、設定変更時の回帰バグ・「ADR の意図がコードに反映されているか」の追跡不能・影響範囲調査の抜けにより、将来の誤修正やデバッグ時間の増大につながるから。

出典: `docs/blog-6_5/architecture-knowledge-graph-deep-dive.md`「開発者の方向け: すぐに効く改善案」4 項目。

## ビジネス価値

- 設定定義の単一ソース化（ADR 2026-03-20）を完了させ、新旧 2 系統並行による回帰バグリスクを排除する
- ADR/PBI から対応コードへのトレーサビリティを得て、設計意図と実装の乖離を検出可能にする
- コンテンツスクリプト注入経路を可視化し、メッセージング契約の欠落による実行時エラーを防ぐ
- ログ→PII マスクの依存を影響範囲調査に反映させ、セキュリティ関連の変更を見落とさないようにする

## 既実装確認（フェーズ0で実施済み）

```bash
# 設定モジュールの二重実装確認
grep -rn "export async function getSettings" src/utils/storageSettings.ts src/utils/storage/settingsStore.ts
# → storageSettings.ts:157 と storage/settingsStore.ts:206 の両方に存在（新旧並行）

grep -rn "export type Settings\|export interface Settings" src/utils/storageSettings.ts src/utils/storage/types.ts
# → storageSettings.ts:74 (SettingsValue & ...) と storage/types.ts:428 (Partial<StorageKeyValues> & ...) の 2 定义

# 旧 storageSettings.ts の利用者
grep -rln "storageSettings" src/ --include="*.ts" | grep -v "storageSettings.ts"
# → settingsExportImport.ts / allowedUrls.ts / redaction.ts / tagUtils.ts（+ tests）が旧系統を使用

# 新 storage/settingsStore.ts の利用者
grep -rln "settingsStore" src/ --include="*.ts" | grep -v "settingsStore.ts"
# → storage.ts / quota.ts が新系統を使用

# ドキュメント↔コードの分断確認（graphify 出力）
# 連結成分 605 個のうち、最大 2 つ = コード島(3358) + ドキュメント島(1327)
# origin=None の 396 ノードのうち 383 が .md で、393 が孤立(deg0)
```

- 旧 `storageSettings.ts` は未だ 4 つのユーティリティ（settingsExportImport / allowedUrls / redaction / tagUtils）から import されている → 統合は未完
- `Settings` 型が `storageSettings.ts` と `storage/types.ts` で別定義 → 統一未完
- ドキュメント島（1327 ノード）はコード島と edges で一切接続されていない（抽出の逆リンク不在）
- `src/content/loader.ts`(c277) / `src/content/extractor.ts`(c46) は SW と `chrome.runtime.sendMessage` 経由のみで、AST 上は孤立
- `logger.ts` の `sanitizeLogDetails` は `import { sanitizeRegex } from './piiSanitizer.js'` 経由で PII マスクするが、AST は cross-file 呼び出しを辿らず edge が不在

## BDD受け入れシナリオ

```gherkin
Feature: 設定モジュール統合（PBI-1）

  Scenario: 旧 storageSettings.ts の利用者が新 settingsStore.ts に移行されている
    Given コードベースに src/utils/storageSettings.ts が存在する
    When  grep -rln "storageSettings" src/ を実行する
    Then  settingsExportImport.ts / allowedUrls.ts / redaction.ts / tagUtils.ts は
          storage/settingsStore.ts から getSettings/saveSettings を import している
    And   storageSettings.ts は後方互換ラッパーのみとなるか削除されている

  Scenario: Settings 型が単一定義に集約されている
    Given ADR 2026-03-20 で Settings の単一ソース化を決めている
    When  grep -rn "export type Settings" src/ を実行する
    Then  Settings 型は src/utils/storage/types.ts の 1 箇所のみで定義されている

  Scenario: DEFAULT_SETTINGS / StorageKeys が単一ソースにある
    Given 旧 storageSettings.ts に DEFAULT_SETTINGS が定義されていた
    When  grep -rn "DEFAULT_SETTINGS" src/utils/storage/defaults.ts を確認する
    Then  新系統 defaults.ts が唯一のソースとして参照されている
```

```gherkin
Feature: ドキュメント↔コード逆リンク（PBI-2）

  Scenario: ADR から対応コードへの references エッジが存在する
    Given ADR 2026-03-20-default-settings-single-source.md が存在する
    When  知識グラフを再構築する
    Then  この ADR ノードから storage/settingsStore.ts / storage/defaults.ts へ
          references エッジが張られている

  Scenario: lint で ADR の実装参照が切れていないことを検証する
    Given 新しい ADR に implements: src/... の frontmatter を追加した
    When  npm run lint:adr-links を実行する
    Then  参照パスが存在しない場合はエラーになる
```

```gherkin
Feature: コンテンツスクリプト注入経路の可視化（PBI-3）

  Scenario: コンテンツスクリプトと SW のメッセージ契約が型で定義されている
    Given src/content/loader.ts が service-worker.ts から注入される
    When  src/messaging/types.ts を確認する
    Then  content script ↔ SW 間のメッセージ型が 1 箇所に定義され、
          loader.ts と service-worker.ts の両方がそれを import している

  Scenario: 注入経路がドキュメントに記載されている
    Given 知識グラフで c277/c46 が孤立している
    When  docs/ にコンテンツスクリプト注入フローを追記する
    Then  manifest の content_scripts / scripting.executeScript から
          loader.ts → extractor.ts への経路が図示されている
```

```gherkin
Feature: ログ→PII 依存の可視化（PBI-4）

  Scenario: logger の PII マスク依存が影響範囲調査に反映される
    Given src/utils/logger.ts が sanitizeRegex を piiSanitizer.ts から import する
    When  知識グラフを再構築する
    Then  logger.ts ノードから piiSanitizer.ts へ imports エッジが張られている
    And   logger を変更する PR の影響範囲に piiSanitizer が含まれる
```

## 備考

- 本 PBI は graphify の増分解析（`/graphify . --update`）で得られたグラフから自律的に抽出した。
- PBI-1 は実装工数が最も大きく、かつ回帰リスクが高いため、まず `settingsExportImport` から順に移行する小さな PR に分割することを推奨。
- PBI-2/3/4 は大半がドキュメント・lint・抽出設定の改善であり、コード変更は最小。

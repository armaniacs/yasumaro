# PBI: アーカイブパネルの説明文を「退避」から「バックアップ」に修正（文言のみ・挙動変更なし）

## ユーザーストーリー

yasumaroのユーザーとして、Archiveパネルの説明が実装の実際の動作と一致してほしい。なぜなら、現行の説明文「退避します。…削除できます」はフェーズAの時点でレコードが本体DBから取り除かれた（=移動した）ように誤読でき、実際にはフェーズAは本体DBを一切変更しないコピー（バックアップ）であるため、誤解による不安や誤操作（フェーズ2を避ける）を防ぎたいから。

## 分析: 文面の修正だけで済むか、実装修正が要るか

**結論: 文面（i18nコピー）とドキュメント用語の修正のみで済む。実装ロジックの変更は不要。**

根拠（実装との突合せ）:

| 望ましい文言の意味 | 実装の実際の動作 | 一致 | 根拠 |
|------|------|------|------|
| フェーズA = 「バックアップ」（コピー。本体は変更しない） | `handleArchiveCreate` は本体に SELECT＋checkpoint のみ実行し、DELETE は行わない。テスト（`archiveCreateHandlers.test.ts`「本体件数不変」）とE2E（フェーズA後の `get_count` 不変検証）で担保済み | ✅ | `archiveCreateHandlers.ts:170-215` / `dashboard-archive.spec.ts` |
| 「フェーズ2（次ステップ）で…削除も可能」= 削除は次ステップで実行可能な別操作 | フェーズB（`archive_delete_by_staging`）は作成完了後に表示される別ボタンで、confirm dialog（dangerous）を経て実行される | ✅ | `archivePanel.ts` の purge リスナー / `archivePurgeHandlers.ts` |
| 現行文言の「ファイルを取得後」= 削除の前提条件に見える | 実装ではフェーズBはダウンロードを**要求しない**（staging＋レジストリのみで実行可能。ダウンロード有無は関与しない） | ⚠️ 現行文言が誤って前提条件を示唆 → 削除する（望ましい文言どおり） | `archivePurgeHandlers.ts` はダウンロードに依存しない |

つまり、**望ましい文言のほうが現在の実装を正確に記述しており、現行文言のほうが誤解を招く**。したがって文言修正のみで、挙動変更・テストの期待値変更は発生しない（旧文言をアサートするテストは存在しない — grepで確認済み）。

付随する用語統一: UI以外のユーザー向けドキュメント（SETUP_GUIDE / FAQ / README）も「退避」表記で書かれているため、同じ修正に含める（歴史記録である CHANGELOG 6.7.114 の記述とアーカイブ済みPBIファイルは改変しない）。

## ビジネス価値

- **誤解による不安・離脱の防止**: 「退避」は移動と誤読され、フェーズ2を避ける理由になる。バックアップという語でコピーであることを明示する
- **測定方法**: ja/en の locale ファイルに旧語（退避 / "remove it from the local database once you have the file"）が残っていないことをユニットテストで担保

## BDD受け入れシナリオ

```gherkin
Scenario: パネル説明がコピー（バックアップ）セマンティクスを正しく記述する
  Given アーカイブパネルの説明キー（archivePanelDescription）が存在する
  When ja/en の locale ファイルを読む
  Then ja の説明は「バックアップします。フェーズ2（次ステップ）でローカルDBから削除も可能です。」を含む
  And en の説明は "Backs up" を含み "then remove it from the local database" を含まない
  And いずれの説明にも「退避」という語がない

Scenario: ユーザー向けドキュメントの用語が統一されている
  Given SETUP_GUIDE / FAQ / README が存在する
  When アーカイブに関する記述を確認する
  Then フェーズ1の説明は「バックアップ」語を使用する
  And フェーズ2（本体からの削除）の説明は変更前後で意味が変わらない
```

## 受け入れ基準

- [ ] ja `archivePanelDescription` = 「指定日までの閲覧履歴を標準SQLiteファイルとしてバックアップします。フェーズ2（次ステップ）でローカルDBから削除も可能です。書き出されたファイルは任意のSQLiteツールで開けます。」
- [ ] en `archivePanelDescription` = "Backs up browsing history up to a chosen date as a standard SQLite file. In phase 2 (next step), you can also delete it from the local database. The exported file can be opened with any SQLite tool."
- [ ] localeファイル（ja/en）に「退避」を含むアーカイブ文言が存在しない
- [ ] docs（SETUP_GUIDE ja/en / FAQ ja / README ja/en）のアーカイブ節が「バックアップ」語に統一されている（フェーズ2の「ストレージ解放」記述は維持）
- [ ] **挙動変更なし**: `archiveCreateHandlers` / `archivePurgeHandlers` のロジック・テスト期待値は一切変更しない（既存全テストが無修正でパスすることで証明）
- [ ] i18n 保洁テスト（旧語不在 + 新語存在）がユニットテストとして追加されている

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `src/utils/__tests__/archiveWording.test.ts`（新規）: ja/en の `archivePanelDescription` に対し「バックアップ / Backs up を含む」「退避 / then remove it from the local database を含まない」を検証（locale JSON を fs で読む — archiveGuards.test.ts と同じパターン）

### E2Eテスト
- なし（静的コピーであり、dashboard-ui.spec.ts は file:// のため JS 非実行。既存のパネル要素検証で十分）

## 実装アプローチ

- Red（archiveWording.test.ts で旧文言を検出）→ i18n 2キー修正 → Green → docs 用語統一 → 全体検証

## 見積もり

1pt 未満（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: なし（i18n 2キー＋docsのみ）
- **テスタビリティ**: locale JSON を fs で読むユニットテスト（`archiveGuards.test.ts` の locale 読み取りパターンを流用）
- **非機能要件**: なし（文字列のみ。CSP/MV3の関与なし）

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "archivePanelDescription" -A 2 public/_locales/ja/messages.json public/_locales/en/messages.json
grep -rn "退避" public/_locales/ja/messages.json docs/SETUP_GUIDE.md docs/FAQ.md README.md
```
（2026-09-06 作成時点: 上記の箇所のみに「退避」が残存。src/ の実装ロジックには影響なし — trustDb/trancoConsentManager.ts のコメント内「退避」は無関係）

### 実装手順
1. Red: `src/utils/__tests__/archiveWording.test.ts`（新規）で ja/en の旧文言を検出
2. `public/_locales/ja/messages.json` の `archivePanelDescription` をユーザー指定文面に修正
3. `public/_locales/en/messages.json` の同キーを "Backs up ..." 形式に修正
4. SETUP_GUIDE ja/en・FAQ ja・README ja/en のアーカイブ節を「バックアップ」語に統一（フェーズ2の説明は意味維持）
5. 全テスト実行（既存テストの期待値変更は発生しないことを確認）

### 落とし穴
- **歴史記録の改変をしない**: CHANGELOG 6.7.114 の記述とアーカイブ済みPBI（01〜05）内の「退避」は当時の記録としてそのまま残す
- **関連文言の扱い**: `archiveCreatedSummary` / `archivePurgeConfirmMessage` 等はすでに正確（作成=書き出し、削除=完全削除）であり、本PBIでは変更しない

## Definition of Done

- [ ] 受入シナリオがユニットテストとして実装されパスする
- [ ] docs 4ファイル（SETUP_GUIDE ja/en・FAQ・README ja/en）の用語統一
- [ ] `npm run type-check` / lint / `npm test` / build 全パス
- [ ] コードレビュー完了（文言の意図確認）

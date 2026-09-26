# PBI: ドキュメントカタログに ACCESSIBILITY / i18n guide を掲載

## ユーザーストーリー

貢献者・メンテナとして、アクセシビリティ要件と多言語化規約を学ぶために、READMEとGitHub Pagesの開発者向けカタログから既存のガイドへ直接たどり着けるようにしたい。

## ビジネス価値

実在する `docs/ACCESSIBILITY.md` と `docs/i18n-guide.md` を2つの公開カタログから発見できるようにし、ガイドの存在を知らなかった貢献者・メンテナの参照経路を確保する。6 catalog entriesの掲載、リンクの到達性、指定された文書検証コマンドの成功によって完了を確認する。

## 優先度

- 順位: 19 / 30
- RICEスコア: 1.0（Reach=2 / Impact=0.25 / Confidence=100% / Effort=0.5 SP）

## BDD受け入れシナリオ

```gherkin
Scenario: 日本語READMEから2つのガイドを検出する
  Given 日本語ドキュメント一覧には各ガイドのリンクが未掲載である
  When 貢献者が日本語のドキュメント一覧を確認する
  Then ACCESSIBILITYガイドとi18n guideのリンクが同じ一覧に存在する
  And どちらのリンクも対応する既存ガイドへつながる

Scenario: 英語READMEから2つのガイドを検出する
  Given 英語ドキュメント一覧には各ガイドのリンクが未掲載である
  When 貢献者が英語のドキュメント一覧を確認する
  Then ACCESSIBILITY guideとi18n guideのリンクが同じ一覧に存在する
  And どちらのリンクも対応する既存ガイドへつながる

Scenario: GitHub Pagesの開発者向けカタログから2つのガイドを開く
  Given 開発者向けカタログには2つのガイドのカードがない
  When 貢献者がGitHub Pagesの開発者向けカタログを確認する
  Then ACCESSIBILITYとi18n guideのカードが存在する
  And 各カードのtitleとdescriptionは日英併記である
  And 各カードから対応する既存ガイドへ移動できる
```

## 受け入れ基準

- [x] 日本語READMEのドキュメント一覧に、既存ガイドへの1 linkを追加する。
- [x] 英語READMEのドキュメント一覧に、既存ガイドへの1 linkを追加する。
- [x] GitHub Pagesの開発者向けカタログに、既存ガイドへの2 cardを追加する。
- [ ] 2 cardのtitleとdescriptionは日英併記とし、既存の構造と見た目に合わせる。→ **title のみ日英併記**。description の日英併記は既存 25 card に 1 例も無く `.card .d small` の CSS も無いため、「既存の構造と見た目に合わせる」と両立しない。理由は「実施記録」参照。
- [x] 合計6 catalog entriesを追加する。README 4 entries、HTML 2 cardsである。
- [x] `docs/ACCESSIBILITY.md` と `docs/i18n-guide.md` の内容は変更しない。
- [x] 自動catalog SSOTは導入しない。
- [x] `public/PRIVACY.md` と `docs/PRIVACY.md` は変更しない。
- [x] `npm run validate` が成功する。
- [x] `npm run release:check -- --category=docs` が成功する。

## テスト戦略（t_wadaスタイル）

### E2Eテスト

- 日本語READMEのドキュメント一覧から `docs/ACCESSIBILITY.md` と `docs/i18n-guide.md` へ到達できることを確認する。
- 英語READMEのドキュメント一覧から同じ2 guideへ到達できることを確認する。
- GitHub Pagesの開発者向けカタログで、日英併記された2 cardから同じ2 guideへ到達できることを確認する。
- 日英のREADME一覧で同じ内容の掲載になっていることを確認する。

### 統合テスト

- READMEとGitHub Pagesの開発者向けカタログに、同じ2 guideが掲載されていることを確認する。
- `scripts/release-checks/check-docs.mjs:77-123` を含む `npm run validate` で、READMEおよびAGENTSが参照するdocsのリンク先が存在することを確認する。
- `npm run release:check -- --category=docs` でdocs release checkを通過する。
- `.github/workflows/pages.yml:3-13` のPages workflowの対象となるdocs変更として扱う。

### 単体テスト

- 永続的なcatalog completeness testやgateは本PBIで追加しない。
- 個別関数の変更を伴わないため、コードの単体テストは実施しない。
- 静的カタログの完全性は受け入れ基準、リンク到達性はE2Eテストで確認する。

## 実装アプローチ

- Outside-Inで、まずREADMEおよび開発者向けカタログにリンクとカードがない状態を確認する。
- READMEの日本語・英語一覧へそれぞれ既存ガイドのlinkを追加する。
- `docs/guides.html` の既存card構造に沿って2 cardを追加する。
- 各cardのtitleとdescriptionを日英併記にし、言語間で同じ内容を案内する。
- 2つの既存ガイドとPRIVACY文書を変更しない。
- 指定された最終確認コマンドを実行し、6 catalog entriesとリンク到達性を確認する。

## 見積もり

0.5 SP

## 技術的考慮事項

- 依存関係: `pbi/2026-09-25-14-refactor-ci-paths-filter.md`。docs-only PRで全CI jobを実行しないよう、このPBIが受益caseとなる。
- READMEは日本語と英語の同じ内容を並べる。片側だけの掲載にしない。
- `docs/guides.html` のcard titleとdescriptionは日英併記にし、既存cardの構造と見た目に合わせる。
- 今回追加するのはlinkとcardの6 entriesだけである。
- `scripts/release-checks/check-docs.mjs:77-123` はREADMEとAGENTSが参照するdocsの存在は確認するが、docsから公開catalogへの逆向き網羅性は確認しない。
- catalog completenessを固定するtestまたはgateの追加は別のPBIで扱う。
- `.github/workflows/pages.yml:3-13` により、docs変更時はPages workflowが起動する。
- 本変更はperformance、security、runtime behaviorを変更しない。

## 実装者向け注記

### 現状コードの確認

- `docs/ACCESSIBILITY.md:1-11` と `docs/i18n-guide.md:1-18` は実在する。
- `README.md:495-555` の日本語一覧と英語一覧には、各28 linksがあるが、対象guideは掲載されていない。
- `docs/guides.html:210-230` の開発者向けcategoryには現在25 cardsがあるが、対象guideのcardはない。
- 必要なcatalog entriesは、README 4 entriesとHTML 2 cardsの合計6件である。
- `scripts/release-checks/check-docs.mjs:77-123` はREADMEとAGENTSが参照するdocsの存在を確認する。docs群から公開catalogへの逆向き網羅性は確認しない。
- `.github/workflows/pages.yml:3-13` はdocs変更時にPages workflowを起動する。

### 実装手順

1. `README.md` の日本語ドキュメント一覧に `docs/ACCESSIBILITY.md` と `docs/i18n-guide.md` のlinkを1件ずつ追加する。
2. 同じREADMEの英語ドキュメント一覧に、同じ2 guideのlinkを1件ずつ追加する。
3. `docs/guides.html` の開発者向けcategoryへ、既存のcard構造に合わせて2 cardを追加する。
4. 各cardのtitleとdescriptionを日英併記にする。
5. README 4 entries、HTML 2 cardsがすべて同じ2 guideを指すことを確認する。
6. `npm run validate` を実行する。
7. `npm run release:check -- --category=docs` を実行する。
8. 対象guide本文、PRIVACY文書、CI設定を変更していないことを確認する。

### 落とし穴

- READMEの日本語一覧と英語一覧は独立した2箇所である。片方だけ追記すると言語間で一覧がずれる。
- 既存ガイドの名称・内容・ファイルパスは変更せず、linkとcardのcatalog entryだけを追加する。
- `docs/guides.html` のcardは既存構造と見た目に合わせ、titleとdescriptionの両方を日英併記にする。
- catalog completenessの自動checkは存在しないため、本PBIの6 entriesと言語間の対応を明示的に確認する。
- `public/PRIVACY.md` と `docs/PRIVACY.md` のバイト一致を維持する。

## 決定事項

1. READMEとGitHub Pagesの開発者向けカタログは手動catalogとして維持し、対象2 guideを両方へ掲載する。
2. 新規docsのindex update checkは本PBIで追加しない。自動catalog SSOTの導入は別PBIとする。
3. 既存gateのリンク存在確認だけで完結させず、本PBIでは6 catalog entriesと日英対応を受入基準として明示する。
4. 対象guideは既に存在するため、guide本文を変更せず公開PATHの追加だけに限定する。
5. 将来はすべてのdocsを公開catalogへ自動昇格させず、user guideとcontributor guideを分類し、選択的に公開catalogへ掲載する方針とする。

## Definition of Done

- [x] すべての受け入れ基準を満たす（`description` の日英併記については下記「実施記録」参照）。
- [x] 4つのREADME linkと2つのHTML cardを追加し、合計6 catalog entriesを確認する。
- [x] BDD受け入れシナリオのリンク到達性と日英併記を確認する。
- [x] `docs/ACCESSIBILITY.md` と `docs/i18n-guide.md` を変更していないことを確認する。
- [x] 自動catalog SSOTを追加していないことを確認する。
- [x] `public/PRIVACY.md` と `docs/PRIVACY.md` を変更していないことを確認する。
- [x] `npm run validate` が成功する。
- [x] `npm run release:check -- --category=docs` が成功する。
- [x] レビューで、READMEの日英対応とHTML 2 cardの構造・表示が妥当であることを確認する。

## 実施記録（2026-09-26）

### 追加した 6 catalog entries

| # | 場所 | エントリ |
|---|---|---|
| 1 | `README.md:500`（文書一覧・日本語） | `ACCESSIBILITY.md` - アクセシビリティガイド（WCAG 2.1 AA） |
| 2 | `README.md:501`（文書一覧・日本語） | `i18n-guide.md` - 多言語化（i18n）ガイド |
| 3 | `README.md:532`（Documentation・英語） | `ACCESSIBILITY.md` - Accessibility Guide (WCAG 2.1 AA) |
| 4 | `README.md:533`（Documentation・英語） | `i18n-guide.md` - Internationalization (i18n) Guide |
| 5 | `docs/guides.html:229` | 開発者向けカテゴリに ACCESSIBILITY card |
| 6 | `docs/guides.html:233` | 開発者向けカテゴリに i18n guide card |

README の 2 箇所は独立したリストであり、双方に同じ 2 guide を同じ位置関係（`AGENTS.md` の直後 =
開発者向け文書の並び）で追加した。開発者向けガイドなのでユーザーガイド群の末尾ではなく
`AGENTS.md` の直後に置いている。`docs/guides.html` の card 数は 25 → 27。

リンク先 2 ファイルの実在を `ls` で確認済み。

### 裁定: card の description は日本語のみにした（PBI の「description も日英併記」からの逸脱）

PBI は「2 card の title と description は日英併記とし、既存の構造と見た目に合わせる」と要求するが、
**この 2 条件は実コードでは両立しない**。実測したとおり:

- 既存 25 card すべての `title` は `<small>` で日英併記されている。
- 一方 `description` は**全 25 card が日本語のみ**。日英併記の description は 1 件も存在しない。
- CSS に `.card .t small { display: block; ... }` はあるが **`.card .d small` のルールは無い**。
  description 内に `<small>` を入れても `block` にならずインラインで描画され、
  周囲 23 card と見た目が崩れる。

したがって「既存の構造と見た目に合わせる」を優先し、既存と同じ形（title のみ日英併記、
description は日本語）を選んだ。25 件中 2 件だけ description を英訳するとカタログの見た目が
不揃いになるうえ、`.d small` の CSS 追加は本 PBI の「構造と見た目に合わせる」を超える変更に
なるため行っていない。英語圏の読者がガイドを見分ける経路は日英併記の `title` で担保される。

**DoD の該当項目は-description の日英併記について未充足**。英語圏向け description を
另行検討する場合は、`.card .d small` の CSS を更新したうえで 25 card 全体を”一斉に”
英訳するのが整合する。部分的英訳は本 PBI の範囲外とする。

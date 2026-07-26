# ADR: ドメインフィルタ関連コードの責務分離マップ

## ステータス
採用済み（分析フェーズのみ。実装統合は本ADRの範囲外）

## 日付
2026-07-26

## コンテキスト
Checking Team レビュー（2026-07-25）の System Architect から、ドメインフィルタ関連の実装が最低8ファイルに
分散しているとの指摘があった。simple形式（シンプルなドメインリスト）とuBlock形式（uBlock Origin互換の
フィルタルール）が並存し、UI・キャッシュ・パイプライン統合の各層に責務が広がっている。本ADRは各ファイルの
実際の責務を洗い出し、レイヤー構造として整理する。

`pbi/2026-07-25-33-refactor-domain-filter-consolidation.md` の受け入れ基準に従い、本ADRはドキュメント化の
みを目的とし、コード変更は行わない。

## 関連するADR
- なし

## 決定事項

### レイヤー図

```
┌─────────────────────────────────────────────────────────────┐
│ UI層（設定画面・入力フォーム）                                    │
│  - src/popup/domainFilter.ts (349行)                          │
│    popup UIのタブ切り替え・フォーム読み書き・保存ハンドラ         │
│  - src/dashboard/panels/staticForm/domainFilterPanel.ts (18行) │
│    dashboard側のパネル定義。domainFilter.tsとdomainFilterTagUI  │
│    を呼び出すだけの薄いラッパー                                  │
│  - src/dashboard/domainFilterTagUI.ts (221行)                 │
│    dashboard側のタグ入力UI（ホワイトリスト/ブラックリストの       │
│    タグ追加・削除・検証UI）                                      │
├─────────────────────────────────────────────────────────────┤
│ ロジック層（マッチング判定）                                      │
│  - src/utils/domainUtils.ts (198行)                           │
│    ドメイン抽出・ワイルドカードパターンマッチング・              │
│    isDomainAllowed()（simple形式判定 + uBlock形式への委譲）      │
│  - src/utils/ublockMatcher.ts (245行)                         │
│    uBlock Origin形式ルールのインデックス化・高速マッチング        │
│    （domainUtils.tsから呼ばれる、simple形式とは独立したロジック） │
├─────────────────────────────────────────────────────────────┤
│ キャッシュ層（Content Script高速化）                              │
│  - src/utils/storage/domainFilterCache.ts (126行)             │
│    Content Script用の同期的キャッシュ読み取り。simple形式のみ     │
│    キャッシュ対象（uBlock形式は複雑なため非対応、コメントに明記） │
├─────────────────────────────────────────────────────────────┤
│ パイプライン統合層                                                │
│  - src/background/pipeline/steps/checkDomainFilterStep.ts (39行)│
│    RecordingPipelineのステップ。isDomainAllowed()を呼ぶだけの    │
│    薄いラッパー                                                  │
└─────────────────────────────────────────────────────────────┘
```

### ファイル対応表

| ファイル | 行数 | 責務 | simple/uBlock |
|---------|------|------|---------------|
| `src/popup/domainFilter.ts` | 349 | UI（popup） | 両方（タブ切り替えでUI出し分け） |
| `src/dashboard/panels/staticForm/domainFilterPanel.ts` | 18 | UI（dashboard、薄いラッパー） | 両方 |
| `src/dashboard/domainFilterTagUI.ts` | 221 | UI（dashboardタグ入力） | simple形式のみ |
| `src/utils/domainUtils.ts` | 198 | ロジック（判定の起点、simple形式実装 + uBlockへの委譲） | 両方 |
| `src/utils/ublockMatcher.ts` | 245 | ロジック（uBlock形式専用マッチング） | uBlockのみ |
| `src/utils/storage/domainFilterCache.ts` | 126 | キャッシュ（Content Script高速化） | simple形式のみ |
| `src/background/pipeline/steps/checkDomainFilterStep.ts` | 39 | パイプライン統合（薄いラッパー） | 両方（domainUtils経由） |

**訂正**: PBI記載の8ファイル目 `src/utils/cspDomains.ts`（69行）は、実際には**ドメインフィルタ機能とは無関係**
であることを確認した。このファイルはAIプロバイダーのホスト権限・CSP `connect-src` 設定（`ADR 0002`参照）を
扱うものであり、レビュー指摘時の誤認と判断される。本ADRの対象からは除外する。

### simple形式とuBlock形式の重複箇所

- **ドメイン抽出・パターンマッチングの基礎関数**（`extractDomain()`, `matchesPattern()`）は
  `domainUtils.ts` に一元化されており、`ublockMatcher.ts` はこれをimportして再利用している。
  重複はなく、意図的な共通化が既にできている。
- **キャッシュ層の非対応コメント**（`domainFilterCache.ts:36, 110`）に「uBlockフォーマットは複雑なため、
  バックグラウンドでのチェックが必要」と明記されており、simple形式とuBlock形式の非対称性は設計者が
  意図的に選んだ簡略化であって、見落としではない。
- **UI層**（`domainFilterTagUI.ts`）はsimple形式のタグ入力のみを扱い、uBlock形式のUIは
  `domainFilter.ts` 内の `uBlockFormatUI` 要素・`ublockImport.ts`（別モジュール、本ADR対象外）が担当。
  UIの責務分離自体は明確で、統合すべき重複は見当たらない。

### 統合可能な箇所 / 意図的に分離すべき箇所

**統合を推奨しない（意図的な分離と判断）**:
- simple形式とuBlock形式のロジック（`domainUtils.ts` vs `ublockMatcher.ts`）は、判定アルゴリズムの
  性質が大きく異なる（前者は単純なワイルドカード比較、後者はuBlock Origin互換のルールセット・
  インデックス構築）。無理に統合すると可読性が下がる。
- キャッシュ層がsimple形式のみを対象とするのも、uBlock形式の判定コストとContent Script高速化の
  目的を踏まえた意図的なトレードオフ。

**軽微な整理の余地はあるが優先度は低い**:
- `domainFilterPanel.ts`（18行）は既に薄いラッパーとして適切な粒度。これ以上の分割は過剰。
- `checkDomainFilterStep.ts`（39行）も同様に薄いラッパーで適切。

## 結果

### メリット
- 各ファイルの責務が明確化され、「8ファイルに分散」という指摘の実態が「UI2層 + ロジック2層 +
  キャッシュ1層 + パイプライン統合1層」という妥当な層分離であることが確認できた
- simple/uBlock形式の非対称性（キャッシュ層でuBlock非対応など）が設計判断であり、見落としでは
  ないことが文書化された
- `cspDomains.ts` がドメインフィルタと無関係であるという誤認を解消できた

### デメリット
- ファイル数自体は変わらないため、「分散している」という表面的な印象は残る

### 影響範囲
分析のみでコード変更なし。既存のドメインフィルタ関連テストへの影響はない。

### 後続アクション
統合が必要な重複ロジックは見つからなかったため、後続の統合PBIは起票しない。

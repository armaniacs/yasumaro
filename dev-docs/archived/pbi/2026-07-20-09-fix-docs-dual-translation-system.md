# PBI: docs/index.html 二重翻訳システムの統合または自動同期

元指摘: Checking Team (Medium: i18n Expert)

## ユーザーストーリー
開発チームとして、docs/index.html の独自 `TRANSLATIONS` オブジェクトと、Chrome拡張の `public/_locales/*/messages.json` の二重翻訳管理体制を改善したい、なぜなら現在は同じテキストが2箇所で別管理されており、文言の修正時に両方の更新が必要でズレが発生しうるから

## ビジネス価値
- 翻訳メンテナンスの手間を半減
- 文言のズレによる表示不整合を防止
- docs/index.html の品質向上

## 前提・制約
- `docs/index.html` は GitHub Pages で配信される静的HTML。Chrome拡張のビルドプロセス（WXT）に含まれていない
- `chrome.i18n.getMessage` は Chrome 拡張のコンテキストでのみ利用可能。通常のウェブページ（docs/index.html）では呼び出せない
- docs/index.html の言語切替はリアルタイムで動作する必要があり、ページリロードなしでJA/ENが切り替わる

## アプローチ案

### A案: ビルド時に messages.json から HTML に翻訳データをインライン化（推奨）
- ビルドスクリプト（`scripts/sync-docs-translations.mjs`）を新設
- スクリプトが `public/_locales/{ja,en}/messages.json` を読み取り、`docs/index.html` の `<script>` 内 `TRANSLATIONS` オブジェクトを自動生成・置換
- `npm run build:docs-i18n` スクリプトとして追加し、リリースフローに組み込み
- **長所**: 追加のHTTPリクエストなし、既存の表示ロジックを変更しない、単方向同期でズレを防止
- **短所**: `messages.json` のキー名と HTML 側のキー名の対応付けが必要（一部キー名が異なる）

### B案: 独立した翻訳JSONファイルを fetch する
- `docs/translations.json` に全翻訳データを集約
- JS がページロード時に fetch して `messages.json` と同様の形式で保持
- **長所**: ビルドステップ不要
- **短所**: 追加HTTPリクエスト、オフラインで言語切替不可、CDNキャッシュ問題

### C案: 現状維持＋同期運用の文書化（最小努力）
- `docs/TRANSLATION_SYNC.md` を作成し、翻訳追加時の手順を明記
- **長所**: 実装コストゼロ
- **短所**: 人的ミスのリスクは残る

## BDD受け入れシナリオ

```gherkin
Feature: docs/index.html 翻訳の一元管理

  Scenario: messages.json に新しい翻訳キーを追加した場合
    Given public/_locales/ja/messages.json と en/messages.json に新しいキーを追加する
    When npm run build:docs-i18n を実行する
    Then docs/index.html の TRANSLATIONS オブジェクトに自動的に反映される
    And 手動で docs/index.html を編集する必要がない

  Scenario: 既存の翻訳キーを修正した場合
    Given messages.json の既存キーの翻訳文を修正する
    When npm run build:docs-i18n を実行する
    Then docs/index.html の該当翻訳が修正後のテキストに更新される
    And 修正対象外のキーは変更されない

  Scenario: docs/index.html の言語切替が従来通り動作する
    Given docs/index.html が開かれている
    When 言語切替ボタンをクリックする
    Then ページリロードなしでJA/ENが切り替わる
    And 翻訳が正しく表示される
```

## 受け入れ基準
- [ ] A案（推奨）または B案・C案のいずれかを選択し実装
- [ ] `messages.json` の新規追加・変更が docs/index.html に自動反映される仕組みがある
- [ ] docs/index.html の言語切替機能が従来通り動作する
- [ ] CI に翻訳同期の自動チェックを追加（任意）
- [ ] コミット済み

## テスト戦略

### E2E
- docs/index.html を開いてJA/EN切替が正しく動作することを目視確認
- ビルドスクリプト実行後の差分が意図通りであることを確認

### 単体テスト
- ビルドスクリプト自体のテスト（該当する場合）

## 実装アプローチ
- **A案 推奨**: `scripts/sync-docs-translations.mjs` を作成し、以下を行う:
  1. `public/_locales/ja/messages.json` と `en/messages.json` を読み込む
  2. `docs/index.html` の `TRANSLATIONS` オブジェクト部分をパース
  3. キー名の対応マッピングに従って値を更新
  4. 不足キーを追加
  5. 不要キーを削除（オプション）
  6. 更新後の HTML を書き出し
- キー名の対応マッピングは `scripts/translation-key-map.json` として別ファイル化（初回のみ作成）

## 見積もり
3pt（ビルドスクリプト作成 + キーマッピング定義 + リリースフロー組み込み）

## 技術的考慮事項
- `messages.json` のキー名（ドット区切り、例: `nav.features`）と、`TRANSLATIONS` オブジェクトのキー名（同上）は命名規則が一致している。ただし一部のキー（`meta.title` など）は `TRANSLATIONS` に存在しない可能性がある
- ビルドスクリプトは `node` で実行可能な `.mjs` ファイルとする
- スクリプトが HTML の構造に依存するため、HTML の大幅な構造変更時にスクリプトも追従が必要

## 落とし穴
- `messages.json` は `chrome.i18n.getMessage` のための `message` プロパティを持つオブジェクト（`{ "key": { "message": "..." } }`）である一方、`TRANSLATIONS` は文字列のマップ（`{ "key": "..." }`）。この構造の違いをスクリプトで吸収する必要がある
- 一部の翻訳に HTML タグが含まれる場合（`hero.h1` の `<br />` や `<span>` 等）、`messages.json` では `message` に直接 HTML が書かれているが、`TRANSLATIONS` でも同様の形式を維持する。エスケープ処理は不要

## Definition of Done
- [ ] 翻訳同期スクリプトが作成されている
- [ ] スクリプト実行後、docs/index.html の翻訳が messages.json と整合している
- [ ] `package.json` に `build:docs-i18n` スクリプトが追加されている
- [ ] リリース手順に翻訳同期ステップが追加されている
- [ ] コードレビュー完了

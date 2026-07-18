# PBI: バレル再エクスポート層に@deprecated JSDocを追加

## ユーザーストーリー
開発チームとして、`storage.ts` や `sqlite.ts` のようなバレル再エクスポート層を使う際に、新規コードでは直接モジュールをimportすべきだと分かるようにしたい、なぜなら現状はバレル層がモジュール探索を困難にしており、IDEの「定義へジャンプ」で実装元でなく再エクスポート層に飛んでしまうから

## ビジネス価値
- 新規コードでの直接import習慣を促進し、段階的にバレル層への依存を減らす
- コードナビゲーションの改善（開発者体験向上）

## 実装者向け注記（フェーズ0の既実装確認結果）

Read で確認済み:
- `src/offscreen/sqlite.ts` — 既にファイル先頭のJSDocコメントに「このファイルは後方互換のための再エクスポート層。新規コードは上記の各モジュールから直接importすることを推奨する。」という趣旨の説明が既に記載されている（リファクタリング履歴セクション内）
- `src/utils/storage.ts` も同様の構造（複数モジュールへの分割 + 後方互換の再エクスポート層）を持つ可能性が高い（メモリ記録の「Storage Wrapper」記述と一致）
- 対処案（親レポートより）: バレルに `@deprecated` JSDoc を追加

```bash
# 実装前の必須調査コマンド
sed -n '1,30p' src/utils/storage.ts
grep -rln "リファクタリング履歴\|後方互換のための再エクスポート" src/ --include="*.ts"
grep -n "@deprecated" src/utils/storage.ts src/offscreen/sqlite.ts
```

**注記**: 既に人間可読な説明コメントは存在するため、本PBIの主眼は「IDE・Lintツールが検出可能な `@deprecated` JSDocタグ」への強化。単なるコメントとJSDocタグでは、静的解析ツールやエディタの警告表示能力が異なる。

## BDD受け入れシナリオ

```gherkin
Scenario: バレルファイルの再エクスポート関数にdeprecated警告が表示される
  Given src/utils/storage.ts や src/offscreen/sqlite.ts のバレル層が存在する
  When 開発者がIDEでバレル層からエクスポートされた関数を使用する
  Then エディタ上に取り消し線または警告表示（@deprecated JSDocによる）が示される

Scenario: 既存のimport元の動作に影響がない
  Given 既存コードがバレル層経由でストレージ/SQLite関数をimportしている
  When @deprecated JSDocを追加する
  Then ランタイムの挙動は一切変わらない（JSDocはドキュメント目的のみ）
```

## 受け入れ基準
- [ ] `src/utils/storage.ts` の各再エクスポートに `@deprecated Use the direct module import instead (see file header)` 相当のJSDocを追加
- [ ] `src/offscreen/sqlite.ts` の各再エクスポートに同様のJSDocを追加
- [ ] ランタイム挙動（実際のexport/import解決）は一切変更しない

## テスト戦略（t_wadaスタイル）

### E2E / 統合 / 単体テスト
- 該当なし（JSDocコメント追加のみ、実行コードへの影響なし）
- 検証は `npm run build` / `npm run type-check` が引き続き成功することの確認で代替する

## 実装アプローチ
- ドキュメント作業のため通常のTDDは適用しない。JSDocタグ追加後、ビルド・型チェックが通ることのみ確認する

## 見積もり
1pt（1〜2時間、対象2ファイルの全export箇所へのタグ付与）

## 技術的考慮事項
- 依存関係: なし
- テスタビリティ: 静的解析（型チェック）で十分
- 非機能要件: DX（開発者体験）向上

## 落とし穴
- `@deprecated` タグを追加すると、既存のimport元コードでlintツール（ESLint等）が警告を出す設定になっている場合、大量の警告が発生する可能性がある。CI設定でこれらの警告がエラー扱いになっていないか事前に確認すること

## Definition of Done
- [ ] `src/utils/storage.ts` と `src/offscreen/sqlite.ts` の再エクスポートに `@deprecated` JSDocが追加されている
- [ ] `npm run build` / `npm run type-check` が成功
- [ ] 既存のlint設定でCIが壊れないことを確認
- [ ] コードレビュー完了

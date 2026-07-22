# PBI: i18n キー名をモード依存命名から意味ベース命名にリネーム

**作成日**: 2026-07-22
**優先度**: Low
**見積もり**: 🟡中（2pt目安）
**副作用**: 🔴あり（既存のキー名が変更されるため、参照箇所の更新が必要）

---

## 背景

Checking Team レビュー（2026-07-22）の i18n Expert からの指摘により、`messages.json` のキー名が `modeC`/`modeD` のままアルファベット分類に依存していることが判明した。ドキュメントではアルファベット分類を廃止して意味ベースの名称（Masked Cloud, Cloud Only 等）に統一したのに、コード上のキー名は旧命名に依存している。

保守性を向上させるため、キー名を意味ベースにリネームする必要がある。

## 受け入れ基準（BDD）

### シナリオ 1: キー名がリネームされる
```gherkin
Given public/_locales/en/messages.json に "modeC" キーが存在する
When キー名をリネームする
Then "modeC" キーは "privacyModeMaskedCloud" にリネームされる
And "modeD" キーは "privacyModeCloudOnly" にリネームされる
```

### シナリオ 2: 全ての参照箇所が更新される
```gherkin
Given "modeC" キーを参照するコードが存在する
When キー名をリネームする
Then 全ての参照箇所が新しいキー名に更新される
And ビルドが成功する
```

### シナリオ 3: 日本語ロケールも同様に更新される
```gherkin
Given public/_locales/ja/messages.json に "modeC" キーが存在する
When キー名をリネームする
Then 日本語ロケールも同様にリネームされる
And 翻訳内容は維持される
```

### シナリオ 4: 後方互換性が維持される（オプション）
```gherkin
Given 旧キー名 "modeC" を参照する外部コードが存在する可能性
When キー名をリネームする
Then 移行期間中は旧キー名もエイリアスとして機能する（オプション）
```

## 実装タスク

- [ ] `public/_locales/en/messages.json` のキー名をリネーム
  - `modeC` → `privacyModeMaskedCloud`
  - `modeCShort` → `privacyModeMaskedCloudShort`
  - `modeCDesc` → `privacyModeMaskedCloudDesc`
  - `modeCRecommended` → `privacyModeMaskedCloudRecommended`
  - `modeD` → `privacyModeCloudOnly`
  - `modeDShort` → `privacyModeCloudOnlyShort`
  - `modeDDesc` → `privacyModeCloudOnlyDesc`
- [ ] `public/_locales/ja/messages.json` のキー名をリネーム（同様のマッピング）
- [ ] 全ての参照箇所を検索して更新
  - `src/popup/` 配下の TypeScript ファイル
  - `src/dashboard/` 配下の TypeScript ファイル
  - HTML ファイルの `data-i18n` 属性
- [ ] ビルドが成功することを確認
- [ ] テストがパスすることを確認
- [ ] 移行期間用のエイリアス定義（オプション）

## 完了条件

- [ ] 全てのキー名がリネームされている
- [ ] 全ての参照箇所が更新されている
- [ ] ビルドが成功する
- [ ] テストがパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連

- Checking Team レポート: `plans/2026-07-22-1716-review-main.md`
- 英語ロケール: `public/_locales/en/messages.json`
- 日本語ロケール: `public/_locales/ja/messages.json`
- ドキュメント: `docs/PII_FEATURE_GUIDE.md`（意味ベースの名称に統一済み）

## 注意事項

この PBI は既存のキー名を変更するため、影響範囲が広い。段階的な移行を検討する:

1. **Phase 1**: 新しいキー名を追加し、旧キー名はエイリアスとして維持
2. **Phase 2**: 全ての参照箇所を新しいキー名に更新
3. **Phase 3**: 旧キー名を削除

または、別 PR で段階的に実施することを推奨する。

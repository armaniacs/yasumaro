# PBI: HTML内にフォールバックとして残る日本語ハードコード文字列をi18n化する

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（表示テキストの取得元をdata-i18n経由に統一するのみ）

---

## 背景

Checking Team レビュー（2026-07-25）の i18n Expert からの指摘。`entrypoints/popup/index.html:167` の `<button ... data-i18n="permissionAllow">🔓 このサイトを許可する</button>` のように、`data-i18n` 属性は設定されているものの、フォールバックとして日本語文字列がHTML内に直接埋め込まれている。i18nスクリプトの適用前に一瞬日本語がちらつく可能性があり、また多言語対応時に該当箇所の見落としリスクがある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rln "data-i18n" entrypoints/ | xargs grep -n "data-i18n=\"[a-zA-Z]*\">[^<]*[ぁ-んァ-ン一-龯]"
```

`docs/i18n-guide.md` を先に読み、フォールバックテキストの扱い方針（意図的に残しているか、単なる見落としか）を確認する。意図的な設計であれば、このPBIはスコープを「見落としのみ修正」に絞る。

## 受け入れ基準（BDD）

```gherkin
Scenario: data-i18n属性を持つ要素からハードコード日本語が除去される
  Given entrypoints/popup/index.html の permissionAllow ボタン
  When data-i18n スクリプトが実行される前の初期HTML表示を確認する
  Then 日本語のベタ書きテキストではなく、空またはローディング表示になっている

Scenario: 既存のi18nメッセージが引き続き正しく表示される
  Given _locales/ja/messages.json と _locales/en/messages.json
  When popup.htmlを開く
  Then permissionAllowボタンのテキストが正しい言語で表示される
```

## 受け入れ基準
- [ ] `entrypoints/popup/index.html` 等で `data-i18n` 属性と日本語ベタ書きが併存している箇所を全て洗い出す
- [ ] フォールバックテキストの扱いについて `docs/i18n-guide.md` の方針と照合する
- [ ] 見落としと判断された箇所は、`_locales/ja/messages.json` の値と重複する平文を削除する（または意図的な設計であれば対応不要と結論付ける）

## テスト戦略

### 単体テスト
- 既存のi18nカバレッジテスト（`_locales/*` messages.json の整合性チェック）が引き続きパスすることを確認

### 統合テスト（手動）
- popup/dashboardを実際に開き、日本語・英語両方でテキストが正しく表示されることを目視確認

## 実装アプローチ

1. `docs/i18n-guide.md` を読み、フォールバックテキストの設計方針を確認
2. 対象箇所をgrepで洗い出す
3. 方針に応じて平文を削除するか、対応不要と結論付ける

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: `docs/i18n-guide.md` の設計方針確認が前提
- 非機能要件: i18n

## Definition of Done
- [ ] 対象箇所の洗い出しが完了している
- [ ] 方針に従った修正または「対応不要」の結論が記録されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（i18n Expert指摘）
- 対象コード: `entrypoints/popup/index.html:167`
- 参考: `docs/i18n-guide.md`

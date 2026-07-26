# PBI: HTML内にフォールバックとして残る日本語ハードコード文字列をi18n化する

**作成日**: 2026-07-25
**再調査日**: 2026-07-26（規模を再調査した結果、見積もりを大幅に引き上げ。実装は一旦スキップし後続PBIとして起票し直す）
**完了日**: 2026-07-26（popup.html分のみ。options.html分は別PBIに分割）
**優先度**: Low
**見積もり**: 🔴高（3pt以上目安、当初🟢低から引き上げ）
**副作用**: 🟡軽微（件数が多く、全箇所で`_locales/*/messages.json`の値と実際の表示文言が一致するかの確認作業が必要）

## 実装メモ（2026-07-26）

`entrypoints/popup/index.html` の12件（`statusShowDetails`, `statusDomainFilter`, `statusPrivacy`,
`statusCache`, `statusLastSaved`, `statusCleansing`, `pendingPagesTitle`, `btnSelectAll`,
`btnSaveSelected`, `btnSaveWhitelist`, `btnDiscard`, `pendingPagesEmpty`）+ `permissionAllow`
（背景に記載の167行の指摘対象）の計13件を、`_locales/en/messages.json` の対応する英語メッセージに
置き換えた。`docs/i18n-guide.md` のサンプルコードが一貫して英語プレースホルダーを使っている慣習に
合わせた。

`entrypoints/options/index.html`（235件）は規模が大きく本PBIの範囲を超えるため、
`2026-07-26-33-fix-hardcoded-japanese-strings-options.md` として別PBIに分割した。
`entrypoints/permissions/index.html` は前回調査で対象0件を確認済み、
`src/dashboard/models-dev-dialog.html` も今回確認し対象0件。

型チェック・全テストスイート（7357件）ともに回帰なし。

---

## 2026-07-26 再調査メモ

`docs/i18n-guide.md` のサンプルコードは英語のプレースホルダーテキスト（例: `<div data-i18n="dropFileHere">Drop file here</div>`）を推奨しており、HTML内の日本語ベタ書きは基本的に見落としと判断できる。

ただし実際の対象箇所を洗い出したところ、当初想定（popup.htmlの1箇所）を大幅に超える規模であることが判明した:

```bash
grep -n "data-i18n=" entrypoints/popup/index.html | grep -cP '[ぁ-んァ-ヶ一-龯]'   # → 12件
grep -n "data-i18n=" entrypoints/options/index.html | grep -cP '[ぁ-んァ-ヶ一-龯]'  # → 235件
grep -n "data-i18n=" entrypoints/permissions/index.html | grep -cP '[ぁ-んァ-ヶ一-龯]' # → 0件
```

**合計247件**（popup 12件 + options 235件）。247件を一括で置換するのは影響範囲が広すぎるため、本セッションでは実装を見送り、次のPBIへ進んだ。着手する際は以下のいずれかの分割方針を推奨する:
- popup.html（12件、小規模）を先に片付け、options.html（235件）は規模が大きいため独立したPBIとして分割する
- または自動化スクリプト（`data-i18n`属性値と`_locales/ja/messages.json`の値を突き合わせ、一致する場合のみHTML側の平文を空文字列相当に置換する）を書いて機械的に処理する

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

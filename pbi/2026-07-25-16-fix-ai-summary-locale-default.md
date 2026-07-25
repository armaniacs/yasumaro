# PBI: AI要約プロンプトのデフォルト言語をブラウザロケール由来にする

**作成日**: 2026-07-25
**優先度**: Low
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（引数省略時の挙動のみ変更、明示的にlocaleを渡す既存呼び出しは影響なし）

---

## 背景

Checking Team レビュー（2026-07-25）の Ethics & Bias Auditor からの指摘。`src/utils/customPromptUtils.ts:45`（`getDefaultUserPrompt(locale: string = 'ja')`）と `:60`（`getDefaultSystemPrompt`）はデフォルト引数が `'ja'` 固定になっている。呼び出し元で明示的に locale を渡していない箇所があると、UIロケールに関わらず日本語要約が既定になり、英語環境のユーザーにも日本語プロンプトが適用される可能性がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "getDefaultUserPrompt\|getDefaultSystemPrompt" src/
```

呼び出し元全てで明示的に `locale` を渡しているか確認する。既に全呼び出し元が `chrome.i18n.getUILanguage()` 等から取得したlocaleを渡している場合は、デフォルト引数はフォールバックとしてのみ機能するため、このPBIの優先度はさらに下がる（未設定時の安全策として残しても良い）。

## 受け入れ基準（BDD）

```gherkin
Scenario: locale未指定時にブラウザのUI言語がデフォルトになる
  Given ユーザーのブラウザUI言語が英語(en)である
  When getDefaultUserPrompt() を引数なしで呼び出す
  Then DEFAULT_USER_PROMPT_EN が返る

Scenario: 明示的にlocaleを渡した場合は従来通り動作する
  Given locale='ja' を明示的に指定する
  When getDefaultUserPrompt('ja') を呼び出す
  Then DEFAULT_USER_PROMPT_JA が返る（既存の挙動を維持）
```

## 受け入れ基準
- [ ] `getDefaultUserPrompt` / `getDefaultSystemPrompt` のデフォルト引数を、`getBrowserLanguage()`（同ファイル内に既存の可能性、`customPromptUtils.ts:65`付近を確認）由来の値に変更する
- [ ] 呼び出し元が明示的にlocaleを渡している箇所は挙動が変わらないことを確認する
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `locale` 引数省略時、`chrome.i18n.getUILanguage()` のモック値に応じて正しいプロンプトが返ることを確認するテストを追加
- 既存の明示的locale指定テストが回帰しないことを確認

## 実装アプローチ

1. `customPromptUtils.ts` 内の `getBrowserLanguage` 相当の関数（存在すれば再利用、なければ `chrome.i18n.getUILanguage()` ラッパーを追加）を確認
2. デフォルト引数を `locale: string = getBrowserLanguage()` のような形に変更（関数呼び出しをデフォルト引数にする場合はNode/TSの評価タイミングに注意し、関数内で `locale ?? getBrowserLanguage()` の形にする）
3. テスト追加

## 見積もり

1pt

## 技術的考慮事項
- 依存関係: `chrome.i18n.getUILanguage()` (Chrome拡張API)
- テスタビリティ: `chrome.i18n` のモックが必要（既存のテストセットアップに存在する想定）

## Definition of Done
- [ ] デフォルト言語がブラウザロケール由来になっている
- [ ] 既存テストが全てパスする
- [ ] 新規テストが追加されている
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-25-2019-review-main.md`（Ethics & Bias Auditor指摘）
- 対象コード: `src/utils/customPromptUtils.ts:28-62`

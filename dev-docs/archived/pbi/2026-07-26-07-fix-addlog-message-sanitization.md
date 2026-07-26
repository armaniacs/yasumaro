# PBI: addLogのmessageパラメータもPIIサニタイズの対象にする

**作成日**: 2026-07-26
**完了日**: 2026-07-26
**優先度**: Medium
**見積もり**: 🟡中（2pt目安）
**副作用**: 🟡軽微（ログ出力内容が変わるため、既存のログ検索・診断パネル表示に影響しないか確認が必要）

## 実装メモ（2026-07-26）

`src/utils/logger.ts:442` の `addLog()` を確認し、`message` パラメータが `sanitizeLogDetails()`
（`details`用）とは別経路でそのままログエントリに代入されていることを確認した。

`sanitizeLogDetails()` 内の既存パターン（354-360行、`sanitizeRegex()`の結果に`maskedItems`が
あった場合のみサニタイズ済みテキストを使う）に倣い、`message`にも同様の処理を追加した。誤検出時
（PIIが含まれない通常メッセージ）は元の`message`をそのまま使うため、既存ログの可読性は保たれる。

`obsidianClient.ts`・`aiClient.ts`等でテンプレートリテラル経由でエラーテキスト（`errorText`,
`errorMsg`）をメッセージに埋め込んでいる複数箇所を確認したが、`addLog()`内部での横断的な対応のため
呼び出し元の変更は不要だった。

`logger-security.test.ts`のセキュリティ検証セクションに2件のテストを追加（PIIを含むmessageが
マスクされること、PIIを含まないmessageが変化しないこと）。既存17件と合わせて全てパス。
型チェック・全テストスイート（7363件）ともに回帰なし。

---

## 背景

Checking Team レビュー（`plans/2026-07-23-1038-review-fix-0723.md`）の Blue Team Leader からの指摘。`src/utils/logger.ts:433`（現状）の `addLog()` は、`details` パラメータは `sanitizeLogDetails()` でPIIマスキングされる（450行目）が、`message` 文字列パラメータ自体は `sanitizeRegex` を通過しない。フルURLやエラー詳細がメッセージ文字列に直接埋め込まれた場合、ログから漏洩する可能性がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -n "export async function addLog\|sanitizeLogDetails\|sanitizeRegex" src/utils/logger.ts
grep -rn "addLog(LogType\." src/background/*.ts | grep -oP "addLog\(LogType\.\w+, '[^']*\$\{[^}]*\}" | head -20
```

`message` パラメータに実際にPIIが含まれうる呼び出し箇所（テンプレートリテラルでURLやユーザー入力を埋め込んでいる箇所）を洗い出し、サニタイズ追加によるログ可読性への影響を評価する。

## 受け入れ基準（BDD）

```gherkin
Scenario: messageパラメータのPIIがマスクされる
  Given addLog(LogType.ERROR, `Failed to fetch https://example.com/user@test.com`, {}) のような呼び出し
  When ログが保存される
  Then message文字列内のメールアドレス部分がマスクされる

Scenario: 既存のログメッセージの可読性が大きく損なわれない
  Given 既存のログメッセージ（PIIを含まない一般的な説明文）
  When サニタイズ処理を通す
  Then メッセージの意味が変わらず、誤検出によるマスキングが最小限に抑えられる

Scenario: 既存のログ関連テストが回帰しない
  Given サニタイズ追加後のaddLog実装
  When 既存のlogger.tsテストを実行する
  Then 全てパスする
```

## 受け入れ基準
- [ ] `addLog()` 内で `message` パラメータも `sanitizeRegex`（または `sanitizeLogDetails` 相当）を通してからストレージに保存する
- [ ] 既存の `logger.test.ts` が全てパスする
- [ ] サニタイズによって一般的なログメッセージの可読性が損なわれないことを確認する（誤検出率が許容範囲であることをテストで示す）

## テスト戦略（t_wadaスタイル）

### 単体テスト
- `message` にPII（メールアドレス、URL内の個人情報等）を含むケースでマスクされることを確認
- PIIを含まない通常のメッセージが変化しないことを確認
- 既存の `addLog` 呼び出しパターンでの回帰確認

## 実装アプローチ

1. `logger.ts:433` の `addLog()` 実装を確認
2. `message` パラメータに `sanitizeRegex()`（または適切なサニタイズ関数）を適用する処理を追加
3. 既存呼び出し箇所でのログ内容の変化を確認し、意図しないマスキングがないか検証

## 見積もり

2pt

## 技術的考慮事項
- 依存関係: `src/utils/piiSanitizer.ts` の `sanitizeRegex`
- テスタビリティ: 既存の `logger.test.ts` が土台
- 非機能要件: セキュリティ（ログ経由のPII漏洩防止）

## Definition of Done
- [ ] `addLog()` の `message` パラメータがサニタイズされる
- [ ] 既存テストが全てパスする
- [ ] `pbi/00-INDEX.md` が更新されている

## 関連
- Checking Team レポート: `plans/2026-07-23-1038-review-fix-0723.md`（Blue Team Leader指摘）
- 対象コード: `src/utils/logger.ts:433-450`

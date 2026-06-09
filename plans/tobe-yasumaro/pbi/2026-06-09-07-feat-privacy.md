# PBI: プライバシー強化（PIIマスキング継続 + consent UI再設計）

## ユーザーストーリー
**yasumaroユーザーとして**、自分の個人情報（PII）がAI送信前にマスキングされ、データ収集への同意を明確に管理できるUIを通じてプライバシーをコントロールしたい、なぜなら安心して日常的なブラウジングをツールに記録させたいから。

## ビジネス価値
- Chrome Web Storeの審査通過において「プライバシー配慮の明示」は審査基準の重点項目
- GDPR/CCPAなど国際的なプライバシー規制への対応をドキュメント化できる

---

## BDD受け入れシナリオ

```gherkin
Feature: プライバシー保護

Scenario: PIIマスキングが有効な場合、AI送信前にPIIが除去される
  Given PIIマスキング設定が有効になっている
  And ページ本文に "田中太郎 taro@example.com 090-1234-5678" が含まれている
  When ページがAI要約のために処理される
  Then AIに送信されるテキストは "[NAME] [EMAIL] [PHONE]" のようにマスキングされている
  And SQLiteに保存される要約文にもPII原文は含まれていない

Scenario: 初回インストール時にconsent UIが表示される
  Given yasumaroを初めてインストールした
  When ポップアップを初めて開く
  Then データ収集の同意モーダルが表示される
  And モーダルにはどのデータが収集されるか（ブラウジング履歴のローカル保存）が明記されている
  And 「同意して始める」「詳しく確認する」の2つのボタンが表示される

Scenario: 同意なしでは記録が開始されない
  Given ユーザーがconsent UIでまだ同意していない
  When タブが閉じられる（記録トリガーが発火する）
  Then 記録処理はスキップされる
  And ポップアップに「設定を完了してください」というメッセージが表示される

Scenario: 同意後にconsent UIを再確認・撤回できる
  Given ユーザーが過去に同意している
  When ダッシュボードの「プライバシー設定」から「同意を撤回する」をクリックする
  Then 同意フラグがリセットされる
  And 次回起動時にconsent UIが再表示される
  And これ以降の記録がストップする（既存データは削除しない）

Scenario: consent UIがyasumaro向けの説明に更新されている
  Given 旧obsidian-weaveのconsent UIテキストが残っている
  When consent UIを表示する
  Then 「Yasumaro - AI Browsing Logger」の名称が表示されている
  And ObsidianへのRESTAPI送信が「オプション」である旨が明記されている
  And SQLiteローカル保存が「デフォルト」である旨が明記されている
```

---

## 受け入れ基準
- [ ] 既存の `src/utils/piiSanitizer.ts` の機能を全て維持・継続する
- [ ] PIIマスキング対象: メールアドレス・電話番号・クレジットカード番号・氏名パターン（既存踏襲）
- [ ] consent UIテキストを yasumaro 向けに更新する（SQLiteローカル保存 + Obsidianオプション）
- [ ] 同意フラグ: `StorageKeys.PRIVACY_CONSENT` キーで管理（既存踏襲）
- [ ] 同意前は全ての記録処理をスキップする
- [ ] 「同意撤回」機能をダッシュボードの設定パネルに追加する
- [ ] プライバシーポリシーURL（GitHub Pages等）をconsent UIに記載する（Phase 8連動）
- [ ] i18n対応（日本語・英語）

---

## テスト戦略（t_wadaスタイル）

### E2Eテスト（Playwright）
- 初回インストールシミュレーション → consent UI表示確認
- 同意 → 記録開始 → 撤回 → 記録停止の一連のフロー

### 統合テスト
- `ConsentGuard.isConsentGiven()` が正しく同意状態を返す
- 未同意時に `RecordingLogic` が記録をスキップする
- 同意撤回後に `ConsentGuard.isConsentGiven()` が false を返す

### 単体テスト（既存piiSanitizer踏襲）
- メールアドレスのマスキング
- 電話番号パターン（国内・国際形式）のマスキング
- consent UIテキストのi18n文字列が日英両方に存在する（`_locales/` は未作成のため新規作成が必要）

---

## 実装アプローチ
- **Outside-In**: consent UI の Playwright テストから開始
- **既存コード流用**: `src/popup/privacyConsent.ts` を拡張（新規作成は最小限）

---

## 見積もり
**5ストーリーポイント**

---

## 技術的考慮事項
- 既存 `src/popup/privacyConsent.ts` と `src/utils/piiSanitizer.ts` を最大限流用
- PIIマスキングのロジック変更は不要（機能維持）
- consent UIのテキスト更新が主作業（`_locales/` は未作成のため、`_locales/ja/messages.json` と `_locales/en/messages.json` を新規作成し、consent UI テキストを追加する）

---

## 実装者向け注記

### 現状コードの確認
```bash
cat src/popup/privacyConsent.ts
cat src/utils/piiSanitizer.ts | head -50
grep -rn "PRIVACY_CONSENT\|privacy_consent" src/
# _locales/ は未作成。初回は以下を参考に messages.json を作成すること:
# grep -rn "consent\|同意" _locales/ja/messages.json
```

### 落とし穴
- consent UIのテキストを追加する際、`_locales/ja/messages.json` と `_locales/en/messages.json` の両方を作成・更新すること（現状 `_locales/` は存在しないため新規作成が必要）
- Breaking Changes モーダル（既存: `breaking_changes_v5_shown`）と consent UI が競合しないように表示順序を制御すること

---

## Definition of Done
- [ ] 全BDDシナリオが自動テストとしてパスする
- [ ] `npm run type-check` 通過
- [ ] コードレビュー完了
- [ ] Playwright でconsent UIの表示・同意・撤回フローを確認済み
- [ ] i18nメッセージが日本語・英語ともに更新されている

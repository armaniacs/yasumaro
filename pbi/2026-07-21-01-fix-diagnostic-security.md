# PBI: 診断パネルのセキュリティ脆弱性（XSS/DoS）の修正

## ユーザーストーリー
ユーザーとして、悪意ある設定ファイルをインポートしてもブラウザ上でスクリプトが実行されず、また大量の設定によるシステム停止が発生しないことを望む。なぜなら、機密性の高いAPIキーや閲覧履歴を保護し、安定してツールを利用したいためである。

## ビジネス価値
- **セキュリティ**: Stored XSS による特権窃取（APIキー盗用、履歴流出）のリスクを排除。
- **安定性**: 悪意ある大量設定によるリソース枯渇（DoS）を防ぎ、サービスワーカーの可用性を維持。

## BDD受け入れシナリオ

```gherkin
Scenario: プロバイダ名にスクリプトが含まれていても実行されない (XSS対策)
  Given ユーザーが設定インポート機能を用いて、プロバイダ名に "<img src=x onerror=alert(1)>" を含む設定を導入した
  When ユーザーが診断パネルを開き、「AI 設定」セクションを表示した
  Then ブラウザ上で JavaScript の alert が実行されず、文字列としてそのまま表示される

Scenario: 大量のプロバイダが設定されていてもシステムが停止しない (DoS対策)
  Given 優先度リストに 100 以上のプロバイダが設定されている
  When ユーザーが「AI テスト」ボタンをクリックした
  Then タイムアウトやブラウザのフリーズが発生せず、上限数までのテスト結果が表示されるか、適切に制限されたメッセージが表示される
```

## 受け入れ基準
- [ ] `makeStatRow` 等のレンダリング関数において `innerHTML` の使用を廃止し、`textContent` または `createElement` による安全な構築に移行している
- [ ] `resolveProviderSlots` または `testConnection` において、処理するプロバイダ数の上限（例: 10件）が設定されており、それを超える入力があっても定数時間で処理が完了する
- [ ] 既存の正常なプロバイダ表示（ラベル、モデル名、APIキーのマスク表示）に影響が出ていない

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- [ ] 設定インポート → 診断パネル表示での XSS 発火確認（失敗 → 成功）
- [ ] 大量プロバイダ設定時の AIテストボタン応答性確認（失敗 → 成功）

### 統合テスト
- [ ] `AIClient.testConnection` への大量スロット入力時の処理時間検証

### 単体テスト
- [ ] `makeStatRow` 等の HTML生成関数への HTMLインジェクションテスト
- [ ] `resolveProviderSlots` の件数制限ロジックの境界値テスト

## 実装アプローチ
- **Outside-In**: 脆弱性を再現するテストケースを先に作成し、修正後にパスすることを確認する
- **Red-Green-Refactor**: TDDサイクルを適用し、最小限の修正で脆弱性を塞ぐ

## 見積もり
3pt（小規模な修正だが、影響範囲の確認とテストケース作成を含むため）

## 技術的考慮事項
- `innerHTML` を `textContent` に変更する際、既存の `<span>` タグなどの装飾を維持するために `document.createElement` による構造的な構築に変更する必要がある
- リソース制限の閾値（MAX_PROVIDERS）を定数として定義し、将来的に変更可能にする

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "innerHTML" src/dashboard/panels/diagnostic/diagnosticsPanel.ts src/dashboard/diagnosticsPanel.ts
```

### 実装手順
1. `makeStatRow` 関数の実装を `innerHTML` から `createElement` / `textContent` ベースに変更する
2. `AIClient.resolveProviderSlots` に `slice(0, MAX_PROVIDERS)` 等の制限を追加する
3. 診断パネルでの表示ロジックを上記に合わせて修正する

### 落とし穴
- `innerHTML` を単純に `textContent` に変えると、既存の `<span>` タグなどの装飾が消え、見た目が崩れる。構造的な構築が必要。

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] XSS 脆弱性が解消され、任意の文字列が安全に表示される
- [ ] 大量プロバイダ設定時のリソース消費が抑制されている
- [ ] コードレビュー完了
- [ ] ドキュメント更新済み

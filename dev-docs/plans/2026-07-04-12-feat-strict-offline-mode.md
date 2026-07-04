# PBI: 完全ローカルモード（クラウド送信ゼロ保証）

- 親issue: [DEV-86](https://linear.app/armaniacs/issue/DEV-86)
- 領域: D. プライバシー・信頼性
- type: feat / 優先度: 中

## ユーザーストーリー

プライバシーを最優先する Yasumaro 利用者として、いかなるページ内容もクラウドへ送らない「厳格オフラインモード」を選びたい。なぜなら、機密性の高い業務で使うため、クラウド送信の可能性を設定レベルでゼロにしたいから。

## ビジネス価値

クラウド送信ゼロを保証することで、規制業界・機密環境の利用者に訴求する。測定: 厳格モード有効化数。

## BDD受け入れシナリオ

```gherkin
Scenario: 厳格オフラインモードではローカルAIのみ使う
  Given 厳格オフラインモードが有効
  And   ローカルAI（window.ai / Ollama）が利用可能
  When  ページが記録される
  Then  要約はローカルAIのみで生成される
  And   クラウドプロバイダーへのリクエストは一切発生しない

Scenario: ローカルAIが使えない場合は記録を保留する
  Given 厳格オフラインモードが有効
  And   ローカルAIが利用不可
  When  ページが記録される
  Then  クラウドにフォールバックせず pending 保持する
  And   ユーザーに設定を促す

Scenario: 厳格モード中はクラウドプロバイダー設定が無効化される
  Given 厳格オフラインモードが有効
  When  設定画面を開く
  Then  クラウドプロバイダーの選択がガードされ選べない
```

## 受け入れ基準

- [ ] 厳格モードでクラウド送信を完全に遮断する（コードパスで保証）
- [ ] ローカルAI不可時にクラウドへフォールバックしない
- [ ] 設定UIでクラウドプロバイダーをガードする
- [ ] モード状態を明示表示する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 厳格モード → 記録 → クラウドリクエスト発生なし
- ローカルAI不可 → pending 保持

### 統合テスト
- `privacyPipeline` / `aiClient` がクラウド段を通らないことの検証
- ネットワーク送信ガードのコントラクト

### 単体テスト
- 厳格モード判定によるプロバイダー選択の遮断
- フォールバック抑止ロジック

## 実装アプローチ

Outside-In / Red-Green-Refactor。「クラウドに到達しない」ことをテストで積極的に証明する（送信スパイが呼ばれないアサーション）。

## 見積もり

5pt（要チーム見積もり）

## 技術的考慮事項

- 依存: feature-05（フォールバック）と設計を整合させる
- 再利用: `src/background/localAiClient.ts`（`getLocalAvailability` / `summarizeLocally`）、`src/background/privacyPipeline.ts`（PRIVACY_MODE の local_only を厳格化）、`src/background/aiClient.ts`
- 既存 `local_only` モードとの関係を整理（厳格モードは local_only の強制ガード版か、別モードかを設計判断）

## 実装者向け注記

### 現状コードの確認（着手前に必ず実行）

```bash
grep -rni "local_only\|PRIVACY_MODE\|getLocalAvailability\|summarizeLocally" src/background/
```

既存 local_only の実装範囲を把握し、「ガード漏れでクラウドに行く経路」がないか洗い出す。

### 落とし穴

- 厳格モードの価値は「保証」。1経路でもクラウドに漏れると信頼を失う。全プロバイダー呼び出し口を単一ゲートに集約してテストで封じる。

## Definition of Done

- [ ] 全BDDシナリオが自動テスト化されパスする
- [ ] クラウド非送信をテストで積極的に証明する
- [ ] カバレッジ基準を満たす
- [ ] コードレビュー / リファクタ完了
- [ ] ドキュメント更新

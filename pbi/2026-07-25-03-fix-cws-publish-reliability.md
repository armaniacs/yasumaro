# PBI: Chrome Web Store 公開ステップの信頼性向上

## ユーザーストーリー

リリースメンテナーとして、Chrome Web Store への拡張機能公開が確実に成功し、失敗時には明確なエラーメッセージが得られるようにしたい。なぜなら、現在のワークフローは Python 構文エラーを起こしたり、upload 完了前に publish を呼んだり、ネットワークハングで15分待たされたりする問題を抱えているから。

## ビジネス価値

- リリース作業者のデバッグ時間を削減
- 公開失敗を早期に検出し、リリースの信頼性を向上
- ユーザーへの拡張機能配信遅延を防止

## BDD受け入れシナリオ

```gherkin
Scenario: アップロードが IN_PROGRESS のときは SUCCESS になるまでポーリングする
  Given Chrome Web Store API が uploadState=IN_PROGRESS を返す
  When release.yml の "Publish to Chrome Web Store" ステップが実行される
  Then ステップは SUCCESS が返るまでポーリングを続ける
  And SUCCESS 後にのみ /publish エンドポイントを呼び出す

Scenario: アップロード失敗時に明確なエラーメッセージが出力される
  Given Chrome Web Store API が uploadState=FAILURE と itemError を返す
  When ステップが実行される
  Then itemError の error_code と error_detail が読みやすく出力される
  And ステップは exit 1 で終了する

Scenario: パブリッシュステータス取得で Python 構文エラーが発生しない
  Given Chrome Web Store API が任意の JSON レスポンスを返す
  When PUBLISH_STATUS を抽出する python3 -c が実行される
  Then SyntaxError は発生しない
  And ステータスが正しく抽出される

Scenario: OAuth エンドポイントがハングしてもタイムアウトで失敗する
  Given oauth2.googleapis.com が応答を返さない
  When トークン取得の curl が実行される
  Then 15分待たずにタイムアウトして失敗する
```

## 受け入れ基準

- [ ] `python3 -c "..."` 内の `\n` が実際の改行として解釈され、SyntaxError が発生しない
- [ ] uploadState が `IN_PROGRESS` の場合、`SUCCESS` になるまでポーリングする（最大試行回数・タイムアウト付き）
- [ ] `curl` コマンドに `--connect-timeout` と `--max-time` が設定されている
- [ ] ポーリング失敗時・タイムアウト時に明確なエラーメッセージが出力される
- [ ] upload 失敗時の `itemError` が可読形式で出力される

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- `act` + モックサーバーで、IN_PROGRESS → SUCCESS → publish OK のフローを検証
- `act` + モックサーバーで、アップロード失敗時のエラー出力を検証

### 統合テスト
- bash スクリプトの dry-run: curl オプションが正しく設定されていることを検証
- Python スクリプト単体: 複数の JSON パターン（list status, string status, empty status）を正しく処理することを検証

### 単体テスト
- ポーリングロジックの最大試行回数・sleep 間隔の検証
- タイムアウト値の検証

## 実装アプローチ

- **Outside-In**: 公開ステップ全体のフローを見直し、失敗パターンごとにテストを書いてから実装
- **Red-Green-Refactor**: 各問題（SyntaxError、IN_PROGRESS、polling、timeout）に対して失敗テストを先に作成

## 見積もり

🟡中（2pt）

## 技術的考慮事項

- 修正対象: `.github/workflows/release.yml` の "Publish to Chrome Web Store" ステップ
- CWS API は upload と publish が非同期
- GitHub Actions ランナーには `python3` が利用可能
- `curl` のタイムアウトは `--connect-timeout`（接続確立まで）と `--max-time`（転送全体）の両方を設定

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "python3 -c" .github/workflows/release.yml
```

### 実装手順
1. Python スクリプトを YAML リテラルブロックまたは一行の安全な形式に書き換え
2. upload 後に `IN_PROGRESS` の場合はポーリングループを追加
   ```bash
   for i in {1..30}; do
     if [ "$UPLOAD_STATUS" = "SUCCESS" ]; then break; fi
     if [ "$UPLOAD_STATUS" != "IN_PROGRESS" ]; then echo "Unexpected state: $UPLOAD_STATUS"; exit 1; fi
     sleep 10
     # 再取得
   done
   ```
3. 全 `curl` コマンドに `--connect-timeout 10 --max-time 60` を追加
4. `itemError` の出力を可読な Python スクリプトに変更

### 落とし穴
- YAML の `|` リテラルブロック内で Python スクリプトを書く場合、インデントに注意（bash コマンドとして解釈される）
- ポーリング回数と間隔のバランス: CWS の処理時間は数秒〜数分のため、最大5分程度の猶予を持たせる
- `IN_PROGRESS` の直後に `/publish` を呼ぶと実質的に失敗するが、API は即座にエラーを返さない場合がある

## Definition of Done

- [ ] 全BDDシナリオが検証可能な形で実装・パスしている
- [ ] コードレビュー完了
- [ ] リリースワークフローが正常に動作することの手動または自動検証

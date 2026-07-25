# CI/CD Security Checklist

GitHub Actions ワークフローをレビューする際のセキュリティチェックリスト。
過去のインシデントから抽出した項目をカテゴリ別にまとめています。

## シェルインジェクション防止

GitHub Actions の `${{ }}` 展開はシェルパース **前** に実行されるため、
変数値にシェルメタ文字（`;`, `|`, `&`, `$`, `` ` `` など）が含まれていると、
意図しないコマンドが実行される可能性があります。

### チェック項目

- [ ] `${{ }}` 式を `run:` ブロックで直接使用していない
  - **なぜ危険か:** `${{ }}` 展開が先に行われた後、その結果がシェルスクリプトとして解釈される。`version` に `1.0.0"; echo pwned #` が設定された場合、`echo 1.0.0"; echo pwned #"` として実行される。
  - **どう修正するか:** `env:` セクションで変数に代入し、シェル内では二重引用符で囲んだ変数展開（`"${VAR}"`）を使用する。
  - **例:**
    ```yaml
    # ❌ 危険
    run: echo "Version: ${{ steps.version.outputs.version }}"

    # ✅ 安全
    env:
      VERSION: ${{ steps.version.outputs.version }}
    run: echo "Version: ${VERSION}"
    ```
  - **関連インシデント:** PBI 01 — release.yml コマンドインジェクション

- [ ] 外部入力（version、branch名、タグ名等）を二重引用符で囲んでいる
  - **なぜ危険か:** 引用符なしの変数展開はシェルのワード分割とパス名展開（グロブ）の影響を受ける。
  - **どう修正するか:** 常に `"${VAR}"` のように二重引用符で囲む。
  - **例:**
    ```bash
    # ❌ 危険 — 値に空白や `*` が含まれると分割/展開される
    echo $VERSION

    # ✅ 安全
    echo "${VERSION}"
    ```

- [ ] シェルメタ文字を含む可能性のある入力を検証している
  - **なぜ危険か:** バリデーションなしでシェルに渡すと、悪意ある入力で任意コマンドが実行可能。
  - **どう修正するか:** GitHub Actions の `if:` 条件や個別のバリデーションステップで事前にチェックする。
  - **例:**
    ```yaml
    - name: Validate version format
      if: ${{ ! startsWith(github.ref_name, 'refs/tags/v') }}
      run: exit 1
    ```

## シークレット管理

CI ログはリポジトリの read 権限を持つ全ユーザーが閲覧可能です。
機密情報（トークン、キー、パスワード）がログに漏洩しないようにする必要があります。

### チェック項目

- [ ] シークレットを `echo` などでログに出力していない
  - **なぜ危険か:** シークレット値が CI ログに平文で表示される。ログは永続的に保存され、後から閲覧可能。
  - **どう修正するか:** シークレットが必要な処理は環境変数経由で行い、出力しない。
  - **例:**
    ```bash
    # ❌ 危険
    echo "${CRX_PRIVATE_KEY}"  # ログに秘密鍵が表示される

    # ✅ 安全 — 必要な処理のみ行い、出力しない
    echo "${CRX_PRIVATE_KEY}" > /tmp/private.pem
    node build.mjs ... && rm /tmp/private.pem
    ```

- [ ] エラーレスポンスやAPI応答の full dump を出力していない（機密フィールドを含む可能性がある場合）
  - **なぜ危険か:** OAuth レスポンスには `access_token`, `refresh_token`, `client_secret` などが含まれ、そのまま出力すると漏洩する。
  - **どう修正するか:** 機密フィールドをマスクしてから出力する。`python3` や `jq` で特定フィールドを削除する。
  - **例:**
    ```bash
    # ❌ 危険 — すべてのフィールドをそのまま出力
    echo "${FULL_RESP}" | python3 -m json.tool

    # ✅ 安全 — 機密フィールドを削除してから出力
    echo "${FULL_RESP}" | python3 -c "
    import sys, json
    d = json.load(sys.stdin)
    for k in ('access_token', 'refresh_token', 'client_secret'):
        d.pop(k, None)
    print(json.dumps(d, indent=2))
    "
    ```
  - **関連インシデント:** PBI 02 — OAuth 認証失敗時の CI ログ漏洩

- [ ] 機密情報は `::add-mask::` でマスクしてからログ出力する（必要な場合のみ）
  - **なぜ危険か:** デバッグ目的でシークレットの一部を確認したい場合があるが、マスクなしでは漏洩する。
  - **どう修正するか:** 出力前に `echo "::add-mask::${VALUE}"` でマスク登録する。
  - **例:**
    ```yaml
    - name: Debug (safe)
      run: |
        echo "::add-mask::${TOKEN_PREFIX}"
        echo "Token prefix: ${TOKEN_PREFIX:0:4}..."
    ```

## ネットワーク信頼性

CI 環境からのネットワーク呼び出しはタイムアウトがないとハングする可能性があります。
タイムアウトとリトライを適切に設定する必要があります。

### チェック項目

- [ ] `curl` コマンドに `--connect-timeout` と `--max-time` を設定している
  - **なぜ危険か:** タイムアウトなしの curl は外部サービスが応答しない場合、CI ジョブがタイムアウトするまでハングし続ける（GitHub Actions のデフォルトジョブタイムアウトは 6 時間）。
  - **どう修正するか:** 接続タイムアウトと最大実行時間を設定する。
  - **例:**
    ```bash
    # ❌ 危険 — タイムアウトなし
    curl -s -X POST https://api.example.com/token

    # ✅ 安全 — タイムアウト付き
    curl -s --connect-timeout 10 --max-time 30 -X POST https://api.example.com/token
    ```

- [ ] 外部API呼び出しにリトライロジックを実装している
  - **なぜ危険か:** 一時的なネットワーク障害でジョブが失敗すると、手動リトライが必要になる。リリース自動化の信頼性が低下する。
  - **どう修正するか:** `curl --retry 3 --retry-delay 5` やアクションの組み込みリトライを使用する。
  - **例:**
    ```bash
    curl -s --connect-timeout 10 --max-time 30 \
      --retry 3 --retry-delay 5 --retry-all-errors \
      -X POST https://api.example.com/token
    ```

- [ ] タイムアウト時のエラーメッセージを明確にしている
  - **なぜ危険か:** タイムアウトと認証エラーの区別がつかないと、デバッグに時間がかかる。
  - **どう修正するか:** エラー時に curl の終了コードやレスポンスの有無を確認して適切なメッセージを出力する。

## エラーハンドリング

非同期処理や複数ステップのワークフローでは、適切なエラーハンドリングと状態確認が必要です。

### チェック項目

- [ ] 非同期処理の完了をポーリングで確認している
  - **なぜ危険か:** 非同期 API（アップロード後の公開処理など）は即座に完了せず、完了確認なしに次の処理に進むと不整合が発生する。
  - **どう修正するか:** ループで状態をポーリングし、タイムアウトを設定する。
  - **例:**
    ```bash
    # アップロード状態をポーリング
    for i in $(seq 1 30); do
      STATUS=$(curl -s ...)
      if [ "${STATUS}" = "SUCCESS" ]; then
        echo "Upload completed"
        break
      fi
      if [ "${STATUS}" != "IN_PROGRESS" ]; then
        echo "Unexpected status: ${STATUS}"
        exit 1
      fi
      sleep 2
    done
    ```
  - **関連インシデント:** PBI 04 発見 — Chrome Web Store アップロード後の `IN_PROGRESS` ポーリング欠如

- [ ] エラー時の詳細情報を出力している（機密情報を除く）
  - **なぜ危険か:** エラー情報が不十分だと原因特定に時間がかかる。逆に full dump は機密情報漏洩のリスク。
  - **どう修正するか:** エラーコードやエラー概要のみを出力し、機密フィールドは除外する。

- [ ] 予期しない状態に対するフォールバック処理がある
  - **なぜ危険か:** API のレスポンス形式が変わったり、予期しない値が返ってきたときにスクリプトが無警告で失敗する。
  - **どう修正するか:** `else` 節やデフォルトケースを必ず実装する。
  - **例:**
    ```bash
    STATUS=$(echo "${RESP}" | python3 -c "
    import sys, json
    d = json.load(sys.stdin)
    s = d.get('status', [])
    if isinstance(s, list) and len(s) > 0:
        print(s[0])
    elif isinstance(s, str):
        print(s)
    else:
        print('UNKNOWN')
    ")
    ```

## 入力検証

CI ワークフローへの入力を検証しないと、予期しない動作やセキュリティインシデントの原因になります。

### チェック項目

- [ ] バージョン文字列が semver 形式であることを検証している
  - **なぜ危険か:** 不正なバージョン形式によりファイルパス生成が失敗したり、シェルインジェクションの入口になる。
  - **どう修正するか:** `node -p` でパースするか、正規表現でバリデーションする。
  - **例:**
    ```bash
    VERSION=$(node -p "require('./package.json').version")
    # パースに失敗した時点でエラーになるため、安全
    ```

- [ ] ファイルパスにディレクトリトラバーサルが含まれていないことを確認している
  - **なぜ危険か:** `../../etc/passwd` のようなパスで意図しないファイルを読み書きされる可能性。
  - **どう修正するか:** ベースディレクトリを固定し、ユーザー入力をそのままパスに使わない。

- [ ] 外部からの入力サイズに上限を設定している
  - **なぜ危険か:** 巨大なレスポンスにより CI のメモリが枯渇したり、処理時間が増大する。
  - **どう修正するか:** `curl` の `--max-filesize` や Content-Length チェックを入れる。

## YAML / 構文

- [ ] インライン Python スクリプトに `\n` エスケープを正しく使用している
  - **なぜ危険か:** YAML 内で改行が必要な複数行 Python を `\n` で繋ぐと、YAML パース時に意図しない構文エラーが発生する。
  - **どう修正するか:** YAML の literal block scalar（`|`）を使用して複数行スクリプトを記述する。
  - **例:**
    ```yaml
    # ❌ 危険 — \n エスケープの問題
    run: python3 -c "import sys, json;\nfor e in json.load(sys.stdin).get('itemError', []):\n    print(e.get('error_code', ''))"

    # ✅ 安全 — literal block を使用
    run: |
      python3 -c "
    import sys, json
    for e in json.load(sys.stdin).get('itemError', []):
        print(e.get('error_code', ''))
    "
    ```

- [ ] ワークフローレベルで `timeout-minutes` を設定している
  - **なぜ危険か:** 明示的なタイムアウトがないとハングしたジョブが 6 時間（デフォルト）実行され続ける。
  - **どう修正するか:** ジョブごとに適切な `timeout-minutes` を設定する。

---

## 監査手順

ワークフローのセキュリティレビューを実施する際の手順:

```bash
# 1. 危険な ${{ }} 展開をチェック
grep -Pn 'run:.*\${{' .github/workflows/*.yml

# 2. シークレットのログ出力をチェック
grep -Pn 'echo.*\${{' .github/workflows/*.yml | grep -i 'secret\|token\|key\|password'

# 3. curl のタイムアウト設定をチェック
grep -Pn 'curl' .github/workflows/*.yml | grep -v 'connect-timeout\|max-time'

# 4. シークレット変数の echo をチェック
grep -Pn 'echo\s+"?\${?\w*(SECRET|TOKEN|KEY|PASS|PRIVATE)}?' .github/workflows/*.yml
```

---

*Created as part of PBI 04 — CI/CD Security Review Checklist*
*Related incidents: PBI 01 (command injection), PBI 02 (OAuth log leak)*

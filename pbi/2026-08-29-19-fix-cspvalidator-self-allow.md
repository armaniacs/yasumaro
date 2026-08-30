# PBI: CSPValidator の設定由来ドメイン自己許可を締め直す（VULN Code Quality）

> `2026-08-29-14-fix-security-hardening-code-quality.md` の AC1 から分離。
> 29-14（PR: Wave 3 統合）では AC2–AC6 の 5 件が着地したが、
> AC1（CSPValidator 自己許可）は「どのドメインを正当なカスタム API
> エンドポイントとみなすか」の設計判断が必要なため単独 PBI とした。

## ユーザーストーリー
開発者として、`CSPValidator.initializeFromSettings` が設定値の hostname を無条件に条件付き CSP 許可リストへ追加しないようにしたい、なぜなら設定が汚染された場合（インポート経由の悪意ある設定ファイル等）に任意ドメインへの接続が許可され、条件付き CSP の意味が無くなるから

## 背景

### 現状
`src/utils/cspValidator.ts` の `initializeFromSettings`:
- `settings.provider_base_url` の hostname を **無条件で** `allowedDomains` に追加（`:144-154`）
- `settings['{openai|openai2|lm-studio|ollama}_base_url']` の hostname も同様に無条件追加（`:156-170`）

これらはユーザーがカスタム AI エンドポイントを設定するための正当な機能だが、
値が「信頼できる定数」ではなく「設定由来」であるため、VulnHunter は
Code Quality（自己許可構造）として指摘した。

### なぜ 29-14 で見送ったか
既存テスト（`cspValidator.test.ts` の "Provider Base URL Domains" ブロック）が
`custom-openai.example.com` 等の**任意カスタムエンドポイント許可を明示的に前提**
としている。締め直すには「何を正当とみなすか」の設計判断が要る:
- https のみ許可（http は localhost/loopback を除き拒否）？
- private IP / metadata endpoint（169.254.169.254 等）を明示的に拒否？
- ユーザーが設定 UI で明示的にオプトインした場合のみ許可（暗黙の追加を廃止）？

### 現行コードの他のガード（参考）
- `src/utils/ssrfGuard.ts` に private IP / localhost 判定あり
- `src/utils/cspDomains.ts` の `LOCAL_PORTS` / `aiConnectSrc` に localhost ポート許可リスト
- `src/utils/allowedUrls.ts` の `isAllowedProviderBaseUrl(url, isLocal)` — 別 PBI で追加された同種のガード（169.254.169.254 / metadata.google.internal / private IP を拒否）

## BDD受け入れシナリオ

```gherkin
Scenario: private IP / metadata エンドポイントは条件付き CSP に追加されない
  Given provider_base_url が "http://169.254.169.254/" である
  When CSPValidator.initializeFromSettings が走る
  Then 169.254.169.254 は allowedDomains に追加されない

Scenario: 非 https のカスタムエンドポイントは localhost 以外拒否される
  Given openai_base_url が "http://evil.example/" である
  When initializeFromSettings が走る
  Then evil.example は追加されない（http は localhost/loopback のみ許可）

Scenario: 正当なカスタム https エンドポイントは引き続き許可される（回帰防止）
  Given provider_base_url が "https://custom-openai.example.com/v1" である
  When initializeFromSettings が走る
  Then custom-openai.example.com は allowedDomains に追加される

Scenario: localhost のカスタムエンドポイント（Ollama/LM Studio）は許可される
  Given ollama_base_url が "http://localhost:11434" である
  When initializeFromSettings が走る
  Then localhost は許可される（LOCAL_PORTS の既存挙動を踏襲）
```

## 受け入れ基準
- [ ] `CSPValidator.initializeFromSettings` の `provider_base_url` / `*_base_url` の hostname 追加が、`src/utils/allowedUrls.ts` の `isAllowedProviderBaseUrl` 相当のガードを通る（private IP・metadata endpoint・非 https の非 localhost を拒否）
- [ ] ガードは 1 箇所に集約（`isAllowedProviderBaseUrl` を再利用するか、共有ヘルパーに抽出）
- [ ] 正当な https カスタムエンドポイントと localhost エンドポイントの許可挙動は不変（既存 `cspValidator.test.ts` の該当テストは新ガードに合わせて期待値更新）
- [ ] 設定 UI で暗黙に追加される挙動を維持するか、明示オプトインに変えるかを決定しコメント化
- [ ] `npm run type-check` と `npm run validate` が成功する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし

### 統合テスト
- `initializeFromSettings` × 汚染設定（private IP / metadata / http evil）: 追加されないこと
- `initializeFromSettings` × 正当設定（https custom / localhost）: 追加されること

### 単体テスト
- 更新: `src/utils/__tests__/cspValidator.test.ts` の "Provider Base URL Domains" ブロック（CRLF 注意 — CRLF なら別 LF ファイルへ）
- 新規（別 LF ファイル）: private IP / metadata / 非 https 拒否の境界テスト

## 実装アプローチ
- **Outside-In**: 汚染設定の RED テスト（現行は追加される）→ `isAllowedProviderBaseUrl` ガード適用で GREEN
- **Red-Green-Refactor**: ガードを 1 箇所に集約（`allowedUrls.ts` の既存関数を再利用）

## 見積もり
1pt（要チームでの見積もり — ガード適用 + 既存テスト更新 + 境界テスト）

## 技術的考慮事項
- 依存関係: なし
- `cspValidator.test.ts` は CRLF の可能性 — 着手時に `file` で確認
- `isAllowedProviderBaseUrl` の `isLocal` 引数の判定（provider type から localhost 期待かどうか）を CSPValidator 側でどう渡すか
- 行番号は監査時点（2026-08-29）のもの。着手時に該当シンボルで再確認すること

## 実装者向け注記

### 現状コードの確認
```bash
rg -n "provider_base_url|_base_url|allowedDomains\.add|initializeFromSettings" src/utils/cspValidator.ts
rg -n "isAllowedProviderBaseUrl|isPrivateIpAddress|metadata" src/utils/allowedUrls.ts src/utils/ssrfGuard.ts
rg -n "Provider Base URL Domains|custom-openai" src/utils/__tests__/cspValidator.test.ts
```

### 実装手順
1. `isAllowedProviderBaseUrl`（`allowedUrls.ts`）を CSPValidator から import
2. `:144-170` の 2 箇所（`provider_base_url` と `*_base_url` ループ）で、hostname 追加前にガードを通す
3. `cspValidator.test.ts` の該当テストを新挙動に合わせて更新
4. private IP / metadata / 非 https 拒否の境界テストを追加
5. `npm run validate`

### 落とし穴
- 既存ユーザーが private IP の Ollama を設定している場合、締め直しで動かなくなる可能性 — localhost/loopback は許可、private IP（10.x/192.168.x/172.16-31.x）の扱いを慎重に（Ollama を LAN 上の別マシンで動かすケース）
- `isLocal` の判定: `ollama_base_url` / `lm-studio_base_url` は localhost 期待、`provider_base_url` / `openai*_base_url` はリモート期待

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで該当 Code Quality 指摘が解消されること

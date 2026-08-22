# PBI: CSP connect-src を特定ポートに限定 — SSRF面の最小化

## ユーザーストーリー
拡張機能ユーザーとして、XSS脆弱性が仮に存在しても `connect-src` が任意ポートへのfetchを許可しないようにしたい、なぜなら `localhost:*` はローカルで動作する任意サービス（Obsidian Local REST API以外）へのSSRFを可能にし、情報漏洩・操作リスクを拡大するから

## 優先度
- 順位: 1 / 12
- RICEスコア: 4000 (Reach=500 / Impact=2 / Confidence=80% / Effort=0.20人月)
- 根拠: 全ユーザーに影響するSSRF面。host_permissionsは27123/27124/11434/1234のみなのにCSPは `:*` で乖離。修正はwxt.config.ts:67の1行で高ROI。依存: 05 host_permissions生成と09 CSP validationを同バッチで先行すると乖離再発を防げる

## ビジネス価値
- セキュリティ: XSS時のblast radiusを `4ports×2hosts×2proto = 16オリジン` に限定。任意ポート走査を不可に
- コンプライアンス: Chrome Web StoreのCSP最小権限原則に準拠、審査指摘リスク低減
- 測定: `chrome.manifest` のCSP差分レビュー + `npm run build` 後の `dist/manifest.json` connect-src が期待値と一致

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — 許可ポートへの接続は成功する
  Given 拡張機能がビルドされインストールされている
  When 拡張機能が http://localhost:27124/ や http://127.0.0.1:11434/ へ fetch する
  Then CSP違反なく接続が成功する
  And Obsidian Local REST API (27123/27124) とローカルAI (11434/1234) の疎通テストがパスする

Scenario: 境界ケース — 未許可ポートへの接続はCSPでブロックされる
  Given 拡張機能がインストールされている
  When 悪性ページのXSSペイロードが http://localhost:9999/secret へ fetch を試みる
  Then CSP `connect-src` 違反でブロックされ、networkタブにCSPエラーが記録される
  And host_permissions にも該当エントリが無いため二重に拒否される
```

```gherkin
Scenario: エラーケース — 不正なCSP生成時はビルドが失敗する
  Given buildConnectSrcDomains() が不正な値（空文字やスキーム欠落）を返した
  When npm run build を実行する
  Then CSP検証ステップがエラーをthrowしビルドが失敗する
  And エラーメッセージに該当domainが明示される
```

## 受け入れ基準
- [ ] `wxt.config.ts:67` の `connect-src` から `http://localhost:*` / `https://localhost:*` 等のワイルドカードポートが除去されている
- [ ] 代わりに `http://localhost:27123 https://localhost:27123 http://127.0.0.1:27123 ... :1234` の16オリジン（または生成関数由来）が列挙されている
- [ ] AI provider domains は `buildConnectSrcDomains()` 由来を維持
- [ ] `npm run build` 後の `dist/**/manifest.json` のCSPが期待値と一致（スナップショットテスト）
- [ ] 既存の接続テスト（Obsidian/local AI）が全パス

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能をロードし、popupの「接続テスト」ボタンで27123/27124/11434/1234への疎通が成功する
- 悪性ページで `fetch('http://localhost:9999')` を試みCSPブロックを確認（Playwright + extension context）

### 統合テスト
- `wxt.config.ts` のmanifest生成をimportしてCSP文字列をassert（`src/utils/cspDomains.test.ts` に追加）
- `buildConnectSrcDomains()` の戻り値が `https://` + domain 形式であることを検証

### 単体テスト
- `src/utils/cspDomains.ts` : ポート生成ヘルパーが16オリジンを返す、重複無し、スキーム付き
- CSP文字列パーサーテスト: `connect-src` に `:*` が含まれない、許可ポートのみ含む

## 実装アプローチ
- **Outside-In**: E2E CSPブロックテスト(失敗) → 統合 CSP文字列テスト(失敗) → 単体 ポート生成(失敗) → 実装 → グリーン → リファクタ
- **Red-Green-Refactor**: 各レイヤでTDD
- **リファクタリング**: 生成ロジックは `src/utils/cspDomains.ts` に集約し `wxt.config.ts` は呼ぶだけに

## 見積もり
2pt（要チーム見積もり）— 1日以内の小規模だがCSP検証と手動疎通確認を含む

## 技術的考慮事項
- 依存関係: 05 host_permissions生成、03 CSP validation と同バッチ推奨。05を先にやるとSSOT化できる
- テスタビリティ: `wxt.config.ts` は `defineConfig` の戻り値を直接テスト可能。`vite` mock不要
- 非機能要件: CSP変更は拡張機能の全通信に影響するため、AI provider全構成での疎通確認が必要
- リスク: ポート漏れがあると正規機能がCSPでブロックされる。AI provider追加時の回帰に注意

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "connect-src" wxt.config.ts
grep -rn "localhost:\*" src/utils/cspDomains.ts wxt.config.ts
cat dist/chromium-mv3/manifest.json | grep -A2 content_security_policy
```

### 実装手順
1. `src/utils/cspDomains.ts` に `LOCAL_PORTS = [27123,27124,11434,1234]` と `buildLocalConnectSrc()` を追加
   ```ts
   export const LOCAL_PORTS = [27123, 27124, 11434, 1234] as const;
   export function buildLocalConnectSrc(): string[] {
     return LOCAL_PORTS.flatMap(p => [
       `http://localhost:${p}`, `https://localhost:${p}`,
       `http://127.0.0.1:${p}`, `https://127.0.0.1:${p}`,
     ]);
   }
   ```
2. `wxt.config.ts:67` を `connect-src 'self' ${buildLocalConnectSrc().join(' ')} ${buildConnectSrcDomains().join(' ')}` に置換
3. `src/utils/cspDomains.test.ts` に `:*` 不含アサーション追加
4. `npm run build && grep connect-src dist/**/manifest.json` で目視確認

### 落とし穴
- `buildConnectSrcDomains()` は `/*` をstripするが、local側は `/*` を付けないこと（CSPはパス不要）
- `host_permissions` と `connect-src` の二重管理を再発させない — 05 と同時対応が望ましい
- WASM利用時の `wasm-unsafe-eval` と混同しない（本PBIは connect-src のみ）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす（E2E/統合/単体すべて）
- [ ] コードレビュー完了（GitHub PRでのapprove必須。CSP差分はPR説明に貼付け、For Security Review Agents観点確認を明記）
- [ ] リファクタリング完了（グリーン後）
- [ ] ロールバック手段の検討: CSPを `:*` に戻す1行revertで即時切り戻し可能であることをPRに記載
- [ ] ドキュメント更新済み（dev-docs/ERROR_CODES.md 該当なし、CHANGELOGにsecurity fixとして追記）

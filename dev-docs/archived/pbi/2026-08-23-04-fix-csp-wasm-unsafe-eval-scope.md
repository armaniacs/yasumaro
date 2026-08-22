# PBI: wasm-unsafe-eval スコープ限定 — CSP最小権限化

## ユーザーストーリー
拡張機能ユーザーとして、CSPの `wasm-unsafe-eval` が必要なページでのみ許可されてほしい、なぜなら `script-src 'self' 'wasm-unsafe-eval'` を全extension_pagesで常時許可すると、XSSがWASM実行に直結し、JSだけでは困難な難読化・永続化攻撃が可能になるから

## 優先度
- 順位: 4 / 12
- RICEスコア: 1000 (Reach=500 / Impact=1 / Confidence=50% / Effort=0.25人月)
- 根拠: 全ユーザーに影響するが、現状WASMはsqlite-wasm等の一部ページのみで使用。実際にWASMを悪用するXSSはJSだけでも十分なためImpactは1。Confidenceは「どこでWASMが必要か」の調査が必要なため50%。Effortは調査+条件分岐でやや高め

## ビジネス価値
- セキュリティ: CSPは最小権限が原則。不要なページで `wasm-unsafe-eval` を除去すればXSSの悪用選択肢を減らせる
- 将来性: ChromeがCSPを強化した際に `wasm-unsafe-eval` が非推奨化されても影響範囲を限定できる
- 測定: `dist/**/manifest.json` のCSPから不要ページでの `wasm-unsafe-eval` が除去されている、WASM利用ページでは依然動作する

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — WASMが必要なページではWASMが動作する
  Given 拡張機能がビルドされている
  When offscreen/dashboardで sqlite-wasm をロードする
  Then CSP違反なくWASMがコンパイル・実行される
  And ブラウジング履歴の保存・検索が正常に動作する

Scenario: 境界ケース — WASM不要なページでは wasm-unsafe-eval が無い
  Given 拡張機能のmanifestを検査する
  When extension_pages のCSPをパースする（将来ページ別CSPが可能になった場合）
  Then WASM不要なページ（例: popup）のCSPには wasm-unsafe-eval が含まれない
  And 現行の単一CSP制約下では、代替としてコメントで「なぜ必要か」が明記されている

Scenario: エラーケース — wasm-unsafe-eval を除去してもWASMが壊れない
  Given wasm-unsafe-eval を除去したビルド
  When WASM不要ページで拡張機能を操作する
  Then コンソールにCSPエラーが出ない
  And 全機能が正常に動作する
```

## 受け入れ基準
- [ ] `grep -rn "wasm\|WebAssembly" src/` でWASM使用箇所が特定され、ドキュメント化されている
- [ ] `wxt.config.ts:67` の `script-src` について、以下いずれかが実施されている:
  - (A) WASMが必要なページのみに `wasm-unsafe-eval` を限定（WXTがページ別CSPをサポートする場合）
  - (B) 単一CSP制約下では、コメントで「sqlite-wasm@1.3.1がoffscreenで必要」と明記し、将来的な除去条件をTODOとして残す
- [ ] (A)の場合はWASM不要ページでのCSP違反が無いことをテストで確認
- [ ] `npm run build` 後のmanifest CSPが期待通り

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能をロードし、履歴保存（WASM経由）とpopup操作（WASM不要）の両方でCSPエラーが出ないことをconsole監視で確認

### 統合テスト
- `src/utils/cspDomains.test.ts` または新規 `wxt.config.test.ts` でCSP文字列に `wasm-unsafe-eval` が含まれる条件をassert
- WASM使用箇所の有無で期待値が変わるテスト（モックでWASM依存を切替）

### 単体テスト
- `grep` 結果を基に、WASM依存モジュールのリストをテストで検証（例: `src/offscreen/sqlite` が存在すれば `wasm-unsafe-eval` 必須）
- CSP生成関数の分岐テスト

## 実装アプローチ
- **Outside-In**: E2E WASM動作テスト(失敗) → 統合 CSP文字列テスト(失敗) → 単体 WASM使用箇所テスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD
- **スパイク**: 最初に `grep -rn wasm` と `wxt` のページ別CSPサポート有無を調査する小タスクから開始

## 見積もり
3pt（要チーム見積もり）— 調査と条件分岐の設計を含むため中規模。WXTの制約で(B)になる可能性あり

## 技術的考慮事項
- 依存関係: 01/03と同ファイル。03のvalidation後に実施するとCSP変更の安全性が高い
- テスタビリティ: Manifest V3の `content_security_policy.extension_pages` は単一文字列のみ。ページ別CSPは未サポートの可能性が高い（要WXT docs確認）
- 非機能要件: WASMの有無は性能・ストレージに直結。除去してsqliteが壊れると全履歴が保存不可の重大障害
- 現状: wxt.config.ts:67 は `script-src 'self' 'wasm-unsafe-eval'` を無条件付与。`@subframe7536/sqlite-wasm@1.3.1` と `wa-sqlite` が依存関係にあり、offscreenでのみ使用の可能性
- 代替案: どうしても単一CSPなら、コメントとADRで「なぜ必要か」を残し、将来WASMを除去できた時点で即時除去できるようにする

## 実装者向け注記

### 現状コードの確認
```bash
grep -rn "wasm\|WebAssembly\|sqlite-wasm\|wa-sqlite" src/ wxt.config.ts package.json
grep -rn "wasm-unsafe-eval" wxt.config.ts
cat wxt.config.ts | grep -A2 content_security_policy
# WXTがページ別CSPをサポートするか確認
grep -rn "content_security_policy" node_modules/wxt/dist/ 2>&1 | head -20
```

### 実装手順
1. スパイク: WASM使用箇所を特定
   ```bash
   grep -rn "sqlite\|wasm" src/offscreen/ src/background/ src/utils/
   ```
2. WXT docsで `content_security_policy` がページ別に書けるか確認。書けない場合は(B)案へ
3. (A)可能な場合: `wxt.config.ts` でページ別CSPを定義
   ```ts
   // 例: offscreenのみ wasm-unsafe-eval
   content_security_policy: {
     extension_pages: `script-src 'self'; ...`, // wasm無し
     // offscreenは別途指定（WXTがサポートすれば）
   }
   ```
4. (B)の場合: 既存行にコメント追加
   ```ts
   // sqlite-wasm@1.3.1 (offscreen/sqlite) requires wasm-unsafe-eval. Remove when wa-sqlite is replaced.
   extension_pages: `script-src 'self' 'wasm-unsafe-eval'; ...`
   ```
5. `npm run build` でCSPを確認、E2EでWASM動作確認

### 落とし穴
- `wasm-unsafe-eval` を除去すると `WebAssembly.compile` がCSPでブロックされ、sqlite初期化が失敗する。必ずE2Eで履歴保存を試す
- WXTのバージョンによっては `content_security_policy` の型が `extension_pages` のみ。無理にページ別にしようとすると型エラー
- `wa-sqlite` はWASM無しでも動作するフォールバックを持つ可能性。要確認

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（WASM必要性の根拠をPRに明記、Security Review観点確認）
- [ ] リファクタリング完了
- [ ] ロールバック手段: `wasm-unsafe-eval` を再付与する1行revertで即時切り戻し
- [ ] ドキュメント更新済み（必要ならADRに「なぜwasm-unsafe-evalが必要か」を記録）

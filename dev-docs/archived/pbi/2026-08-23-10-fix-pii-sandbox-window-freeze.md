# PBI: pii-sandbox window公開の凍結 — 隔離破綻防止

## ユーザーストーリー
docs訪問者として、PIIサンドボックスのwindow公開が改竄されないようにしてほしい、なぜなら `docs/assets/pii-sandbox.js:14` の `window.PiiSandbox` が origin検証や `Object.freeze` 無しで公開されると、同一originのiframeや拡張機能が `PiiSandbox.sanitize` を上書きし、マスク結果を偽装できるから

## 優先度
- 順位: 10 / 12
- RICEスコア: 12.5 (Reach=10 / Impact=0.5 / Confidence=50% / Effort=0.20人月)
- 根拠: docs訪問者10人にのみ影響。攻撃には同一origin iframeが必要で、GitHub Pagesの静的docsでは再現性低くConfidence 50%。Impactもdocsデモの偽装に留まるため0.5。Effortはfreeze 1行で低。依存: 09 implicit global解消後に実施すると公開物の整合性が保てる

## ビジネス価値
- セキュリティ: `PiiSandbox.sanitize` の上書きを防止、デモ結果の信頼性担保
- 将来性: docsに外部originからのpostMessage連携を追加した際の基盤
- 測定: `Object.isFrozen(window.PiiSandbox)` がtrue、 `window.PiiSandbox.sanitize = evil` で上書きが失敗する

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — 正常なsanitize呼び出しは成功する
  Given docsページがロードされ、window.PiiSandbox が凍結されている
  When window.PiiSandbox.sanitize('test@example.com') を呼ぶ
  Then マスクされた結果が返る
  And Object.isFrozen(window.PiiSandbox) が true である

Scenario: 境界ケース — 上書きが防止される
  Given window.PiiSandbox が凍結されている
  When 攻撃者が window.PiiSandbox.sanitize = () => 'hacked' を試みる
  Then TypeError がthrowされるか、代入が無視される（strict modeではthrow）
  And 元のsanitizeが依然として動作する

Scenario: エラーケース — origin検証が無い場合のリスクを文書化
  Given docsが外部originからpostMessageでsanitizeを呼ばない
  When window.PiiSandbox が公開されている
  Then origin検証は不要であることがADRまたはコメントで明記されている
  And 将来postMessage連携する場合はorigin検証を追加するTODOが残っている
```

## 受け入れ基準
- [ ] `docs-src/pii-sandbox.ts` または `docs/assets/pii-sandbox.js` の `window.PiiSandbox` 代入後に `Object.freeze(window.PiiSandbox)` が呼ばれている
- [ ] `sanitize` プロパティも `writable: false, configurable: false` で定義されている（freezeで包含されるが明示的に確認）
- [ ] `Object.isFrozen(window.PiiSandbox)` がテストでtrueである
- [ ] 上書き試行が失敗することをテストで確認
- [ ] origin検証が不要な理由がコメントで明記されている（または将来の拡張点としてTODO）

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- Playwrightでdocsページを開き、 `page.evaluate(() => Object.isFrozen(window.PiiSandbox))` がtrueであることを確認
- `page.evaluate(() => { try { window.PiiSandbox.sanitize = null; return false; } catch { return true; } })` で上書き失敗を確認

### 統合テスト
- `docs-src/pii-sandbox.ts` のビルド成果物を検査し、 `Object.freeze` が含まれることをassert

### 単体テスト
- `docs-src/pii-sandbox.test.ts` で、freeze後の上書きが失敗することをjsdomで検証
- `Object.getOwnPropertyDescriptor(window.PiiSandbox, 'sanitize')` で `writable: false` を確認

## 実装アプローチ
- **Outside-In**: E2E freezeテスト(失敗) → 統合 成果物検査テスト(失敗) → 単体 上書き防止テスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD

## 見積もり
1pt（要チーム見積もり）— freeze 1行とテストの小規模

## 技術的考慮事項
- 依存関係: 09 implicit global解消後に実施。09で公開物が整理されてからfreezeをかけると二重手間を回避
- テスタビリティ: `Object.isFrozen` で容易に検証可能
- 非機能要件: freezeはランタイムコスト無し
- 現状: `docs/assets/pii-sandbox.js` は `esbuild --global-name=PiiSandbox` で `window.PiiSandbox` を自動生成。`docs-src/pii-sandbox.ts` 側で `window.PiiSandbox` を直接操作していないため、freezeは `docs-src` 側で `if (typeof window !== 'undefined') Object.freeze(PiiSandbox)` または成果物側で追加
- origin検証: docsは現在postMessageで外部と通信しないため不要。将来 `window.addEventListener('message', ...)` を追加する場合は `event.origin` 検証を必須とする旨をコメントに残す

## 実装者向け注記

### 現状コードの確認
```bash
cat docs-src/pii-sandbox.ts
grep -n "window.PiiSandbox\|Object.freeze" docs/assets/pii-sandbox.js docs-src/pii-sandbox.ts
cat docs/assets/pii-sandbox.js | tail -20
```

### 実装手順
1. `docs-src/pii-sandbox.ts` にfreezeを追加:
   ```ts
   import { sanitizeRegex, MAX_INPUT_SIZE } from '../src/utils/piiSanitizer.js';
   export async function sanitize(text: string) { ... }
   export { MAX_INPUT_SIZE };
   // 公開後の凍結（esbuildのglobal-nameでwindow.PiiSandboxが作られる場合）
   if (typeof window !== 'undefined' && (window as any).PiiSandbox) {
     Object.freeze((window as any).PiiSandbox);
   }
   ```
   または `esbuild` のfooterでfreeze:
   ```json
   "build:docs-pii": "esbuild docs-src/pii-sandbox.ts --bundle --outfile=docs/assets/pii-sandbox.js --format=iife --global-name=PiiSandbox --footer:js=\"Object.freeze(PiiSandbox);\""
   ```
2. `npm run build:docs-pii && grep -n "Object.freeze" docs/assets/pii-sandbox.js` で確認
3. Playwrightで `Object.isFrozen` を確認

### 落とし穴
- `esbuild --global-name=PiiSandbox` は `var PiiSandbox = ...` を生成するが、`window.PiiSandbox` への代入はブラウザのglobal展開に依存。`var` と `window` の同一性を前提にfreezeする際は `PiiSandbox` と `window.PiiSandbox` の両方をfreeze
- `Object.freeze` はshallow。`PiiSandbox.sanitize` が関数ならfreezeで十分だが、将来的にネストしたオブジェクトを公開する場合は `deepFreeze` が必要
- docsは `file://` で開く場合もあり、 `window` が無い環境（SSR）でのガード `typeof window !== 'undefined'` を忘れない

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（freezeの有効性をPRで検証結果貼付け）
- [ ] リファクタリング完了
- [ ] ロールバック手段: freeze行を除去するrevertで切り戻し可能
- [ ] ドキュメント更新済み（不要なら更新なし、freezeの意図をコメントに記載）

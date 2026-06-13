---
title: "テストカバレッジ 45% から 91% へ — Yasumaro の品質改善記録"
emoji: "📊"
type: "tech"
topics: ["typescript", "vitest", "テスト", "chrome拡張機能", "ci"]
published: false
---

Yasumaro v5.2 に向けた開発の中で、テストカバレッジを 45% から 91% に引き上げました。この記事では、その過程で取り組んだことと、Chrome 拡張機能のテストで直面した課題を振り返ります。

---

## 出発点：45% という数字

v5.1.10 時点でのカバレッジは Statements 45.38% でした。プロジェクトの成長に伴い、UI コンポーネント・ダイアログ・パネルクラスが増えていたにもかかわらず、テストが追いついていませんでした。

特にカバレッジが低かったファイルは次のとおりです。

| ファイル | 変更前 |
|---------|--------|
| `masterPasswordUi.ts`（popup） | 0% |
| `historyEntryRow.ts` | 0.5% |
| `privatePageDialog.ts` | 9.61% |
| `diagnosticsPanel.ts` | 17.2% |
| `customPromptManager.ts` | 25.95% |

これらはいずれも DOM 操作が多い UI クラスで、テスト環境（jsdom）での検証が難しいと後回しになっていたものです。

---

## TypeScript strict モードの有効化

カバレッジ向上と並行して `tsconfig.json` の `strict: true` を有効化しました。これにより `noImplicitAny` などが強制され、`any` 型で誤魔化していた箇所が明示的なエラーになります。

型の厳格化を進める中で、いくつかの実装バグが型エラーとして表面化しました。

```typescript
// strict: true で発覚した例
// 以前: any に代入して型チェックが通っていた
function handleResult(result: any) {
  return result.data.items;  // runtime error のリスクがあった
}

// 修正後: 正しい型を定義してコンパイル時に検証
function handleResult(result: AISummaryResult) {
  if (!result.success) return null;
  return result.data?.items;
}
```

`any` → `unknown` への移行は機械的な作業ではなく、「この値は本当に何の型か」を考え直すプロセスでもありました。

---

## Chrome 拡張機能テストの難しさと対策

### jsdom での DOM テスト

Chrome 拡張機能の UI コンポーネントは多くが `document.createElement` や `innerHTML` でレンダリングします。jsdom はブラウザの DOM API を Node.js 環境でエミュレートしますが、いくつかの制限があります。

- `getComputedStyle` の一部プロパティが未実装
- `ResizeObserver` が存在しない
- `chrome.*` API が存在しない

これらは `vitest.setup.ts` でモックを注入して対応しました。

```typescript
// vitest.setup.ts
import { WebCrypto } from '@peculiar/webcrypto';

// Web Crypto API（jsdom は実装が不完全）
Object.defineProperty(global, 'crypto', {
  value: new WebCrypto(),
  writable: true,
});

// chrome.* API のモック
global.chrome = {
  storage: { local: { get: vi.fn(), set: vi.fn() }, session: { ... } },
  runtime: { sendMessage: vi.fn(), ... },
  notifications: { onButtonClicked: { addListener: vi.fn() }, ... },
  // ...
};
```

### `vi.spyOn` と モック関数の落とし穴

`models-dev-dialog-event-handlers.test.ts` では `vi.spyOn` を使ったモック構成が間違っており、7 件のテストがスキップされていました。

問題は、`vi.spyOn` でモックしたい対象が「モジュールから直接エクスポートされた関数」ではなく「オブジェクトのメソッド」だったことです。

```typescript
// NG: モジュールのデフォルトエクスポートにはスパイできない
vi.spyOn(someModule, 'default');

// OK: オブジェクトのメソッドとしてスパイ
const target = { method: originalFn };
vi.spyOn(target, 'method').mockImplementation(() => {});
```

このような型の制約も `strict: true` によって発見しやすくなりました。

---

## カバレッジ向上の結果

v5.1.23 時点でのカバレッジは次のとおりです。

| 指標 | v5.1.10 | v5.1.23 | 増分 |
|------|---------|---------|------|
| Statements | 45.38% | 91.47% | +46.09% |
| Lines | — | 92.98% | — |
| テスト数 | 2,847 | 5,406 | +2,559 |
| Failures | — | 0 | — |

10 ファイルを集中的にテストしました。

| ファイル | 変更前 | 変更後 | 追加テスト数 |
|---------|--------|--------|------------|
| `customPromptManager.ts` | 25.95% | 95.23% | 36 |
| `privatePageDialog.ts` | 9.61% | 100% | 24 |
| `historyEntryRow.ts` | 0.5% | 98.49% | 46 |
| `masterPasswordUi.ts` | 0% | 99% | 59 |
| `diagnosticsPanel.ts` | 17.2% | 100% | 28 |
| `domainFilterTagUI.ts` | 22.8% | 75%+ | 34 |
| `masterPassword.ts` | 28.8% | 99.36% | 48 |
| `models-dev-dialog.ts` | 52.4% | 98.78% | 46 |
| `historyTagEditModal.ts` | 35.4% | 98.78% | 43 |
| `historyPendingPanel.ts` | 53.7% | 100% | 52 |

---

## GitHub Actions による継続的検証

テストを書くだけでは不十分で、継続的に実行される仕組みが必要です。v5.1.23 で GitHub Actions の 3 ワークフローを整備しました。

```
.github/workflows/
  ├── ci.yml        # PR/push to main: type-check + test + build
  ├── coverage.yml  # push to main: カバレッジレポート生成
  └── release.yml   # v* タグ: Chrome/Firefox/Edge ビルド + GitHub Release
```

`ci.yml` は PR のたびに `npm run validate`（型チェック＋テスト）と `npm run build` を実行します。カバレッジのリグレッションもプルリクエスト上で可視化されます。

```yaml
# ci.yml の抜粋
- name: Validate
  run: npm run validate

- name: Build
  run: npm run build
```

また `release.yml` はバージョンタグ（`v5.2.0` など）を push するだけで Chrome・Firefox・Edge 向けのビルドを生成し GitHub Release に添付します。手動でビルドして添付する手間がなくなりました。

---

## バージョン整合性テスト

`package.json`・`manifest.json`・`wxt.config.ts` のバージョン番号が揃っているかを自動検証するテストも追加しました（v5.1.24）。

```typescript
// src/utils/__tests__/versionConsistency.test.ts
it('all version files should have the same version', () => {
  const versions = readVersions();
  const unique = new Set(Object.values(versions));
  expect(unique.size).toBe(1);
});
```

このテストは `npm validate` の一部として常に実行されるため、バージョンの更新漏れを即座に検出できます。実際、v5.1.24 への更新時に `wxt.config.ts` が v5.1.22 のままだった問題をこのテストが検出しました。

---

## まとめ

今回の品質改善で学んだことをまとめます。

1. **型の厳格化はテスト品質も上げる**: `strict: true` で型の問題が表面化し、既存のバグを発見できた
2. **Chrome 拡張機能の UI テストは環境構築が鍵**: jsdom + vitest.setup.ts でのモック整備が最初の壁
3. **CI は安全ネット**: PR のたびに自動テストが走る環境を作ることで、リグレッションを防げる
4. **バージョン整合性テストは地味に効く**: 手動の確認ミスを自動化することで、リリース時の不安が減る

テストカバレッジは手段であって目的ではありませんが、91% という数字は「主要なコードパスが検証されている」という自信につながっています。

# PBI: host_permissions 自動生成 — 16行手書きの脱落防止

## ユーザーストーリー
開発者として、host_permissions の16行を手書きせず自動生成したい、なぜなら `wxt.config.ts:47-64` の `http://127.0.0.1:27123/*` 等を4ports×2proto×2hostで手書きすると、ポート追加・削除時の脱落や `http`/`https` の片側漏れが起き、Obsidian Local REST APIやローカルAIへの接続が静かに失敗するから

## 優先度
- 順位: 5 / 12
- RICEスコア: 80 (Reach=20 / Impact=1 / Confidence=80% / Effort=0.20人月)
- 根拠: 開発者20人に月1回のリリースで影響。脱落時の接続失敗はユーザーにも波及するが、手動レビューで気づく可能性もあるためImpactは1。Effortは生成関数1つで低。依存: 01 CSP port restrictionのSSOTとして先行すると二重管理を解消できる

## ビジネス価値
- 信頼性: ポート追加時の脱落をゼロに。Obsidian接続失敗の問い合わせ削減
- 保守性: `LOCAL_PORTS` を1箇所で管理、host_permissionsとCSPの二重管理を解消
- 測定: `wxt.config.ts` のhost_permissions行数が16行直書きから3行（生成呼び出し）に削減、テストで16オリジンが生成されることをassert

## BDD受け入れシナリオ

```gherkin
Scenario: 正常系 — 生成されたhost_permissionsで全ポートに接続できる
  Given wxt.config.ts がビルドされる
  When 生成されたhost_permissionsを検査する
  Then http://127.0.0.1:27123/*, https://localhost:27124/* 等の16オリジンが全て含まれている
  And Obsidian (27123/27124) とローカルAI (11434/1234) の疎通テストが全パスする

Scenario: 境界ケース — 新ポート追加時は1箇所の変更で全箇所に反映される
  Given LOCAL_PORTS に 9999 を追加した
  When ビルドする
  Then host_permissions と connect-src の両方に 9999 が自動で含まれる
  And 手動での16行編集が不要である

Scenario: エラーケース — 生成関数のバグでhost_permissionsが空でもビルド時に気づく
  Given 生成関数が空配列を返した（テストでモック）
  When ビルドまたはテストを実行する
  Then host_permissionsが空であることを検出するテストが失敗する
  And CIでブロックされる
```

## 受け入れ基準
- [ ] `src/utils/cspDomains.ts` に `LOCAL_PORTS` 定数と `buildLocalHostPermissions()` 関数が存在する
- [ ] `wxt.config.ts:47-64` の16行直書きが `...buildLocalHostPermissions()` の1行に置換されている
- [ ] `buildLocalHostPermissions()` は `http/https × localhost/127.0.0.1 × LOCAL_PORTS` の全組合せを生成する
- [ ] 単体テストで16オリジン（またはports数×4）が生成されることをassert
- [ ] `npm run build` 後のmanifestのhost_permissionsが期待通り

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 拡張機能をロードし、popupの接続テストで全ポートへのfetchが成功することを確認

### 統合テスト
- `wxt.config.ts` のmanifest生成結果から `host_permissions` をassert（16オリジン含む、AI provider domainsも含む）

### 単体テスト
- `src/utils/cspDomains.test.ts` に追加:
  - `buildLocalHostPermissions()` が16件返す
  - 各要素が `http(s)://(localhost|127.0.0.1):port/*` 形式
  - 重複無し
  - 新ポート追加時のテスト（LOCAL_PORTSをモックして件数変化を確認）

## 実装アプローチ
- **Outside-In**: 統合 host_permissionsテスト(失敗) → 単体 生成関数テスト(失敗) → 実装 → グリーン
- **Red-Green-Refactor**: TDD

## 見積もり
2pt（要チーム見積もり）— 生成関数は小規模だが、wxt.config.tsの置換と既存接続テストの回帰確認を含む

## 技術的考慮事項
- 依存関係: 01 CSP connect-src と同根。両方を同じ `LOCAL_PORTS` から生成することで二重管理を解消。01と同バッチ推奨
- テスタビリティ: 純関数としてテスト容易
- 非機能要件: 生成はビルド時のみ、ランタイム影響なし
- 既存資産: `src/utils/cspDomains.ts` は既に `AI_PROVIDER_HOST_PERMISSIONS` を管理。ここに `LOCAL_PORTS` を追加するのが自然

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "host_permissions" wxt.config.ts -A20
cat src/utils/cspDomains.ts
cat src/utils/cspDomains.test.ts 2>&1 | head -50
```

### 実装手順
1. `src/utils/cspDomains.ts` に追加:
   ```ts
   export const LOCAL_PORTS = [27123, 27124, 11434, 1234] as const;
   export function buildLocalHostPermissions(): string[] {
     return LOCAL_PORTS.flatMap(port => [
       `http://127.0.0.1:${port}/*`,
       `https://127.0.0.1:${port}/*`,
       `http://localhost:${port}/*`,
       `https://localhost:${port}/*`,
     ]);
   }
   export function buildLocalConnectSrc(): string[] {
     return LOCAL_PORTS.flatMap(port => [
       `http://127.0.0.1:${port}`,
       `https://127.0.0.1:${port}`,
       `http://localhost:${port}`,
       `https://localhost:${port}`,
     ]);
   }
   ```
2. `wxt.config.ts:47-64` を `...buildLocalHostPermissions(),` に置換
3. `wxt.config.ts:67` のCSPも `buildLocalConnectSrc()` を使用（01と同時対応）
4. テスト追加、 `npm run build` でmanifest確認

### 落とし穴
- `host_permissions` は `/*` 付き、CSPの `connect-src` は `/*` 無し。混同しない
- `LOCAL_PORTS` を増やした時に `optional_host_permissions` との重複に注意（AI providerは別管理）
- `wxt.config.ts` は `import` で `src/utils/cspDomains.js` を読むが、TypeScriptのパス解決で `.js` 拡張子が必要な場合あり（既存は `from './src/utils/cspDomains.js'`）

## Definition of Done
- [ ] 全BDDシナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了（生成結果の16オリジンをPRで目視確認）
- [ ] リファクタリング完了
- [ ] ロールバック手段: 旧16行を復活させるrevertで即時切り戻し
- [ ] ドキュメント更新済み（dev-docs/DESIGN_SPECIFICATIONS.md にLOCAL_PORTSのSSOT化を追記）

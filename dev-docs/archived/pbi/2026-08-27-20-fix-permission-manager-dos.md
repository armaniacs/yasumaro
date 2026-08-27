# PBI: permissionManager 無制限キー蓄積DoS

## ユーザーストーリー
開発者として、`recordDeniedVisit` が無制限にキーを蓄積しないようにしたい、なぜなら長さ検証なしで任意の `domain` 文字列をキーとして `chrome.storage.local` に保存でき、攻撃者やバグが巨大キー/大量キーを投入するとストレージ枯渇（DoS）や `chrome.storage` の quota 超過につながるから。

## ビジネス価値
- `chrome.storage.local` の quota（約5-10MB）枯渇による拡張機能全体の機能停止を防止する
- 任意長ドメイン文字列の投入によるメモリ/ストレージ膨張を抑止し、安定性を担保する
- 測定: 異常長ドメイン（>253文字）や大量キー（>100件）が拒否され、ストレージサイズが上限内に収まること

## 優先度
- 順位: 3 / 17
- RICEスコア: 960（Reach=40 / Impact=1.5 / Confidence=80% / Effort=0.05）
- 根拠: 全ユーザーの `denied_domains` に影響し得る (Reach=40)。ストレージ枯渇は機能停止に直結するが直接のデータ損失ではないため Impact=1.5。`recordDeniedVisit` のバリデーション欠如はコードで確証 (Confidence=80%)。バリデーション追加のみで Effort 極小。

## なぜなぜ分析
- なぜDoS可能か: `src/utils/permissionManager.ts:105-127` の `recordDeniedVisit(domain)` が `domain` の長さ・文字種・件数上限を一切検証せず、`updateDeniedDomains` で `deniedDomains[domain] = { count, lastDenied }` と無条件に挿入するため。呼び出し元 `src/background/pipeline/steps/checkPermissionStep.ts:34` と `src/popup/statusPanel.ts:157` は `new URL(url).hostname` 由来だが、将来的な呼び出し経路や直接呼び出しで任意文字列が流入し得る
- なぜバリデーションがなかったか: 初期実装で「`domain` は常に正規のホスト名」という暗黙の前提で設計し、入力検証を省略した
- なぜ上限がないか: `denied_domains` は「拒否されたドメインの履歴」として無制限に蓄積する設計で、件数上限やLRU削除を想定していなかった。`cleanupOldDeniedEntries(90日)` は時間ベースのみで件数ベースの上限がない
- なぜ気づかなかったか: テストが正常なドメイン（`example.com` 等）のみで検証し、異常長・大量キー・不正文字のケースをカバーしていない
- 解: `recordDeniedVisit` に (1) ドメイン形式バリデーション（RFC 1035準拠: 1-253文字、ラベル63文字以内、許可文字のみ）、(2) 上限100件（LRUまたはカウント昇順で古いものから削除）、(3) 単一キーの長さ上限（例: 253文字）を追加する

## BDD受け入れシナリオ

```gherkin
Scenario: ハッピーパス — 正常ドメインは記録される
  Given `denied_domains` が空の状態
  When `recordDeniedVisit("example.com")` を呼ぶ
  Then `getDeniedDomains()` に `example.com: { count: 1 }` が保存される
  And `recordDeniedVisit("example.com")` を再度呼ぶと `count: 2` にインクリメントされる

Scenario: 攻撃 — 異常長ドメインと大量キーは拒否/制限される
  Given `denied_domains` に既に100件のエントリが存在する状態
  When 攻撃者が `recordDeniedVisit("a".repeat(10000))`（10000文字の巨大キー）を呼ぶ
  Then 長さ検証により保存が拒否され `denied_domains` に巨大キーは追加されない
  And 続けて101件目の正常ドメイン `recordDeniedVisit("new-attacker.com")` を呼ぶ
  Then 上限100件により最も古い/カウント最小のエントリが削除されるか、新規追加が拒否され、総件数は100件を超えない
```

## 受け入れ基準
- [x] `src/utils/permissionManager.ts:105` の `recordDeniedVisit` がドメイン長さ検証（例: `domain.length <= 253` かつ `domain.length > 0`）を行う
- [x] ドメイン文字種検証（例: `^[a-z0-9.-]+$` かつラベル長 `<=63`）を行い、不正な `domain` は保存せず `logWarn` で警告する
- [x] `denied_domains` の総件数上限が100件に設定され、上限超過時は最も古い `lastDenied` またはカウント最小のエントリを削除するか、新規追加を拒否する（方針は実装時に決定しコメントで明記）
- [x] 上限・バリデーションの単体テストが追加され、`npx vitest run src/utils/__tests__/permissionManager.test.ts` がパスする
- [x] 既存の `checkPermissionStep.ts:34` / `statusPanel.ts:157` 経路で正常ドメインの記録に回帰がないこと

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 不要（ストレージ内部ロジック）

### 統合テスト
- `recordDeniedVisit` → `getDeniedDomains` → `getFrequentDeniedDomains` の一連で、上限超過時に `getFrequentDeniedDomains` の結果が整合すること
- `cleanupOldDeniedEntries` / `cleanupDismissedEntries` と上限ロジックの相互作用が正しいこと

### 単体テスト
- 異常長ドメイン（0文字、254文字、10000文字）が拒否されること
- 不正文字を含むドメイン（`evil.com<script>`, `foo bar`, `../../etc/passwd`）が拒否されること
- 100件上限: 100件保存後に101件目を追加した際の挙動（削除 or 拒否）が期待通りであること
- 正常ドメイン（`example.com`, `sub.domain.co.jp`, `xn--` punycode）の保存は成功すること
- `domain` が `null` / `undefined` / 空文字 / 数値の場合のハンドリング

## 実装アプローチ
- **Outside-In**: まず異常長・大量キーの再現テスト（RED）を `permissionManager.test.ts` に追加し現行で無制限に保存されてしまうことを証明 → バリデーション実装 → GREEN
- **Red-Green-Refactor**: バリデーションは `private isValidDomain(domain: string): boolean` ヘルパーに切り出し、単体テスト可能にする。上限管理は `private enforceMaxEntries(domains)` ヘルパーに切り出す
- **段階的**: まずはバリデーションのみを先行し、上限ロジックは別コミットで追加してもよい（いずれも Effort 小）

## 見積もり
0.05pt（バリデーション + 上限ロジック追加、要チームでの見積もり）

## 技術的考慮事項
- 依存関係: `permissionManager.ts` は `optimisticLock.ts` 経由で `chrome.storage.local` に依存。バリデーションはストレージアクセス前に行い不要な `withOptimisticLock` 呼び出しを避ける
- テスタビリティ: `chrome.storage.local` は `vitest` で `chrome` グローバルをモックして検証。`isValidDomain` は純粋関数のため直接テスト可能
- 非機能要件: バリデーションは同期処理で性能影響なし。上限100件は `Object.keys(deniedDomains).length` の O(n) チェックで十分（n=100で無視可能）
- 既存データ: 既に保存された不正キー（異常長キー）が存在する場合のマイグレーション — `getDeniedDomains` 取得時に不正キーをフィルタするか、次回 `cleanup` で除去する方針を決める
- セキュリティ: 本修正はDoS対策であり、XSS等の直接的なコード実行を防ぐものではない。ドメイン表示時のエスケープは別途 `dashboard` 側で担保されているか確認すること

## 実装者向け注記

### 現状コードの確認
```bash
grep -n "recordDeniedVisit\|getDeniedDomains\|DENIED_DOMAINS" src/utils/permissionManager.ts
# 該当: src/utils/permissionManager.ts:41-67,105-127
grep -rn "recordDeniedVisit" src/ --include="*.ts" | head -n 20
# 呼び出し元: src/background/pipeline/steps/checkPermissionStep.ts:34, src/popup/statusPanel.ts:157
```

### 実装手順
1. `src/utils/permissionManager.ts:105-127` の `recordDeniedVisit` を読む — バリデーションが一切ないことを確認
2. ドメイン検証ヘルパーを追加:
   ```ts
   private isValidDomain(domain: string): boolean {
     if (!domain || typeof domain !== 'string') return false;
     if (domain.length === 0 || domain.length > 253) return false;
     // RFC 1035: ラベルは1-63文字、英数字とハイフンのみ、先頭末尾は英数字
     const labels = domain.split('.');
     for (const label of labels) {
       if (label.length === 0 || label.length > 63) return false;
       if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/i.test(label)) return false;
     }
     return true;
   }
   ```
3. `recordDeniedVisit` の先頭で検証を追加:
   ```ts
   async recordDeniedVisit(domain: string): Promise<void> {
     if (!this.isValidDomain(domain)) {
       logWarn('PermissionManager', { domain: String(domain).slice(0, 100) }, undefined, 'Invalid domain rejected');
       return;
     }
     // ... 既存の updateDeniedDomains ロジック
     // 上限チェック: updater 内で Object.keys(deniedDomains).length >= 100 なら古いエントリを削除
   }
   ```
4. 上限ロジックを `updateDeniedDomains` の `updater` 内に実装 — 例: `if (Object.keys(deniedDomains).length >= 100 && !deniedDomains[domain]) { /* 最も古い lastDenied を1件削除 */ }`
5. 異常系テストを追加し `npm run type-check && npx vitest run src/utils/__tests__/permissionManager.test.ts` で検証

### 落とし穴
- `domain` は `new URL(url).hostname` 由来で通常は正規だが、将来の呼び出し元で `userInput` が直接渡される可能性を考慮し、必ず検証すること
- `chrome.storage.local` の quota は `chrome.storage.local.getBytesInUse` で確認可能だが、本PBIでは件数上限で予防する — quota 自体の監視は別PBIで検討
- `updateDeniedDomains` は `withOptimisticLock` で競合リトライするため、バリデーションは `updateDeniedDomains` の外側（ストレージアクセス前）で行い、不要なリトライを避けること

## Definition of Done
- [x] 全BDDシナリオが自動テストとして実装されパスする
- [x] 異常長ドメインと大量キー投入がテストで拒否/制限されることが証明されている
- [x] 既存の正常ドメイン記録に回帰がないこと
- [x] コードレビュー完了
- [x] ドキュメント更新済み（`permissionManager.ts` のコメントに上限値の根拠を追記）

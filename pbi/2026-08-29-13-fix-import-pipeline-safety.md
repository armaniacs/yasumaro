# PBI: インポート経路の安全化 — 認証→上限→パース→検証（VULN-023/030/034/035/036, CWE-400/347/94）

## ユーザーストーリー
利用者として、settings・logs・backup の各インポートで悪意あるファイルが署名検証前にリソースを消費せず、偽造履歴が受け入れられず、エクスポートの frontmatter が汚染されないようにしたい、なぜなら 3 系統が独立実装で順序規約がなく、logs import は署名ゲート自体が存在しないから

## ビジネス価値
- VULN-034: settings import が HMAC 検証前に atob 増幅＋KDF＋復号（実証済み）→ 認証先行化
- VULN-035: log import に署名ゲートなし・validateRow 2/9 フィールド（実証: 偽造行受入）→ 署名＋全フィールド検証
- VULN-036: backup panel が上限前に全ファイル parse（実証: 192MB 確保）→ 境界で cap
- VULN-023: log import の無制限 parse/accumulate（実証: 93k+ バッチ）→ サイズ cap
- VULN-030: export frontmatter の url/tags が生（実証: 注入キーが解決）→ YAML エスケープ
- 測定方法: 3 系統すべてが共通プリミティブ（auth→cap→parse→validate）を通ること

## 優先度
- 順位: 13 / 14
- RICEスコア: 405（Reach=300 / Impact=0.3 / Confidence=90% / Effort=0.2人月）
  - Reach 300: ファイル import/export 利用者（設定移行・ログ取り込み・バックアップ）
  - Impact 0.3: 履歴偽造・DoS・export 汚染の複合
  - Confidence 90%: settings 側 HMAC ゲートが正解実装として存在（fail-closed 実証済み）。プリミティブ化は既知パターンの統合
  - Effort 0.2: 共通プリミティブ＋3 系統適用＋エスケープ＋テスト
- 根拠: 「横断比較されてこなかった」ことが根因（5 Whys）。1 PBI で 3 系統の差異を一覧化して統一する

## BDD受け入れシナリオ

```gherkin
Scenario: 署名不正の settings ファイルはリソース消費なしで拒否される
  Given 巨大な偽造 settings ファイル（署名なし）が与えられる
  When import を実行する
  Then HMAC 検証が先に走り、decode/KDF/復号は実行されない

Scenario: 署名なしの log ファイルは受け入れられない
  Given 偽造履歴行を含む署名なし log ファイルが与えられる
  When log import を実行する
  Then 署名検証で拒否され、1 行も取り込まれない

Scenario: 巨大ファイルは parse 前に拒否される
  Given 20MB の backup ファイルが与えられる
  When restore を開始する
  Then file.size チェックで即時拒否され、parse は走らない

Scenario: エクスポート frontmatter の注入は無効化される
  Given url に改行と YAML 構造文字を含むレコードがある
  When ログをエクスポートする
  Then url/tags がエスケープされ、注入キー（build_meta 等）は解決されない
```

## 受け入れ基準
- [ ] 共通インポートプリミティブ（仮称 `importPipeline`: authenticate→sizeCap→parse→validate）が新設され、settings/logs/backup の 3 系統から使用される
- [ ] `src/utils/settingsExportImport.ts:163-178` が HMAC 検証を decode/KDF/復号より前に移動し、10MB の読み込み cap と typed-array decode（atob 増幅の除去）を適用している
- [ ] `src/dashboard/importLogsService.ts:27-33,41-77` に settings と同等の HMAC ゲート（export 側で署名付与）と file.size ≤ 10MB、rows ≤ 100k、総行数 cap が実装されている
- [ ] `validateRow` が全 9 フィールド（日付 parse、数値範囲、文字列長 cap）を検証する
- [ ] `src/dashboard/encryptedBackupPanel.ts:72-79` が file.size チェックを parse 前に行い、envelope 長検証を境界に移動している
- [ ] `src/dashboard/exportLogsService.ts:62-71` に YAML エスケープヘルパー（url/title/tags）が適用されている
- [ ] `npm run type-check` と `npm run validate` が成功する
- [ ] VulnHunter 再検証: 5 PoC が全て失敗する

## テスト戦略（t_wadaスタイル）

### E2Eテスト
- 対象なし（ファイル I/O はモック＋jsdom）

### 統合テスト
- 3 系統の import UI × 共通プリミティブ: 認証順序・cap・検証の統合検証
- export → import ラウンドトリップ（正当ファイルの互換維持）

### 単体テスト
- 新規: `importPipeline.test.ts`（順序契約: auth 呼び出しが parse より先）
- 新規: `validateRow` 全フィールドの境界値テスト
- 新規: `yamlFrontmatterEscape.test.ts`（注入キー・改行・構造文字）

## 実装アプローチ
- **Outside-In**: 順序契約テスト（Red: 現行は復号が先）→ プリミティブ実装（Green）→ 3 系統の移行
- **Red-Green-Refactor**: 既存 HMAC 実装（settingsExportImport.ts:377-407）をプリミティブに昇格させる（再実装しない）

## 見積もり
2pt（要チームでの見積もり — プリミティブ＋3 系統移行＋署名付与＋テスト）

## 技術的考慮事項
- 依存関係: Wave 2。PBI 12（crypto SSOT）の iterations に依存しうるが、本 PBI 単独でも着手可能（既定 iterations のまま）
- テスタビリティ: File/Blob は jsdom で生成可能
- 非機能要件: 正当ファイルの import/export 互換を壊さない（署名なき旧 log ファイルの扱いを仕様として決める — 移行期間の許可フラグ or 拒否）
- 注意: log export に署名を付けると旧拡張バージョンとの相互運用が変わる — CHANGELOG と PRIVACY ドキュメントの更新を含める

## 実装者向け注記

### 現状コードの確認
```bash
sed -n '160,180p' src/utils/settingsExportImport.ts
sed -n '375,410p' src/utils/settingsExportImport.ts
sed -n '25,80p' src/dashboard/importLogsService.ts
sed -n '68,82p' src/dashboard/encryptedBackupPanel.ts
sed -n '58,75p' src/dashboard/exportLogsService.ts
```

### 実装手順
1. `importPipeline.ts`（仮称）に 4 段階プリミティブを新設
2. settings import を HMAC 先行化（既存ゲートの呼び出し順を入れ替え）
3. log import/export に署名付与＋cap＋validateRow 全フィールド化
4. backup panel の size cap 前置き
5. YAML エスケープヘルパー適用
6. テスト追加、`npm run validate`

### 落とし穴
- HMAC 先行化で「envelope 全体に対する署名」の対象バイト範囲を既存実装と厳密一致させること（ずれると正当ファイルが拒否される）
- validateRow の厳格化で過去バージョンの正当 log ファイルが拒否される可能性 — 旧形式フィールドの許容範囲を先に棚卸しすること
- YAML エスケープは `summary` の既存サニタイザ（exportLogsService.ts:69）と重複させず、1 ヘルパーに統一すること

## Definition of Done
- [ ] 全 BDD シナリオが自動テストとして実装されパスする
- [ ] テストカバレッジが基準を満たす
- [ ] コードレビュー完了
- [ ] リファクタリング完了（グリーン後）
- [ ] VulnHunter 再スキャンで VULN-023/030/034/035/036 が解消されること

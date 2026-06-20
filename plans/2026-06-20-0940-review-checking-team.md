# Checking Team レビュー結果

実行日: 2026-06-20 09:40
レビュー対象: main (origin/main との差分 + プロジェクト全体)
フォーカス: 新機能以外の修正ポイント

## 総合評価: 93/100 (ランク: A)

## エージェント別スコア

| エージェント | スコア | High | Medium | Low |
|------------|:-----:|:----:|:-----:|:---:|
| Red Team Leader | 90 | 0 | 2 | 2 |
| Blue Team Leader | 70 | **1** | 2 | 1 |
| System Architect | 90 | 0 | 2 | 1 |
| Maintainability Guardian | 95 | 0 | 1 | 1 |
| Legacy Bridge Architect | 95 | 0 | 1 | 1 |
| UI Expert | 100 | 0 | 0 | 0 |
| Tuning Expert | 100 | 0 | 0 | 0 |
| SRE/Ops Specialist | 90 | 0 | 2 | 0 |
| Domain Logic Expert | 90 | 0 | 2 | 1 |
| Compliance & Privacy Guard | 100 | 0 | 0 | 0 |
| i18n Expert | 100 | 0 | 0 | 0 |
| Accessibility Advocate | 100 | 0 | 0 | 0 |
| Documentation Architect | 95 | 0 | 1 | 1 |
| FinOps Consultant | 90 | 0 | 2 | 1 |
| Edge & Mobile Strategist | 95 | 0 | 2 | 1 |
| Refactoring Evangelist | 90 | 0 | 2 | 1 |
| Ethics & Bias Auditor | 100 | 0 | 0 | 0 |
| Supply Chain & Dependency Sentinel | 100 | 0 | 0 | 0 |
| API & Contract Negotiator | 90 | 0 | 2 | 0 |
| DX Advocate | 85 | 0 | 3 | 0 |

## 重要指摘事項（優先度順）

### [High] Obsidian接続のデフォルトプロトコルがHTTP（自己署名証明書で接続不可）
- 指摘者: Blue Team Leader
- 場所: `src/background/obsidianClient.ts:126`
- 影響: `enforceHttps()`がHTTP→HTTPSに強制アップグレードするため、自己署名証明書を使う一般的なシナリオで証明書検証エラーが発生し接続が確立できない。ユーザーに認知されにくく、新規セットアップ時の初期接続失敗の原因になる。
- 対処: デフォルトプロトコルを `http` → `https` に変更する。
  ```typescript
  // 修正: const protocol = String(s[StorageKeys.OBSIDIAN_PROTOCOL] ?? 'https') || 'https';
  ```

### [Medium] innerHTMLによるXSSベクター（dashboard/popup UI）
- 指摘者: Blue Team Leader
- 場所: `src/dashboard/sqliteHistoryPanel.ts:382`, `src/popup/statusPanel.ts:99-325`
- 影響: ユーザーが閲覧したページのURL・タイトルを `innerHTML` に直接代入している箇所が複数存在する。Manifest V3のCSPで `<script>` のインライン実行はブロックされるが、`<img onerror>` や `<form action>` などの属性ベースのXSSは可能。DB由来の文字列を直接 innerHTML に流している。
- 対処: `textContent` または `insertAdjacentText` で安全に代入する。HTMLが必要な場合は `DOMPurify` 等のサニタイザーを通す。

### [Medium] APIキーの暗号化状態をログに出力
- 指摘者: Blue Team Leader
- 場所: `src/utils/storage.ts:590-596`
- 影響: `getSettings()` 内で各APIキーフィールドの存在有無・データ型・暗号化状態を `logInfo()` に記録。サービスワーカーinspect画面から参照可能。キーそのものの値は含まれないが、どのキーが設定済みか・暗号化方式の内部情報が漏洩する。
- 対処: `obsidianKeyInSettings`, `obsidianKeyType`, `isEncryptedCheck`, `hasMigratedKey` をログから削除。代わりに汎用的な `hasKeys: true` のみをログする。

### [Medium] ブランチ命名規則とバージョニングポリシーの不整合
- 指摘者: Domain Logic Expert, Documentation Architect
- 場所: `CONTRIBUTING.md:392-396` / `CHANGELOG.md:5-9`
- 影響: CHANGELOG.md の even/odd バージョニングポリシー（v6.偶数=bugfix / v6.奇数=feature）と CONTRIBUTING.md のブランチ命名規則が連動していない。`main` が v6.1.x（次の奇数）になった時のブランチ運用が未定義。
- 対処: ブランチ命名規則に even/odd ポリシーを反映する。`main` = v6.偶数.x、機能開発は `feature/` ブランチで行い、リリース時に `main` を次期偶数版に移行する、と明記する。

### [Medium] ブランチ種別とコミット種別の不一致
- 指摘者: System Architect, Refactoring Evangelist, DX Advocate
- 場所: `CONTRIBUTING.md:392-396,806-814`
- 影響: コミットメッセージ規約は `feat/fix/docs/style/refactor/test/chore` の7種別を定義するが、ブランチ命名規則は `feature/` と `hotfix/` の2種のみ。`fix/`, `refactor/`, `docs/` ブランチが作れず、開発者に混乱を招く。特に `fix/`（通常バグ修正）がないと非緊急バグ修正のブランチ種別が不明瞭。
- 対処: `fix/`, `refactor/`, `docs/` ブランチ種別を追加するか、または `feature/` と `fix/` のみに統一する。

### [Medium] PR ワークフローに `git add .` が記載されている
- 指摘者: DX Advocate
- 場所: `CONTRIBUTING.md:347`（日本語）, `765`（英語）
- 影響: ビルド成果物 (`dist/`)、`.DS_Store` などを誤ってコミットするリスクがある。
- 対処: `git add -p` または変更ファイルを個別指定するパターンに置き換える。

### [Medium] PR ワークフローに TypeScript 型チェックが含まれていない
- 指摘者: DX Advocate
- 場所: `CONTRIBUTING.md:351-354`（日本語）, `769-772`（英語）
- 影響: PR ワークフローの手順が `npm test` のみで `npm run type-check` をスキップ。
- 対処: `npm test` を `npm run validate` に置き換えるか、`npm test && npm run type-check` を含める。

### [Medium] SECURITY.md / 脆弱性報告ポリシーが未整備
- 指摘者: Red Team Leader
- 場所: `CONTRIBUTING.md`（該当セクションなし）
- 影響: 脆弱性報告窓口が一切ドキュメント化されていない。APIキー暗号化・PIIサニタイズ・CSP多層防御などセキュリティ重視のプロジェクトでありながら報告経路が未整備。
- 対処: `SECURITY.md` を作成し、脆弱性報告先（GitHub Security Advisory またはメール）と対応ポリシーを明記する。

### [Medium] コードレビューチェックリストにセキュリティ項目がない
- 指摘者: Red Team Leader
- 場所: `CONTRIBUTING.md:402-406,820-824`
- 影響: テスト・i18n・アクセシビリティ・ドキュメントはチェックリストにあるがセキュリティレビュー項目がない。
- 対処: チェックリストに `[ ] セキュリティレビューを実施した` を追加。

### [Medium] マルチバージョン保守・リリースブランチ戦略が未定義
- 指摘者: System Architect, SRE/Ops, API & Contract
- 場所: `CONTRIBUTING.md:392,811`
- 影響: 複数メジャーバージョンの並行保守や、v6.1.x 開始後の v6.0.x 保守のブランチ設計がない。
- 対処: `release/v6.x` のようなリリースブランチを定義するか、「最新メジャーのみサポート」を明文化する。

### [Medium] ハードコードされたバージョン番号
- 指摘者: Legacy Bridge, Refactoring Evangelist
- 場所: `CONTRIBUTING.md:392,810`（"v6.0.x"）
- 影響: v6.1.0 や v7.0.0 に移行した際に古いバージョン番号が残るリスク。
- 対処: 「現在の安定系列」のように汎用的な表現に変更する。

### [Medium] CLAUDE.local.md と CONTRIBUTING.md のブランチ命名の不一致
- 指摘者: Maintainability Guardian
- 場所: `CLAUDE.local.md:48`（`fix/xxx`） vs `CONTRIBUTING.md:394`（`hotfix/<名前>`）
- 影響: AIエージェントが `fix/xxx` 形式でブランチ生成してもプロジェクト規則に反する。
- 対処: 両ファイルのブランチプレフィックスを一致させる。

### [Medium] ブランチCIコストガバナンス欠如
- 指摘者: FinOps Consultant
- 場所: `CONTRIBUTING.md:392-396,808-812`
- 影響: 各ブランチへのプッシュごとにフルCI実行でコスト浪費。
- 対処: ブランチ種別ごとにCI実行範囲を明文化する。

### [Medium] モバイル/エッジ環境のレビュー観点欠落
- 指摘者: Edge & Mobile Strategist
- 場所: `CONTRIBUTING.md:400,818`
- 影響: コードレビューチェックリストにモバイル端末のメモリ制約・ネットワーク制約・オフライン動作の確認項目がない。
- 対処: チェックリストにモバイル端末でのメモリ・パフォーマンス・オフライン動作の確認項目を追加。

### [Medium] SemVer / バージョニング戦略が未定義
- 指摘者: API & Contract Negotiator
- 場所: `CONTRIBUTING.md:392,810`
- 影響: breaking change の判断基準やバージョン番号の決まり方が不明。
- 対処: 「本プロジェクトは Semantic Versioning に従う」旨と判断基準を明記。

### [Medium] PR ワークフローが `feature/` のみを例示
- 指摘者: Domain Logic, Documentation, Refactoring
- 場所: `CONTRIBUTING.md:342-361,758-779`
- 影響: `hotfix/` ブランチの追加にも関わらずワークフロー手順が `feature/` のみ。
- 対処: ワークフローで `hotfix/` も例示するか注釈を追加。

## コンフリクト調整結果

- **バージョン番号ハードコード**: Legacy Bridge (Medium) + Refactoring (Medium) — 同じ問題を独立して指摘。System Architect の判断を優先し、Medium 1件として統合。
- **ブランチ種別とコミット種別の不一致**: System Architect + Refactoring + DX Advocate が同方向の指摘。Medium 1件として統合。
- **バージョニングポリシーとブランチ規則の不整合**: Domain Logic + Documentation が同方向。Medium 1件として統合。

## 確認済みの良好点（複数エージェントから共通評価）

- ✅ CSP関連ドキュメントと多層防御設計が充実
- ✅ AES-GCM + PBKDF2 による適切な暗号化実装
- ✅ PIIサニタイザー（ReDoS対策、タイムアウト機構）が実装済み
- ✅ Mutex・楽観的ロックによる同時実行制御
- ✅ 日英バイリンガルドキュメントの一貫性
- ✅ Conventional Commits 準拠のコミットメッセージ規約
- ✅ 新機能以外のドキュメント・設定は適切に管理されている

## 未完了エージェント
なし（全20名完了）

## 最終スコア詳細
- 総合スコア: 93/100（ランク A）
- High 指摘: 1件
- Medium 指摘: 16件（重複統合後）
- Low 指摘: 10件（重複統合後）

# PBI: PROVIDER_LABELSのpopup内複製を単一ソース化する

**作成日**: 2026-08-07
**優先度**: 中
**見積もり**: 🟢低（1pt目安）
**副作用**: 🟢なし（表示ラベル定数の統合。UIの見た目は変わらない）
**種別**: 🔧非機能追加（refactor）

---

## 背景

コードレビューで、AIプロバイダ表示ラベルのマップが2箇所に存在し、手動同期を強いられていることが発見された。

### 重複の詳細

| ファイル | 行 | 内容 |
|---------|-----|------|
| `background/aiClient.ts:66-74` | `PROVIDER_LABELS` | カノニカル（7エントリ） |
| `popup/errorUtils.ts:7-15` | `AI_PROVIDER_LABELS` | 同一内容の複製 |

`popup/errorUtils.ts:6` に「background/aiClient.ts の PROVIDER_LABELS と同期を保つこと（popupバンドル軽量化のためローカル複製）」と明記されている。

**リスク**: 手動同期のため、プロバイダ追加時に片方だけ更新されて drift する。dashboard は `aiClient.ts` から正しく import しているが、popup のみが複製を保持している。

### 複製の理由

コメントによると popup バンドル軽量化のため。`aiClient.ts` から `PROVIDER_LABELS` だけ import すると、AIClient 全体（重い依存含む）が popup バンドルに巻き込まれる可能性がある。

## 実装者向け注記: 現状の確認

着手前に必ず実行すること:

```bash
grep -rn "PROVIDER_LABELS\|AI_PROVIDER_LABELS" src/ --include="*.ts" | grep -v __tests__
grep -rn "providerName\|aiProvider" src/popup/errorUtils.ts
```

## 受け入れ基準（BDD）

```gherkin
Scenario: プロバイダラベルが単一ソースから取得される
  Given popup が AI_PROVIDER_LABELS をローカル保持する状態
  When プロバイダラベルを参照する
  Then 単一ソース（例: aiProviderLabels.ts）から取得される

Scenario: プロバイダ追加時にラベルを一箇所だけ更新すればよい
  Given 新プロバイダが追加された状態
  When ラベルマップを更新する
  Then popup と background の両方で同じラベルが表示される
```

## 受け入れ基準
- [ ] `src/utils/aiProviderLabels.ts`（または同様の独立モジュール）に `PROVIDER_LABELS` を移動・export
- [ ] `background/aiClient.ts` が新モジュールから再エクスポート（既存 import 元の互換維持）
- [ ] `popup/errorUtils.ts` のローカル複製を削除し、新モジュールから import
- [ ] popup バンドルサイズが実質増加しないことを確認（AIClient の重い依存が巻き込まれないこと）
- [ ] 既存テストが全てパスする

## テスト戦略

### 単体テスト
- `aiProviderLabels.ts` のラベルマップ完全性（全プロバイダIDにラベルがある）

### 回帰テスト
- 既存 `popup/errorUtils.test.ts`, `aiClient` 関連テストがパスすることを確認

## 実装アプローチ
- `aiProviderLabels.ts` を新設（依存を持たない純粋な定数モジュール）→ `aiClient.ts` が再エクスポート → `popup/errorUtils.ts` の複製を置換

## 見積もり
1pt（定数モジュール作成 + 2ファイルの import 切り替え + テスト）

## 技術的考慮事項
- 新モジュールは `aiClient.ts` から分離し、AIClient の依存（`utils/fetch`, `storage`, `logger` 等）を巻き込まない純粋定数にする。これで popup バンドル軽量化の意図を保ちつつ単一ソース化できる
- `aiClient.ts` の `PROVIDER_LABELS` export を残す（外部 import 元の互換）か、依存を洗って移行を判断

## 関連
- コードレビューレポート: 本セッションの重複レビュー（PROVIDER_LABELS 複製）
- 対象ファイル: `src/background/aiClient.ts`, `src/popup/errorUtils.ts`, 新規 `src/utils/aiProviderLabels.ts`

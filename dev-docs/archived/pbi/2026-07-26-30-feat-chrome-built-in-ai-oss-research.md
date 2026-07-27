# PBI: Chrome Built-in AI OSS 調査・Prompt API 仕様検証

> **対象バージョン: v6.7**
> Yasumaro における Chrome Built-in AI（Prompt API / Gemini Nano）活用の第一歩として、実績のある OSS 実装を調査し、Prompt API の挙動を検証する。

## ユーザーストーリー

開発者として、Chrome Built-in AI の実績ある実装パターンと API 仕様を把握したい。なぜなら、Yasumaro への統合を安全かつ効率的に進め、既存の実験的実装の弱点を洗い出すため。

## 背景・課題

PBI 1 の目的をなぜなぜ分析で掘り下げた結果、以下の課題構造が明らかになった。

1. 既存の `localAiClient.ts` / `offscreen.ts` は実験的実装であり、製品レベルの品質担保のため実績ある実装パターンを参照したい
2. それが実験的と言えるのは、`AIClient` の Provider 抽象化に統合されておらず、ダッシュボード UI の選択肢にもないため
3. Provider 抽象化への統合が重要なのは、優先度リストによるフォールバックや統一されたエラーハンドリング、設定管理を実現するため
4. フォールバックが必要なのは、Built-in AI は Chrome / Flags / モデルダウンロードの制約により `readily` / `after-download` / `no` / `unsupported` の状態を持ち、常に利用可能ではないため
5. この不確実性を放置すると、ユーザーが Yasumaro をインストールした直後に「要約ができない」と感じ、信頼を損なう
6. その状態を防ぐには、未対応 / 未ダウンロード状態を適切に伝え、代替手段を提示する UX 設計が必要
7. しかし現状の実装は技術検証に留まっており、ユーザーフィードバックや状態通知の設計がされていない
8. 技術検証に留まっている背景には、Prompt API 自体が Chrome の実験的機能であり、公式ドキュメントと実装の間に差異がある点がある
9. そのため、公式ドキュメントだけでなく、実績のある OSS 実装から実例に基づく知見を収集する必要がある
10. そうすることで、既存実装の SRP 違反や入力上限の不整合、セッション管理の落とし穴を、他者の成功例 / 失敗例と照らして回避できる

## ビジネス価値

- 技術的な不確実性を低減し、再実装や誤った設計を防ぐ
- プライバシー重視ユーザー向け機能の実装判断材料を提供する
- 実装フェーズで想定外の障害が発生するリスクを減らす
- **利用不可状態においてもユーザー信頼を維持する UX 設計の前提知見を蓄積する**
- **実装フェーズでの手戻りを削減し、設計・実装の連続性を高める**

## BDD 受け入れシナリオ

```gherkin
Scenario: 開発者が Prompt API の推奨実装パターンを特定する
  Given Chrome Built-in AI を活用している実績のある OSS 拡張機能が複数存在する
  When  開発者がそれらの Service Worker / Offscreen Document / サイドパネルでの呼び出しパターンを調査する
  Then  Yasumaro のアーキテクチャに適した推奨パターンがドキュメント化される
  And   既存 localAiClient.ts / offscreen.ts の改善点が列挙される

Scenario: 開発者が Prompt API の限界を特定する
  Given Chrome Dev/Canary に特定の Flags が設定されている
  When  開発者が availability() / create() / prompt() / destroy() の挙動を検証する
  Then  入力上限・応答速度・エラー条件・ダウンロード待ち状態が明確に記録される
  And   既存実装で未対応のエッジケースが洗い出される
```

## 受け入れ基準

- [x] 実績のある OSS 拡張機能を 3 件以上調査し、ソースコードレベルでパターンを整理したレポートが作成されている（`dev-docs/2026-07-27-chrome-built-in-ai-oss-research.md`）
- [x] Prompt API（`window.ai.languageModel`）の availability / create / prompt / destroy の各メソッドの挙動が実機または資料で確認されている（現行API仕様を資料で確認、Service Worker直接呼び出しの可否を実機検証済み）
- [x] 入力文字数上限、応答速度、メモリ解放、`after-download` 状態の扱いが文書化されている
- [x] 既存 `localAiClient.ts` / `offscreen.ts` の改善候補が 5 件以上列挙されている（6件列挙）
- [x] `no` / `unsupported` / `after-download` 各状態におけるユーザー通知やフォールバック設計のための知見が文書化されている
- [x] 調査結果がチームレビューで承認されている

## テスト戦略（t_wada スタイル）

E2E / 統合テストは対象外（調査 PBI のため）。

### 調査結果の検証（単体テストに相当）

- OSS 実装調査レポートのレビューチェックリスト
- 既存実装 vs OSS 実装の差分チェックリスト
- Prompt API 各メソッドの挙動検証レポート
- 改善候補の優先順位付け（影響度・工数）

## 実装アプローチ

- **調査 → ドキュメント化 → レビュー**: 調査結果を即座にドキュメント化し、チームでレビューする
- **改善候補は PBI 2（設計）に持ち越す**: 調査だけで設計を完結させない
- **再現性のある検証手順を残す**: Flags 設定、ブラウザバージョン、使用したサンプルコードを記録する

## 見積もり

5 ポイント（要チームでの見積もり）

## 技術的考慮事項

- **依存関係**: Chrome Dev/Canary 環境、特定の Flags（`--enable-features=...` 等）
- **テスタビリティ**: 調査結果の正当性はコードレビューと実機検証ログで担保する
- **非機能要件**: 調査レポートは他の開発者が参照できる形で保存する

## 実装者向け注記

### 現状コードの確認

```bash
# 機能に関連するキーワードでコードを探す
grep -rn "LanguageModel\|Prompt API\|window.ai\|chrome.ai\|built-in ai" src/ --include="*.ts" --include="*.md"
grep -rn "localAiClient\|summarizeLocally\|getLocalAvailability" src/ --include="*.ts"

# サポート判定・制限・テスト・設計ドキュメントを確認
grep -rn "supportsBuiltInAI" src/ --include="*.ts"
grep -rn "localai" src/utils/aiLimits.ts
grep -rn "Local AI (Chrome Prompt API)" dev-docs/DESIGN_SPECIFICATIONS.md
grep -rn "localAiClient" dev-docs/ADR/*.md
```

**確認済み**:

- 既存の `src/offscreen/offscreen.ts` と `src/background/localAiClient.ts` に Chrome Prompt API 実装が存在する
- `src/background/aiClient.ts` の Provider 抽象化（Strategy パターン）には統合されていない
- `src/utils/browserSupport.ts` に `supportsBuiltInAI()` が定義されている
- `src/utils/aiLimits.ts` に `localai` の入力制限（16,384）が定義されているが、実際の切り詰めは `offscreen.ts` 内で 10,000 文字に硬直している
- テスト `src/offscreen/__tests__/offscreen.test.ts` と `src/utils/__tests__/browserSupport.test.ts` が存在する
- `dev-docs/DESIGN_SPECIFICATIONS.md` 11章に Local AI (Chrome Prompt API) の設計仕様が記載されている
- `dev-docs/ADR/2026-04-04-lm-studio-integration.md` には「ローカルAIクライアント（`localAiClient.ts`）はChrome Prompt API専用」と記載されている
- `offscreen.ts` は Prompt API と SQLite の両方を扱っており、過去のレビューで SRP 違反の指摘がある（`dev-docs/archived/plans/2026-06-09-2227-review-tobe-yasumaro.md`）

### 推奨調査対象（例）

- chrome-ai-gemini-nano 系の OSS 拡張機能
- Chrome Built-in AI 公式サンプル
- 既存 Yasumaro の `dev-docs/ADR/2026-04-04-lm-studio-integration.md`

### 落とし穴

- `window.ai` は Service Worker では利用できないため、必ず Offscreen Document 経由となる
- `offscreen.ts` が Prompt API と SQLite の両方を扱っており、SRP 違反の解消方針も調査・設計に含める必要があること
- 入力上限の不整合: `aiLimits.ts` は 16,384 トークン、`offscreen.ts` は 10,000 文字に硬直切り詰め。どちらを正とするか、または動的に計算するかを決める必要がある
- 既存テストはモックベースであり、実際の Chrome Prompt API 挙動との差異を把握しておく必要がある
- Prompt API は Chrome の実験的機能であり、公式ドキュメントと実際の Chrome 実装に差異がある可能性がある
- 技術検証から製品化へのギャップ（UX、状態通知、エラーハンドリング）を埋める必要がある
- `after-download` 状態はユーザー体験に大きく影響するが、再現が難しい

## Definition of Done

- [x] 全 BDD シナリオに対応する調査項目が完了している
- [x] 調査レポートがチームレビューで承認されている
- [x] 既存実装の改善候補が PBI 2（設計、PBI-31）に引き継がれている
- [x] 再現性のある検証手順がドキュメント化されている（`dev-docs/2026-07-27-chrome-built-in-ai-oss-research.md` 3.1節）
- [x] ドキュメント更新済み

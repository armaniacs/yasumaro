# 2026-10-14 holistic-code-improvement ラウンド バックログ台帳（holistic-1014）

## 出所

- holistic-code-improvement skill による大局的レビュー。
- 差分スコープ: `49ca0c62..HEAD`（2026-10-14 の CI リリースパイプライン + 動的 import 統一）。過去 5 ラウンド（holistic-1009 20件 / archloop-1010 13件 / checking-team-1010 10件 / review-followup 5+7件 / skipped-test-cleanup 4件）で src/ 全域をレビュー済みのため、未レビュー material に限定した。台帳送り F1-F24・L2-L8 の再検討トリガーは今回の変更（release.yml / build-crx3.mjs / check-docs.mjs / 動的 import 6 ファイル）で**未発火**を確認済み。
- 調査方法: 差分コミットの全ファイル実読（release.yml 277 行 / build-crx3.mjs 95 行 / pin テスト 112 行 / 動的 import diff）+ CWS v2 API ドキュメント（UploadState enum）確認 + GitHub Actions ラン実績確認（`gh run list/view`）+ 過去台帳の除外リスト照合。規模が狭く直接読了で完結したため graphify query は不使用。
- レビュー報告書: 本台帳「レビュー報告書サマリー」節に要約。
- NN01-NN04 に起票。本台帳は RICE 採点・順位根拠・依存・バッチ計画の SSOT。

## RICE 採点表（RICE 降順）

RICE = R × I × C / E。Reach はリリースパイプラインへの関与頻度（5=リリース毎・月次以上 / 2=署名方式変更時のみ）。Impact 3=実害解消 / 2=大きい / 1=中 / 0.5=小。Confidence 1.0=コード・実測で確定 / 0.8=設計判断が残る。Effort は 0.25（1 行・移設）/ 0.5（10 行前後）。

| 順 | NN | PBI | 種別 | R | I | C | E | RICE |
|---|---|---|---|---|---|---|---|---:|
| 1 | 01 | [2026-10-14-01-fix-release-job-timeout-budget.md](2026-10-14-01-fix-release-job-timeout-budget.md) | fix | 5 | 1.5 | 0.8 | 0.25 | 24.0 |
| 2 | 02 | [2026-10-14-02-fix-cws-publish-http-code-check.md](2026-10-14-02-fix-cws-publish-http-code-check.md) | fix | 5 | 2 | 1.0 | 0.5 | 20.0 |
| 3 | 03 | [2026-10-14-03-fix-edge-bundle-size-check.md](2026-10-14-03-fix-edge-bundle-size-check.md) | fix | 5 | 0.5 | 1.0 | 0.25 | 10.0 |
| 4 | 04 | [2026-10-14-04-refactor-build-crx3-script-relocation.md](2026-10-14-04-refactor-build-crx3-script-relocation.md) | refactor | 2 | 0.5 | 1.0 | 0.25 | 4.0 |

## 同点の順位根拠（tie-break）

同点なし。

## 純 RICE 順からの逸脱

なし。

## 依存マップ（実行順の制約）

- 4 候補すべてが `.github/workflows/release.yml` を触る → **全員直列実行**（同一ファイル群の順序依存）。
- NN04 は release.yml に加え `scripts/build-crx3.mjs`（新規）と `scripts/__tests__/build-crx3.test.ts` を触るが、他候補との重複は release.yml のみ。

## バッチ計画（W1・直列・同一ディレクトリ戦略）

| Wave | NN | 内容 |
|---|---|---|
| W1 | 01 → 02 → 03 → 04 | 同一ファイル（release.yml）の順序依存により全員直列。統合側が逐次実装 |

**逐次化の根拠**: 候補は 4 件だが全員が同一ファイルを触るため並列化の余地がなく、サブエージェント逐次起動は 1 行単位の変更に対して過剰。統合側が逐次実装する（逐次化は速度だけの差で、ファイル排他・バッチ境界の全体検証・PBI 毎コミットは維持）。

**共通ファイル（統合側がバッチ境界で 1 回だけ編集）**: `pbi/00-INDEX.md`、本台帳。

## 実行結果（2026-10-14 ラウンド）

W1（01 → 02 → 03 → 04）を統合側が逐次実装（全員 release.yml のため直列・hunk 分離コミットで PBI 毎に分割）。実装コミットは `31b2c15`（01）/ `0c864cc`（02）/ `cb1bc53`（03）/ `4c48b33`（04）。全 4 件最終ゲート `npm run validate` exit 0（1063 files / 16036 tests passed）+ `npm run build` PASS でアーカイブ。

- **NN01** ― `timeout-minutes: 15` → `90` + 予算根拠コメント（`release.yml:14-18`）。YAML パース検証。
- **NN02** ― publish ブロックを Edge 同型の `-w '%{http_code}'` パターンに統一。モック curl で 5 シナリオ（transport fail / 400 / 200+error / 200 ok / 200 非 JSON）を実証し、false success 経路の閉鎖を確認。
- **NN03** ― Edge ビルド直後に `check-bundle-size -- edge-mv3` を追加。
- **NN04** ― `git mv` で scripts/build-crx3.mjs に移設。pin テスト 4/4 green、release.yml と pin テスト（SCRIPT 定数 + doc コメント）の参照パス更新。

PBI ファイルは `dev-docs/archived/pbi/` へ移動済み（下表のリンクもアーカイブ先）。ユーザー作業（CWS publish 拒否の Dashboard 対応）は 2026-10-14 にユーザー実施済みで完了。

## 台帳送り（見送り・トリガー管理）

| # | テーマ | 再検討トリガー |
|---|---|---|
| なし | CWS/Edge ポーリングロジックの共通化 | 却下（台帳送りでなく設計判断）: 各ストア API のセマンティクスが独立しており「同じ理由で同時に変わる」関係でないため、過度な共通化に該当する |

- 既存台帳送り（holistic-1009 F1-F24 のうち F1/F14/F17/F19 消費済み + L2-L8 + backlog-future 統合台帳）はトリガー未発火のため維持。今回の変更でトリガーが発火した項目なし。

## ユーザー作業（自動化外の残項目）

- **CWS publish 拒否（v6.9.43、run 38525033887）**: ✅ 完了（2026-10-14 ユーザー報告）。store 側要件事項による拒否でコード欠陥ではない。"Your submission does not meet the requirements to be published in the store. Check the Developer Dashboard for steps to resolve." ― Developer Dashboard での対応で解決。本ラウンドの PBI 化対象外（外部サービス操作）。

## DoD 反映漏れ

- 本ラウンド開始時の棚卸し: `pbi/` 直下の未完了 4 件（2026-09-22-01/02/03、2026-09-05-32）はトリガー待ち 3 件 + ADR-014 ゲート付き 1 件で、未チェックボックスは未着手が正当。実装コミットとの不一致なし。**0 件**。

## レビュー報告書サマリー（4 観点）

- **強み**: CRX3 署名は依存ゼロの最小 protobuf エンコーダで、NUL 終端の理由が doc コメントに記録され、pin テストが正例・負例の両方を pin（`scripts/__tests__/build-crx3.test.ts:92-98`）。秘密鍵は mktemp + trap、派生トークンは add-mask、workflow コンテキスト値は env 経由（CI_SECURITY_CHECKLIST 準拠）、自動 publish はリポジトリ変数ゲート付き。ストア 3 ステップは `always()` + `hashFiles` ガードで相互独立、GitHub Release はストア処理前に作成。動的 import 統一（ba6793fc）は 6 ファイル最小差分。
- **主な構造的課題**: (1) CWS publish のエラー検出が JSON フィールドのみに依存し、pipefail なしのシェルで curl 通信失敗を「publish 成功」として通す経路が存在（Edge ステップは HTTP コード検出で解決済み ― 同一ファイル内で解決パターンが不均一） (2) ジョブタイムアウト 15 分がポーリング最悪ケース（CWS 26.5 分 + Edge 46 分）を下回り、always() 独立設計がタイムアウトで崩れる (3) CRX3 署名ロジックが workflow ディレクトリに置かれ、pin テストが逆方向に横断 (4) Edge ビルドのバンドルサイズチェック欠落。

## 5 Whys サマリー（主要テーマ）

- 「なぜ CWS publish だけ JSON フィールド検査なのか」→ CWS ステップが upload・publish・poll を 1 つの run ブロックに書いた際、エラー検出を応答本文の JSON に寄せ、Edge ステップで後から確立した HTTP コード検出パターンへの揃え替えが行われなかったから。解: NN02
- 「なぜタイムアウト 15 分のままなのか」→ release.yml は従来の「ビルド + GitHub Release」時代の 15 分から、ストア 3 ステップ（ポーリング設計）追加後に引き上げられていないから。解: NN01
- 「なぜ CRX3 スクリプトが workflow ディレクトリに生まれたのか」→ release.yml の署名ステップと同時に作られた際、呼び出し元のディレクトリに置かれ、scripts/ の canonical 慣習が適用されなかったから。解: NN04

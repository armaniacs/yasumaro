# PBI: CWS publish ステップの HTTP コード検証追加（通信失敗の false success 閉鎖）

## ユーザーストーリー
保守担当の開発者として、CWS publish の curl 通信失敗を「publish 成功」として扱われないようにしたい、なぜなら GitHub Actions のデフォルトシェル（`bash -e`、pipefail なし）ではパイプライン内の curl 失敗が拾えず、実際には publish されていないのに CI が green になるから。

## 優先度
- 順位: 02 / 4
- RICEスコア: 20.0（Reach=5 / Impact=2 / Confidence=1.0 / Effort=0.5）
- 根拠: publish は実際にユーザーへ配布される操作で、誤検出の害が最大。Edge ステップに同型の解決パターンが実在するため C=1.0。
- 出所: holistic-code-review（2026-10-14、差分スコープ 49ca0c62..HEAD）テーマ1

## 背景（2026-10-14 時点の現状）
- `.github/workflows/release.yml:144-153` は `PUBLISH_ERROR=$(curl ... | jq -r '.error.message // empty')` で JSON の error フィールドのみを検査している。
- デフォルトシェルは `bash -e` で pipefail なし → curl のネットワーク失敗・`--max-time 60` タイムアウト（exit 28・7 等）でも jq は空入力で exit 0 → `PUBLISH_ERROR` が空 → "Publish submitted" の false success。
- 実績: v6.9.43 の run 38525033887 は store 側要件事項による publish 拒否（error 付き JSON）を正しく検出。v6.9.42 の run 38489656231 は upload エンドポイントが非 JSON 応答を返した（通信経路の異常は現実に発生。fix コミット 6172275b で upload 側のエラー出力を追加済み）。
- 同一ファイル内に解決パターンが実在: Edge ステップは `-D "${HEADERS_FILE}" -o /dev/null -w '%{http_code}'` + HTTP コード明示検査（:194-203 upload、:213-222 publish）。
- CWS v2 publish の成功応答は error.message を含まない（拒否応答は error オブジェクト付き。実行時観測済み）。

## BDDシナリオ
Scenario: 通信失敗は失敗として検出される
  Given publish curl がタイムアウトまたはネットワーク失敗する
  When ステップが終了する
  Then exit 1 で失敗し、"Publish submitted" を出力しない

Scenario: 拒否応答は従来どおり検出される
  Given publish が error 付き JSON を返す（store 側要件事項違反等）
  When ステップが終了する
  Then exit 1 で失敗し、error 内容のみが出力される

Scenario: 成功応答は従来どおり成功する
  Given publish が 200 を返し error を含まない
  When ステップが終了する
  Then "Publish submitted" が出力される

## 受け入れ基準
- [x] publish curl が `-o <mktemp 一時ファイル> -w '%{http_code}'` で HTTP コードを検出し、200 以外で exit 1 する
- [x] HTTP != 200 時の出力はエラーフィールドのみ（upload ステップの 6172275b と同じ方針）で、curl 通信失敗時も "Publish submitted" を出力しない
- [x] HTTP 200 でも body に error.message があれば exit 1 する（重複ガード。拒否応答の HTTP コードが観測できない場合にも備える）
- [x] 一時ファイルは trap で後始末される
- [x] 実装は Edge ステップと同型のパターンに揃える
- [x] release.yml の YAML 構文が有効である

## テスト戦略
- ワークフローの run ブロックは単体テスト対象外のため、検証は YAML 構文パースと run ブロック抽出によるローカル実行（curl をモックした bash 実行）または目視確認で行う
- 統合: 実際の検証は次回タグ push の実行で行う

## 見積もり
0.5 SP

## 実行結果（2026-10-14）
- publish ブロックを `-w '%{http_code}'` + mktemp body ファイル + HTTP コード検証 + 200-with-error ガード + trap に統一（コミット `0c864cc`）。
- モック curl による 5 シナリオ実行で実証: transport fail → exit 28（set -e で中断）/ HTTP 400 → exit 1 + error フィールドのみ出力 / 200+error.message → exit 1 / 200 成功応答 → "Publish submitted" / 200 非 JSON → exit 5。**通信失敗の false success 経路が閉じたことを実証**。
- YAML 構文は js-yaml パースで検証。最終ゲート `npm run validate` exit 0（1063 files / 16036 tests passed）+ `npm run build` PASS。

## Definition of Done
- [x] 受け入れ基準がすべて満たされている
- [x] lint / type-check が通る（リポジトリ全体が green のこと）
- [x] コードレビュー完了

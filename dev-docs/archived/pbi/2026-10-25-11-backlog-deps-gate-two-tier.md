# 依存ゲート二層化と監査の早期検知（2026-10-25）

## 経緯

2026-10-25 の依存更新（minor / patch 16 件 + happy-dom 21）で `release:check:deps` が HIGH 4 件で失敗した。内訳は node-forge の RSA 署名検証バイパス（GHSA-86w9-cpqp-85rv、CVSS 7.5）で、チェーン node-forge@1.4.0 ← @devicefarmer/adbkit@3.3.9 ← web-ext@10.8.0 ← wxt@0.21.4 は更新前後で同一であり、自力では解消不能と確定した。出荷物への混入はなく、本番依存の監査は 0 件である。到達不能メモと受容記録は [docs/DEPENDINGS.md](../docs/DEPENDINGS.md) 第 6 章に記載した。

残る問題はゲート設計にある。CI の監査（`--omit=dev`）は緑、`release:check:deps`（dev 込み）は赤、`npm run validate` には audit が含まれず開発者が脆弱性を認知する接点がない。到達可能性を区別しない二値合否が、実害のない dev 脆弱性を出荷停止に変換している。本 PBI は判定を二層化し、早期検知を日常ゲートに組み込む。

## 採点（RICE）

| 候補 | Reach | Impact | Confidence | Effort(SP) | RICE | 種別 |
|---|---|---:|---:|---:|---:|---|
| 11 依存ゲート二層化＋validate監査(warn) | 3 | 2 | 0.8 | 1 | **4.8** | fix |

- Reach 3: CI・リリースゲート・開発者の日常ゲートの 3 接点が対象
- Impact 2: 次回以降の同種ブロッカーを warn＋メモに落とし、根拠のない出荷停止を防ぐ
- 依存関係: なし（単独で実施可）。前提文書は DEPENDINGS.md 第 6 章の受容記録

## PBI 11: 依存ゲート二層化＋validate監査(warn)

### 受入基準

- [ ] `release:check:deps` が二層判定になる。本番混入（prod 依存経由）＝ fail、dev-only ＝ warn＋到達可能性メモの存在要求
- [ ] CI の監査スコープと release のスコープ定義が単一文書（DEPENDINGS.md）に統一される
- [ ] `npm run validate` に audit（warn レベル）が追加され、開発者が日常的に認知できる
- [ ] 追加後も `npm run validate` とフルテストが緑であること
- [ ] node-forge 受容記録の期限（wxt / web-ext 更新時再評価）が切れていないことの確認手順が文書化される

### タスク分解

1. check-deps.mjs の判定分岐（prod 経路／dev-only 経路の到達可能性分類）
2. warn 時の要求メモ形式（DEPENDINGS.md 第 6 章の受容書式へのリンク）
3. validate への audit warn 追加（失敗させないこと）
4. CI / release スコープ定義の DEPENDINGS.md 集約
5. 再評価トリガー（wxt / web-ext 更新時の受容記録見直し）の手順化

## 実装記録（2026-10-25、6.9.60）

- `scripts/release-checks/check-deps.mjs`: フル監査と `--omit=dev` 監査を並列取得し、`classifyAuditFindings`（純粋関数・export）で二層判定。prod 混入=fail、dev-only+メモ=warn、dev-only無メモ=fail、到達不能=scan-error。CLI ガード（`import.meta.url` 比較）を追加して vitest からの import で main が走らないようにした
- `--audit-warn` モード: 監査のみ実行し全て warn 化・常時 exit 0。`check:deps:audit-warn` として `validate` に組込
- 単体テスト 10 件（`scripts/__tests__/check-deps-tiers.test.ts`）: clean / prod-fail / dev-warn / dev-uncovered / scan-error / メモ欠落 / id 無し項目の包名照合
- 実データ検証: `release:check:deps` が node-forge 系 HIGH 4 件を warn として PASS（exit 0）。変更前は同条件で失敗していた
- DEPENDINGS.md: §3 に二層定義＋validate 行を追加、§4 を 4 層化、§5 の判定を 6.9.60 時点に更新、§6.2 に識別子必須の旨を明記
- 最終ゲート: 下記 C 作業と合わせて `npm run validate` で確認する

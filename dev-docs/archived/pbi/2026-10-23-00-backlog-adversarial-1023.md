# adversarial-code-review 診断バックログ（2026-10-23）

> `/adversarial-code-review` による round2 差分（`a1d8bfcb..HEAD` の src/ 44ファイル）の診断結果台帳。4チャンク × ハッカー/保守の8体で発見し、チャンクごとの独立した反証4体で裏取りした。反証を通過した 13 件を 11 PBI に統合した（同一ガード関数の本体・テスト・呼出し側既定は 1 PBI に束ねた）。コード変更は一切行っていない。

## RICE スコア表（全 11 PBI）

RICE = Reach（影響する利用箇所・経路数）× Impact（3=実害解消 / 2=大 / 1=中 / 0.5=小）× Confidence（1.0=確定 / 0.8=判断残り）÷ Effort（人日）

| 順位 | PBI | テーマ | Reach | Impact | Conf | Effort | RICE |
|---|---|---|---|---|---|---|---|
| 01 | [2026-10-23-01](2026-10-23-01-fix-proposal-undo-disabled.md) | 取消ボタン永久disabled | 4 | 3 | 1.0 | 0.5 | 24 |
| 02 | [2026-10-23-02](2026-10-23-02-test-domain-proposal-row-pin.md) | ドメイン複数行テスト強化 | 2 | 2 | 1.0 | 0.3 | 13.3 |
| 03 | [2026-10-23-03](2026-10-23-03-fix-gateway-response-validation.md) | 応答形状検証と失敗文既定化 | 5 | 2 | 1.0 | 1.0 | 10 |
| 04 | [2026-10-23-04](2026-10-23-04-test-tag-proposal-row-pin.md) | タグ複数行テスト追加 | 2 | 1 | 1.0 | 0.3 | 6.7 |
| 05 | [2026-10-23-05](2026-10-23-05-fix-report-malformed-timeout-text.md) | 不正形とタイムアウト文言分離 | 3 | 1 | 1.0 | 0.5 | 6 |
| 06 | [2026-10-23-06](2026-10-23-06-fix-saved-collections-proto.md) | 削除の prototype 退行修正 | 2 | 1 | 0.8 | 0.3 | 5.3 |
| 07 | [2026-10-23-07](2026-10-23-07-test-blacklist-expectation-contract.md) | 期待値の契約統一 | 2 | 1 | 1.0 | 0.4 | 5 |
| 08 | [2026-10-23-08](2026-10-23-08-fix-response-discriminated-union.md) | 応答型の判別 union 化 | 4 | 2 | 0.8 | 1.5 | 4.3 |
| 09 | [2026-10-23-09](2026-10-23-09-fix-slot-failures-validation.md) | slotFailures 検証対称化 | 2 | 1 | 1.0 | 0.5 | 4 |
| 10 | [2026-10-23-10](2026-10-23-10-fix-dead-gateway-catch.md) | 到達不能 catch の整理 | 2 | 0.5 | 1.0 | 0.3 | 3.3 |
| 11 | [2026-10-23-11](2026-10-23-11-test-repository-default-path.md) | 既定経路の実物検証 | 2 | 1 | 0.8 | 0.75 | 2.1 |

## 依存グラフと実施順の推奨

- **RICE 順が既定**。
- **NN03 → NN05・NN04**: 同 gateway 群の文言・型に触れるため NN03 を先に。
- **NN07 → NN11**: 同テストファイルに触れるため NN07（契約統一）を先に。
- **並列可**: NN01 / NN02 / NN04 / NN06 / NN09 / NN10 は互いに独立（触れるファイルが重ならない）。

## 反証で却下したもの（PBI 化しない）

- XSS 疑惑（引用 href・data-entry-id）：配線追跡で再現根拠なし（URL は記録入口で http/https に限定、id は INTEGER PK）
- aggregate 7 件（unknown 化・定数削除・inline 化・onboarding 黙殺・範囲ガード）：差分未接触の旧コードか、到達経路なし
- storage 13 件（CAS・バリデーション・normalize 喪失・to 未 trim など）：旧コード由来か、因果不成立
- panel 5 件（規約混在・rethrow・formatUndoError・silent drop）：現状正しいか、到達可能な throw なし
- messaging 6 件（型推論・定数追従・in Narrow・非 string error・needsForce・throw 吸収）：機序の誤認か、生産者なし

## 次のアクションの案内

- 実装するなら arch-delivery-loop（RICE 順で自律実装〜検証〜版上げ）。NN03 → NN05・NN04、NN07 → NN11 の前後関係だけ守る。
- 個別に手動実装なら各 PBI ファイルを開く。

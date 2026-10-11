# 2026-10-11 usability E2E 失敗の PBI 化台帳（usability-followup）

NN08 中継化後の headed E2E（2026-10-11 ユーザー実行）で残った usability 3 件の
失敗を切り分けて PBI 化する。いずれも NN08 差分（content probe・fixture・spec・
wxt・release.yml）と無関係であることを実コードで確認済み（dashboard/export/i18n
未接触）。ファイル番号は同日番号（01–15）との衝突回避のため NN16–17 を使用する。
NN 昇順＝優先降順。

## RICE スコアリング

```
RICE = (Reach × Impact × Confidence) / Effort
Reach: 保守作業での関与頻度（相対 1-10）
Impact: 3=圧倒的 / 2=大きい / 1=中 / 0.5=小 / 0.25=極小
Confidence: 1.0=コードで確定 / 0.8=設計判断が残る / 0.5=効果が不確か
Effort: ストーリーポイント
```

| 優先順位 | NN | PBI | 種別 | R | I | C | E | RICE | SP |
|---|---|---|---|---:|---:|---:|---:|---:|---:|
| 1 | 16 | [2026-10-11-16-test-markdown-export-locale-assertion.md](2026-10-11-16-test-markdown-export-locale-assertion.md) | test | 3 | 1 | 0.8 | 1.0 | 2.4 | 1.0 |
| 2 | 17 | [2026-10-11-17-investigate-friction-export-hang.md](2026-10-11-17-investigate-friction-export-hang.md) | investigate | 2 | 1 | 0.5 | 1.5 | 0.7 | 1.5 |

根拠（相対比較）:

- **NN16（2.4）**: 日本語 UI 環境で決定的に red（`/completed/i` に対象文言なし）。
  アプリ側は正しくローカライズされており spec 側の問題と見込む（C 0.8）。
  修正は spec/fixture 内に閉じる見込み（E 1.0）。
- **NN17（0.7）**: fixture setup timeout＋9.1分のハング。負荷時 flake の可能性が
  高く、まず単独再実行で分類する必要がある（C 0.5）。真のハングなら E2E 全体を
  止めるが、現時点では単発観測（I 1 止まり、E 1.5）。

## 依存・実行順

- 依存関係はない。RICE 順（NN16 → NN17）を推奨する。
- いずれも headed 検証が必要なため、実装は headed 環境で直列に行う。

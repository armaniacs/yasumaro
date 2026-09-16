# PBI: hashUrl を crypto から移し、暗号モジュールの責務を絞る

## ステータス: ⬜ 未着手（着手前に配置先の判断が必要）

## ユーザーストーリー

メンテナとして、`crypto/` には暗号操作だけが置かれていてほしい。なぜなら現在 `hashUrl` が混ざっており、これはログ出力時の URL マスキング専用で、暗号プリミティブとしての用途を持たないから。

## 優先度

- 順位: 未定
- 根拠: [[2026-09-16-04-refactor-hmac-signer]] から分離した残項目。locality の改善であり、動作への影響はない。ただし層構造に触れる可能性があるため判断を要する

## 現状

`src/utils/crypto/primitives.ts` にある。

```ts
export async function hashUrl(url: string): Promise<string> {
    // SHA-256 の先頭16文字を [hash:xxxx] 形式で返す
}
```

呼び出しは **16箇所**。`headerDetector.ts`（7箇所）と `statusChecker.ts` ほかで、いずれも `logDebug` などとセットで使われている。

## 移動に賛成できる材料

- 用途がログ出力時の URL マスキングに限られる（16箇所すべて）
- 戻り値が `[hash:xxxx]` という**ログ向けの整形済み文字列**で、汎用の暗号関数とは言い難い
- `crypto/` の責務が「暗号操作のみ」に絞られる

## 慎重であるべき材料

**これが着手前に判断すべき点。**

`logger/` に移すと **logger → crypto の依存**が生まれる。現在 logger は依存の浅い層にあり、crypto に依存させると層構造が変わる可能性がある。循環参照が生じないかの確認も要る。

考えられる配置先:

| 案 | 内容 | 懸念 |
|---|---|---|
| A | `logger/` 配下に置く | logger → crypto の依存が生まれる |
| B | `utils/privacy/` など独立モジュール | 新しい置き場所が増える |
| C | 移動しない | crypto に非暗号の関数が残り続ける |

## 受け入れ基準

- [ ] `crypto/primitives.ts` から `hashUrl` が消えている
- [ ] 移動先が層構造を乱していない（循環参照なし・依存の向きが妥当）
- [ ] 16箇所の呼び出しがすべて新しい場所を参照している
- [ ] 全テスト green

## 備考

`crypto/index.ts` が `hashUrl` を re-export しているため、互換性のために当面 re-export を残すかも判断が要る。残す場合は「いつ消すか」の条件を決めること。

関連: [[2026-09-16-04-refactor-hmac-signer]]（HMAC 統合・完了済み）

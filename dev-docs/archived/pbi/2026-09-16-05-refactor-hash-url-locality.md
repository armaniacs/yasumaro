# PBI: hashUrl を crypto から移し、暗号モジュールの責務を絞る

## ステータス: ✅ 完了（2026-09-17）

`src/utils/urlHash.ts` として `utils/` 直下へ移した。

### 着手前の懸念は実測で否定された

本 PBI は「logger に移すと logger → crypto の依存が生まれ層構造が変わる」ことを着手条件としていたが、前提が成り立たなかった。

1. **crypto は logger を import していない** — 逆方向の依存がなく循環参照は起きない
2. **logger は既に外部モジュールに依存している** — `../piiSanitizer.js` / `../objectUtils.js` / `../storage/storageTransaction.js`。「logger は依存の浅い層」という前提が誤りだった
3. **先例がある** — `piiSanitizer.ts` はプライバシー保護目的のマスキングで `utils/` 直下に置かれ、logger がそれを import している

そのうえで案B（`utils/` 直下の独立モジュール）を採った。依存の向きは問題ないと判明したが、`hashUrl` は logger 以外からも使いうる性質なので、logger に内包するより独立している方が素直と判断した。

### 決めたこと

| 論点 | 決定 | 理由 |
|---|---|---|
| 配置先 | `utils/urlHash.ts` | `piiSanitizer.ts` の先例に沿う |
| `getWebCrypto()` | import して使い続ける | 挙動を変えない。フォールバックの要否検証を本 PR の範囲に含めない |
| `crypto/index.ts` の re-export | 削除 | 移行漏れが型エラーで検出できる |
| `[hash:xxxx]` 整形 | 現状維持 | 剥がすと13箇所すべての出力が変わり過去ログと突合できなくなる |

### 記述の誤りを訂正

「呼び出しは16箇所」としていたが、実装は **3ファイル13箇所**（`headerDetector` 7 / `pendingStorage` 3 / `statusChecker` 3）。残りはテストからの参照だった。全13箇所がログ出力専用であることは追跡して確認済み。

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

- [x] `crypto/primitives.ts` から `hashUrl` が消えている
- [x] 移動先が層構造を乱していない（`urlHash` → `crypto/primitives` の一方向。`primitives` は型と定数しか import しないため循環なし）
- [x] 呼び出しがすべて新しい場所を参照している（実装3 + テスト9 の計12ファイル）
- [x] 全テスト green

## 備考

re-export は削除した。本リポジトリ内の全呼び出し箇所を把握済みで、拡張機能なので外部利用者がいないため。移行漏れがあれば型エラーで落ちる。

関連: [[2026-09-16-04-refactor-hmac-signer]]（HMAC 統合・完了済み）

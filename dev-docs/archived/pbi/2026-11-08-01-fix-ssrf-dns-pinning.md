# PBI:SSRFガードのDNSピン留めとlocalhost既定拒否
## ユーザーストーリー
拡張機能利用者として、フィルタ取込やAIプロバイダ設定で指定したURLがDNS切替えで内部アドレスへ転送されないようにしたい、なぜなら拡張機能起点のfetchがloopbackや内部網へ到達すると情報漏洩や内部サービス操作に悪用されるから。
## 優先度
順位01/17。RICE240(Reach=200/Impact=3/Confidence=80%/Effort=2人日)。根拠:セキュリティ最高リスク。反証済み3件中唯一のSURVIVES(攻撃者視点)。
対象の指摘(検証済み):
- (1)src/utils/ssrfGuard.ts:249-269はホスト名文字列しか見ずDNS解決をピン留めしない。検証とfetchで別々に名前解決するため攻撃者支配ドメインで検査時と接続時のIPを変えられloopbackへ接続する。
- (2)src/utils/fetch.ts:144のblockLocalhost既定falseのため既定経路ではリテラル127.0.0.1すら素通しする。src/utils/ssrfGuard.ts:11はhttpも許容する。
## BDD受け入れシナリオ
- シナリオ1:ハッピーパス(通常公開ホスト)
- Given:公開済みhttpsホストのURLが設定済みである
- When:拡張機能起点でfetchを実行する
- Then:従来通り成功する
- シナリオ2:エラー系(DNS切替えでloopbackへ変化)
- Given:検証時は公開IPを返す攻撃者支配ドメインが指定済みである
- When:接続直前にDNS応答がloopbackへ変わる
- Then:接続前に拒否される
- シナリオ3:境界値(既定でlocalhost指定)
- Given:localhostを示すURLが指定済みである
- When:既定設定のままfetchを実行する
- Then:拒否される
- シナリオ4:エラー系(httpの内部ホスト)
- Given:httpの内部ホストURLが指定済みである
- When:fetchを実行する
- Then:拒否される
## 受け入れ基準
- 検証と接続で同一解決IPを使う(pin留め)か接続後IPを再検証する
- blockLocalhost既定を見直し既定経路でlocalhostを拒否する
- 回帰テストを追加する
## テスト戦略
- 単体(DNS切替え模擬・境界IP表)
- 統合(fetch経路)
## 見積もり
M。
## Definition of Done
- 全BDD自動テスト化・レビュー・docs更新(必要なら)
- 出典:adversarial-code-review/2026-11-08(検証:全171件中74件却下、本件はSURVIVES)

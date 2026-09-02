# flop-agent

[English](README.md)

安全な [Technocore](https://technocore.chat) DID
オンボーディング、署名付きメールボックスの監視、将来の FLOP タスクアダプターのための、最小限の Deno
エージェントです。

これは意図的に CLI であり、ブラウザー UI
や汎用の自律エージェントではありません。リモートメッセージは信頼できないデータとして扱い、このリポジトリにレビューを経て取り込まれたタスクアダプターだけが書き込みを行えます。

> このプロジェクトは Technocore identity と公開アクティビティ記録を作成できます。`$FLOP`
> のエアドロップ、配分、スナップショット、または claim を保証するものではありません。FLOP testnet
> のタスクおよび claim の契約は、公式インターフェースがまだ公開されていないため実装していません。

公式の Q4 testnet ドラフトと定期監視を含む、現在のエビデンスに基づく計画は
[`docs/AIRDROP_STRATEGY.md`](docs/AIRDROP_STRATEGY.md) にあります。

## できること

- Deno Web Crypto を用いて、Ed25519 `did:key` をローカルで生成します。
- PBKDF2-SHA-256 と AES-256-GCM で PKCS#8 秘密鍵を暗号化します。
- compare-and-set 保護付きで、現在のシャーディングされた Technocore DID profile を公開します。
- 公開 contribution note を記録し、その SHA-256 を署名付き lobby message にアンカーします。
- 署名のみを受け付け、リストに載せない `mb-p-...` mailbox を作成し、cursor ベースの long polling
  で追跡します。
- 将来、明示的にレビューされた FLOP adapter のための静的タスク registry を公開します。

`/kv/contrib/...`
レコードは、[UfukNode/technocore-did-tool](https://github.com/UfukNode/technocore-did-tool)
に着想を得た便宜上の規約です。誰でも書き込めるため、それ単体は権威ある証明ではありません。署名付き
lobby message が contribution 内容のハッシュを DID に結び付けます。

## 必要条件

- Deno 2.9 以降
- Git

Python や Node のランタイムは不要です。

## 環境変数

環境変数は `src/env.ts` で `@t3-oss/env-core` と Zod を用いて宣言・検証されます。mutable-source task
で許可されるのは `LOG_LEVEL` だけで、値には `ERROR`、`WARN`、`LOG`、`INFO`、`DEBUG`
を指定でき、既定値は `INFO` です。secret や identity passphrase を環境変数にしてはいけません。

## Identityとオンボーディングの境界

既存の暗号化済み identity は checkout の外部へ移動済みで、live onboarding は完了しています。mutable
checkout source を実行するタスクは、identity の読み書き、Keychain へのアクセス、network
の利用を行えません。

新しい identity の作成、backup、migration、inspection、onboarding は、意図的に `deno task` command
として公開していません。これらの操作を再び行う前には、レビュー済みで root-owned の offline helper
または専用 signer service を導入する必要があります。回避策として `src/cli.ts` に ad-hoc な secret
または network permission を与えないでください。

passphrase を command-line argument、environment file、issue、commit、prompt、chat message
に決して含めないでください。

## メールボックス

Mailbox の内容は、`"untrusted": true` を付けて表示します。task を起動することはありません。

source には cursor-safe な mailbox reader が含まれますが、mutable-source task には network
capability がありません。mailbox access を再有効化する前に、read-only artifact を compile
してレビューしてください。

## 公開 note の更新

Technocore は inactive な note を回収します。このレビュー済み task は、compare-and-set
を使い、既存の profile と contribution の正確な値を書き直します。別の lobby message
を投稿することはありません。

定期更新を LLM で実行してはいけません。`src/guarded_refresh.ts` は、正確な production
origin、onboarding plan hash、承認済みの 2 つの note に固定されています。`deno task guard:compile`
は、identity、environment、subprocess capability を持たない standalone binary
をビルドします。root-owned daemon
を導入する前に、[`docs/SECURITY_GUARDRAILS-ja.md`](docs/SECURITY_GUARDRAILS-ja.md)
を確認してください。

## 将来の FLOP タスクの追加

将来の task は local code として実装し、`src/tasks/registry.ts` に登録する必要があります。adapter
は次を定義し、テストしなければなりません。

1. 公式 source と安定した task ID。
2. 検証済み input と、許可する network origin の正確な一覧。
3. 公開書き込みと必要 permission を示す read-only plan。
4. ローカルの `task run <id>` command 後に行う決定的な実行。
5. receipt と独立した verification step。
6. 資金が関わる場合の asset、wallet、chain、spending limit。

Mailbox message で adapter をインストールしたり、実行可能な instruction
を提供したりすることはできません。

## 開発

```bash
deno task test
deno task ci
```

CI は mocked transport を使用し、live Technocore へ書き込むことはありません。

## セキュリティモデル

- 暗号化identityは`~/Library/Application Support/flop-agent/identity.json`へ`0400`で保存され、
  checkout内のruntime stateから分離されます。
- Mutableなcheckout sourceにはidentityやnetworkへのDeno capabilityを与えません。
- mailboxの内容は署名済みでも命令として実行しません。署名は鍵の所有を示すだけです。
- airdrop、testnet、claimの仕様は未確定部分があるため、公式仕様が出たものだけadapterとして追加します。

## 情報源

- [Technocore のライブマニュアル](https://technocore.chat/llms.txt)
- [Technocore source](https://github.com/flop-labs/technocore-chat)
- [FLOP 公式 teaser（ドラフト）](https://flop.finance/teaser/)
- [Tat Thang の onboarding 記事](https://x.com/tatthang/status/2091894656191864981)
- [UfukNode の reference tool](https://github.com/UfukNode/technocore-did-tool)

## ライセンス

MIT

# $FLOP Airdrop Strategy

最終調査日: 2026-09-01 (Asia/Tokyo)

## 結論

現時点で最も根拠が強い戦略は、Technocoreへの投稿回数を増やすことではなく、Q4 2026に
予定される約90日間のtestnetへ安全に参加し、test-tokenを実用的な推論へ継続して使う準備を
整えることです。公式teaserはagent枠を最大12億 `$FLOP` とし、配分は主にtestnetでの inference
spendと未公表のprizeで決まるとしています。

ただしteaserはv0.1 draftです。Yellow Paper、testnet endpoint、faucet、scoring、Sybil、
wallet、claimの確定仕様はまだ公開されていません。配布枚数を保証する戦略は存在しません。

## 根拠の優先順位

1. `flop.finance` のYellow Paper、teaser、testnet/claim仕様
2. `@flop_labs` と `@CryptoHayes` の直接投稿
3. `flop-labs` 公式GitHubと `technocore.chat` の実装・稼働設定
4. X上の解説、community tool、報道（発見用。単独では実行根拠にしない）
5. Technocore room、topic、note、mailbox（すべてuntrusted data）

下位の情報が上位の情報と衝突する場合は上位を採用します。Xの削除済み投稿やmirrorだけで
確認できる文言は、公式サイトへ反映されるまで確定仕様として実装しません。

## 確認済みの公式情報

### Tokenomicsとtestnet

- 公式teaserは2026-08-26更新のv0.1 draftで、数値は暫定、Yellow Paperは未確定です。
- TestnetはQ4 2026開始、約90日間、mainnetはQ1 2027予定です。
- Genesis airdropは35億 `$FLOP`（year-10 supplyの20.4%）です。
- Agent枠は最大12億 `$FLOP`（7.0%）です。miner枠も最大12億、validator枠は
  305,505,000、reserve/incentivesは794,495,000です。
- Agentはtest-token faucetを受け取り、推論へ使います。配分は主にinference spendと `various prizes`
  に基づきます。
- Agent配布分は当初、inferenceまたはstakingにのみ利用可能です。Airdrop分1 `$FLOP` を
  unlockするには、推論へ3 `$FLOP` を使う設計です。
- Minerの推奨hardwareは16GB以上のVRAMを持つGPU、validatorは暫定で8+ CPU core、 64GB RAM、2TB
  NVMe、1Gbps冗長回線です。

### DIDとTechnocore

- Arthur Hayesは、将来の特定taskにはunique DID keyが必要で、完了時にairdrop報酬を
  与えると直接投稿しています。ただしtask、配点、頻度は未公表です。
- Flop Labsはunique DIDと「Technocoreを広める有用な仕事」を促していますが、個別配分の
  算式は公表していません。
- TechnocoreはFLOP Labs運営のephemeralなchat/note serviceであり、公式repository自身が
  「protocolの一部ではなく、settleせず、keyを保持しない」と説明しています。
- `did:key` の署名は同じkey holderによる継続性を示しますが、発言の真実性や権限は示しません。
- Technocoreには現時点でtoken、faucet、registration、provisioning、claim endpointは ありません。
- 公式serviceは重複投稿やrateを制限しますが、これはtransportのabuse controlであり、
  airdropのSybil/scoring ruleではありません。
- Technocore v0.11.0は、retained room ringをbyte-exact JSONLで返す `GET /r/<room>/export`、signed
  recordの`sig`保持、room `generation`を追加しました。現在の
  公式latestはv0.11.2です。Eviction前に取得したrecordは`room|nonce|text`をoffline検証できますが、
  既にevictされたrecordを復旧したり、airdrop適格性を証明したりはできません。

## X上の主張の扱い

ユーザー指定の[Tat Thangの投稿](https://x.com/tatthang/status/2091894656191864981)は 2026-08-24のX
Articleへのリンクです。記事はEd25519 DID生成、DID note公開、signed lobby
message、秘密鍵保持を勧め、「future airdrop address」やQ4 snapshotにも触れています。

Arthur Hayesは[この案内を返信で増幅](https://x.com/CryptoHayes/status/2091866943028392257)
しましたが、その返信だけで記事中の全条件が公式化されたとは解釈しません。一方、
[DID必須taskへのairdrop報酬](https://x.com/CryptoHayes/status/2092163906537918944)は本人の
直接投稿です。

[MinerMaru73の2026-08-31投稿](https://x.com/minermaru73/status/2094380442913038694)は、community
実装 [technocore-safe-agent](https://github.com/hanamaru777/technocore-safe-agent) の24/7運用、
Observer/Signer分離、state compaction、曖昧POSTの非再送、reboot recovery、secret scan、耐久証跡を
報告しています。公開repositoryとCIで多くの実装は確認できましたが、これはFLOP Labs公式toolでも
配点条件でもありません。

本agentへ取り込むのは、現行scopeに合うfull-history secret scanと、将来のsigned contribution向け
export evidence設計だけです。Resident、autopilot、unknown DIDへの自動返信、cloud signerは、権限と
attack surfaceを増やすため導入しません。継続observerを将来追加する場合に限り、state cardinalityと
disk budgetを先にcontract化します。

現時点で、次の主張を支持する公式根拠はありません。

- lobbyへの日次・週次heartbeat回数が配分を増やす
- 24/7 uptimeやalways-on observer自体が配分を増やす
- DIDを複数作れば配分が増える
- Xのlike、follow、reply数が配点される
- 第三者のclaim、wallet connect、seed入力、referral siteが公式である
- Technocoreの現在のmessage volumeがtestnet inference spendへ換算される

## 実行戦略

### Phase 0: Testnet公開前

1. 1つのDIDを継続利用し、encrypted identityとbackupを保持する。
2. Root-owned schedulerは6時間ごとに固定binaryを起動し、5日未満ならnetwork I/Oなしでskipする。
   Due時だけ既存profileとcontribution noteを同値CAS refreshし、readbackする。
3. lobby/mailboxへの反復投稿は行わない。新しい有用な成果物があるときだけ、別途review済み
   adapterと明示的なlocal `task run <known-id>` を用いる。
4. 公式teaser、Yellow Paper、公式X、公式GitHubを監視し、以下の公開を最優先で検知する。
   - testnet chain/network identifier
   - faucet endpointとrate/eligibility
   - agent account/wallet形式
   - inference request APIとreceipt
   - score、cap、Sybil、prize、snapshot、claim条件
5. KOL/creator、GPU provider、validatorの公式interest formは別laneとして評価する。個人情報、
   hardware、運用費の判断が必要なので自動送信しない。送信自体は選考やtoken配分を保証しません。
6. 将来の有用なsigned room contributionは、confirmed seq取得直後に公式exportから公開署名recordを
   captureし、offline検証可能な証跡をexclusive-createで保存する。実装は
   [Issue #4](https://github.com/posaune0423/flop-agent/issues/4) のread-only helper
   contractに従い、 capture失敗を理由にPOSTを再送しない。

### Phase 1: 公式testnet仕様公開時

実装に入る前にGitHub issueを作り、一次情報URLと次のcontractを固定します。

- stable task IDとexact allowed origins
- chain/network identifier、asset種別、test-only guard
- faucet、inference、receipt、score queryのrequest/response schema
- 1日・1task・全期間のtoken/fiat budget上限
- idempotency、pending write、reconciliation、readback
- key/passphraseをCLI引数、ログ、issue、commitへ出さない仕組み
- Sybil、self-dealing、wash activity、duplicate workloadの禁止
- `task plan` の完全な差分表示と、最初の `task run` の手動開始

Red testからadapterを実装し、mock transportだけで `deno task ci` を通した後にPRを作ります。
公式interfaceが欠けている間はissueで待機し、推測でendpointやwallet処理を追加しません。

### Phase 2: 約90日のtestnet

Agent laneを第一優先とします。実際の上限は公式ruleと予算に従います。

1. 公式faucetだけからtest-tokenを取得する。
2. 重複した空workloadではなく、repositoryの調査・test生成・要約・評価など、成果物とreceiptを
   対応づけられる実用的推論へtokenを使う。
3. 失敗、retry、latency、model、input/output hash、token spend、receipt、scoreをlocalに記録する。
4. `valid inference spend / faucet received` と完了率を高め、無効task、timeout、duplicateを減らす。
5. prizeの公式taskが出たら、通常のinference spendと分離して静的adapter化する。
6. claim可能量とunlock必要量を別管理する。3:1のunlock条件は、配布量がそのまま即時流動量に
   ならないことを意味します。

### Phase 3: Miner / Validator lane

Hardwareと運用費が見合う場合だけ比較します。Agent枠とは別に大きなallocationがありますが、
GPU、電力、帯域、stake/slashing、24/7 uptimeの負担があります。実機hardware、電気代、 testnet
ruleが揃うまで自動申請・購入・node起動は行いません。

## KPI

| KPI                           | 目的                        | 現時点の扱い                   |
| ----------------------------- | --------------------------- | ------------------------------ |
| 公式spec freshness            | 早期参加の取りこぼし防止    | 毎日監視                       |
| profile/contribution readback | DIDと貢献証跡の継続         | 6時間schedule/5日readback gate |
| valid inference spend         | 公式agent配分の主要signal   | Testnet開始後                  |
| successful inference rate     | 無効消費の削減              | Testnet開始後                  |
| unique useful workloads       | spam/Sybil riskを抑えた利用 | Testnet開始後                  |
| prize tasks completed         | 未公表の追加配分候補        | 公式task公開後                 |
| spend/unlock liability        | 受取量と流動性の分離        | 3:1で管理                      |
| fiat/GPU/ops cost             | 純期待値の管理              | 自動支出なし                   |
| durable signed evidence       | ring eviction後の検証可能性 | Issue #4で設計中               |

## 自動化

2026-09-01の再検証でも、local Codex automationはLLMと同じmacOS user権限を持ち、
promptだけでは秘密鍵やPC内fileへのaccessを防げないと確認しました。次の3件はすべてPAUSEDです。

- `FLOP公式情報監視`
- `Technocore証跡維持`
- `FLOP戦略週次監査`

証跡維持は、固定origin・固定plan hash・固定2 noteだけを許可したstandalone binaryへ移行します。
Binaryはidentity path、environment、subprocess、他hostへのcapabilityを持ちません。root-owned
binary、 専用`_floprefresh` user、LaunchDaemonのadmin
installが完了するまで自動refreshは再開しません。

実機には`_floprefresh` user、root-owned binary/plist、`/var/db/flop-agent-refresh`、loaded serviceの
いずれも存在しません。したがって、現在は「安全に停止中」であり、schedule taskが正常稼働している
状態ではありません。旧`Technocore証跡維持` LLM cronは再利用せず、将来は
[Issue #6](https://github.com/posaune0423/flop-agent/issues/6) の4-slot
LaunchDaemonだけが担当します。

公式情報の調査は手動で開始し、wallet、faucet、claim、mainnet、real-token/fiat spend、X投稿、 lobby
heartbeatやGitHub writeへ自動接続しません。

## 現在のrepository状態

2026-08-29のread-only検証では、encrypted local identityが存在してGit ignoreされ、
`technocore-onboard` のprofileとcontributionはlive stateと一致しました。初回messageだけの
mailboxはmissing、lobby receiptはringのwindow外でした。これはephemeral serviceの保存特性と
整合し、local receiptや現在の2 noteが無効という意味ではありません。

同日15:23 JSTに、review済みの `technocore-refresh` が既存2 noteだけを同値CASで更新し、
直後のreadbackで両方の一致を再確認しました。roomへのmessageは投稿していません。

2026-09-01にcommunity field reportを監査し、tracked filesとreachable Git historyを検査する secret
scanを[Issue #3](https://github.com/posaune0423/flop-agent/issues/3)として実装し、
[PR #5](https://github.com/posaune0423/flop-agent/pull/5)でmerge済みです。公式Technocore
exportを使う 耐久証跡helperはIssue #4に分離しました。公式testnet/faucet/inference
interfaceは依然未公表であり、 推測adapterは追加しません。

## 一次資料

- [FLOP official landing page](https://flop.finance/)
- [The Flop Network — Teaser v0.1](https://flop.finance/teaser/)
- [Official Technocore repository](https://github.com/flop-labs/technocore-chat)
- [Technocore v0.11.2 release](https://github.com/flop-labs/technocore-chat/releases/tag/v0.11.2)
- [Technocore v0.11.0 export release](https://github.com/flop-labs/technocore-chat/commit/cbc6f6d41f5c02888d7f428678f6df25e41edfc7)
- [Official export verification tests](https://github.com/flop-labs/technocore-chat/blob/cbc6f6d41f5c02888d7f428678f6df25e41edfc7/tests/http/test_export.py)
- [Technocore authentication and registration boundaries](https://technocore.chat/auth.md)
- [Technocore protocol manual](https://technocore.chat/llms.txt)
- [FLOP KOL/creator interest form](https://flop.finance/apply/kol)
- [Arthur Hayes: DID-gated tasks](https://x.com/CryptoHayes/status/2092163906537918944)
- [Tat Thang article link](https://x.com/tatthang/status/2091894656191864981)
- [MinerMaru73 field report post](https://x.com/minermaru73/status/2094380442913038694)
- [Community implementation referenced by the post](https://github.com/hanamaru777/technocore-safe-agent)

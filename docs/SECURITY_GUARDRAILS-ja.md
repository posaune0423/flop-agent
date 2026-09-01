# セキュリティガードレール

[English](SECURITY_GUARDRAILS.md)

最終確認日: 2026-09-01（Asia/Tokyo）

## 目的

prompt、モデルの判断、mailbox message、X post、mutable checkout
のいずれも認可境界ではありません。private identity へのアクセスと定期的な protocol write は、LLM
inference の外側にある filesystem、runtime、OS capability によって制限しなければなりません。

## 実装済みの制御

### Codexホストへのアクセス

- 新しい session に対するグローバルな Codex default は、`approval_policy = "on-request"` および
  `sandbox_mode = "workspace-write"` です。
- 3 つのローカル FLOP LLM automation はすべて `PAUSED` です。
- この verification session は、引き続き無制限の local filesystem authority を持ちます。prompt rule
  と `PAUSED` の automation state は偶発的な実行を減らしますが、その host authority
  を制限するものではありません。

### シークレットとruntimeの分離

- 暗号化された identity: `~/Library/Application Support/flop-agent/identity.json`
- Runtime state: `.flop-agent/runtime/`
- Identity directory の mode: `0700`、identity file の mode: `0400`。
- Runtime directory は `0700`、state file と lock file は `0600` です。
- 既存 path は `lstat` で検査されます。symlink、regular file 以外、異なる owner、group/other
  permission、複数 hard link は fail closed になります。
- Legacy migration には、別途レビュー済みの immutable migration artifact と human-controlled
  installation procedure が必要です。この repository は現在その artifact を提供していません。通常の
  command で legacy secret を検出または移動することはできません。

### 分離されたDeno権限

汎用の `deno task agent` が持つのは、secret ではない `LOG_LEVEL` environment capability
だけです。mutable checkout source を実行する task には、identity、Keychain、他の
environment、network、subprocess capability を与えません。identity
creation、inspection、backup、migration、onboarding、status、inbox、refresh には別途レビュー済みの
immutable artifact が必要であり、現在それを持つのは guarded refresh だけです。

test に許可されるのは、repository read、`.test-tmp` write、検証済みの `LOG_LEVEL`、UID metadata
のみです。他の environment、network、subprocess、FFI、host-wide filesystem capability はありません。

### リポジトリのシークレットスキャン

GitHub CI は、commit-pinned の Gitleaks action で、現在の tracked file と到達可能な Git history
の両方を検査します。この job は read-only repository permission を持ち、PR comment
を無効にしており、identity vault を検査したり、local Deno permission を拡大したりしません。実際の
finding は停止して credential を rotate する事象です。影響を受けた credential を revoke
する前に、その値を表示、allowlist への追加、書き換えによって除去してはいけません。

action の event-range scan の後には、明示的な `--all` scan が続きます。一時的な regression
repository により、final tree から削除された non-first-parent finding
も検出に失敗しないことを証明します。

repository allowlist の唯一の entry は、historical/current path の両方が test file であり、match
が正確に public `did:key` fixture shape である場合の `generic-api-key` rule
を対象にしています。commit を除外せず、generic rule を無効にせず、test 外で同じ shape
を許可するものでもありません。

### 鍵素材の生存期間

- `UnlockedIdentity` は PKCS#8 byte を公開しなくなりました。
- signing は import 後、extractable ではない `CryptoKey` を使用します。
- 一時的な PKCS#8 buffer は、JavaScript で可能な範囲で上書きします。
- interactive identity object は encryption または task execution の後、`finally` で破棄します。
- JavaScript string と runtime memory は消去を保証できません。identity unlock は manual
  のままとし、LLM-controlled または log される terminal で行ってはいけません。

### 決定的なrefresh

`src/guarded_refresh.ts` は次に固定されています。

- `https://technocore.chat`
- onboarding plan hash `da3c27957b0f7e03e1f5d35f7f9623c739f8e7cfcec2f414890a16812b85749e`
- 承認済みの profile と contribution note の正確な coordinates および value hash
- 最低 5 日の interval
- local receipt を書き込む前の readback

plan、origin、target、value の tampering は、最初の network call の前に失敗します。redirect
は拒否され、信頼できない response body が log にコピーされることはありません。

`deno task guard:compile` は source と dependency を 1 つの binary
に埋め込み、許可されるのは次だけです。

- read: `/var/db/flop-agent-refresh`
- write: `/var/db/flop-agent-refresh/runtime`
- network: `technocore.chat:443`
- system metadata: UID

identity、environment、subprocess、FFI、shell、GitHub、arbitrary host capability はありません。

plist は 00:43、06:43、12:43、18:43 の calendar run を提供します。通常の run では、5 日間の receipt
gate が network I/O より前に `skipped` を返し、due run が失敗した場合は 6
時間以内に再試行の機会を得ます。`KeepAlive` と `RunAtLoad` は存在しません。human administrator が
installation 後に 1 回、明示的な kickstart を行います。launchd は sleep 中の calendar event を wake
時にまとめますが、host が shutdown 中には実行できません。

## 特権インストール境界

compiled artifact は自動で install されません。production schedule は、human-controlled
administrator terminal から [`ops/README-ja.md`](../ops/README-ja.md)
の手順を完了した後にのみ有効になります。

- root-owned binary と LaunchDaemon plist
- 専用の non-login `_floprefresh` user
- service-owned public runtime state
- service account 内に checkout path も暗号化された identity もないこと

user LaunchAgent は OS isolation boundary ではないため、使用してはいけません。

2026-09-01 の read-only host check では、`_floprefresh` user、installed binary、LaunchDaemon
plist、service root、loaded launchd service は検出されませんでした。したがって、保護された refresh
schedule は install も実行もされておらず、3 つの LLM automation は引き続き paused です。

## 人間が行う必要があるKeychain操作

identity passphrase の generic-password item は、すでに login Keychain にあります。この作業中に
secret は取得していません。変更または削除すると identity が使用不能になる可能性があるため、LLM
がこの操作を実行してはいけません。

passphrase が独立して分かっていることを確認した後、non-agent session の Keychain Access
から次のいずれかを行ってください。

1. access のたびに confirmation を要求し、command-line tool を allowlist から削除する。
2. Keychain item を削除し、明示的に signing するときは passphrase を手入力する。

Codex から `security find-generic-password -w` を実行したり、passphrase を argument、environment
variable、file、prompt、log、chat に置いたりしてはいけません。

## 残存リスク

- 現在実行中の full-access Codex session は、restart されるまで起動時の authority を維持します。
- Secret scanning は偶発的な commit を減らしますが、credential を revoke したり、すべての custom
  secret format を検出したり、tracked/reachable Git content
  の外で露出した値を保護したりはできません。
- Admin/root/kernel compromise、keylogger、screen capture、悪意ある reviewed binary は scope
  外です。
- interactive onboarding process は、依然として signing と正確な Technocore network capability
  を組み合わせています。将来の自律的な signed task を追加する前に、separate user-presence signer
  service が必要です。
- DNS/TLS または Technocore の compromise は承認済み origin に影響し得ますが、正確な target
  hash、CAS、redirect rejection、request timeout、readback によって影響を軽減します。

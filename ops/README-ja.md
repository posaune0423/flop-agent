# Root-owned guarded refresh のインストール

[English](README.md)

Codex または別の agent-controlled terminal から、これらの手順を実行しないでください。administrator
boundary をまたぐため、install 対象の正確な commit を review・merge した後にのみ実行してください。

## 前提条件

1. `deno task ci` が成功すること。
2. `deno task guard:compile` が `ops/build/flop-agent-refresh` を生成すること。
3. secret を公開せずに artifact の SHA-256 を記録・review すること。artifact には identity file や
   passphrase は含まれません。
4. macOS administrator が、home、shell、Keychain、SSH、Codex、browser、GitHub access
   を持たない、hidden かつ non-login の `_floprefresh` user と group を作成すること。
5. 続行する前に `id _floprefresh` が解決すること。

## インストール時の所有権境界

human-controlled administrator terminal から、次を install します。

- binary: `/usr/local/libexec/flop-agent-refresh`、owner `root:wheel`、mode `0555`
- plist: `/Library/LaunchDaemons/io.github.posaune0423.flop-agent.refresh.plist`、owner
  `root:wheel`、mode `0644`
- service root: `/var/db/flop-agent-refresh`、owner `_floprefresh:_floprefresh`、mode `0700`
- runtime: `/var/db/flop-agent-refresh/runtime`、owner `_floprefresh:_floprefresh`、mode `0700`
- public `state.json`: `.flop-agent/runtime/state.json` からコピー、owner
  `_floprefresh:_floprefresh`、mode `0600`

`identity.json`、passphrase、checkout、shell configuration、environment file、GitHub credential を
service root にコピーしないでください。

mutable checkout から installer script を実行するのではなく、正確な owner と mode で `install(1)`
を使ってください。その後 `plutil -lint` で plist を検証し、launchd の `system` domain に load
してください。提供される plist は binary を直接呼び出します。shell も checkout path もありません。

## スケジュールの意味

plist は 00:43、06:43、12:43、18:43 の 4 つの calendar run を提供します。binary は引き続き 5 日間の
receipt gate を強制するため、通常の run は network I/O より前に停止します。verified receipt
を保存する前に due run が失敗した場合、次の 6 時間 slot で、固定された origin、plan、target、value
policy を弱めることなく再試行できます。

`StartCalendarInterval` は、sleep 中に逃した slot を macOS が wake した際に 1 回の run
にまとめます。host が shutdown 中は実行されません。これは short-lived job であるため `KeepAlive`
は意図的に存在せず、`RunAtLoad` の代わりに installation 後 1 回の明示的な kickstart を行います。

## 人間による有効化

non-agent administrator terminal から、正確に review した file を install・hash した後で実行します。

```sh
sudo launchctl bootstrap system \
  /Library/LaunchDaemons/io.github.posaune0423.flop-agent.refresh.plist
if ! service_before="$(sudo launchctl print system/io.github.posaune0423.flop-agent.refresh)"; then
  echo "could not inspect the loaded service" >&2
  exit 1
fi
if printf '%s\n' "${service_before}" | /usr/bin/grep -q 'state = running'; then
  echo "guarded refresh is already running; do not overlap activations" >&2
  exit 1
fi
log_size() {
  if sudo test -e "$1"; then
    sudo stat -f %z "$1"
  elif sudo test ! -e "$1"; then
    printf '0'
  else
    echo "could not establish log existence: $1" >&2
    return 1
  fi
}
stdout_path=/var/db/flop-agent-refresh/runtime/stdout.log
stderr_path=/var/db/flop-agent-refresh/runtime/stderr.log
if ! stdout_size="$(log_size "${stdout_path}")"; then exit 1; fi
if ! stderr_size="$(log_size "${stderr_path}")"; then exit 1; fi
case "${stdout_size}:${stderr_size}" in
  *[!0-9:]*) echo "invalid pre-run log size" >&2; exit 1 ;;
esac
if ! service_pid="$(sudo launchctl kickstart -p system/io.github.posaune0423.flop-agent.refresh)"; then
  echo "launchctl kickstart failed" >&2
  exit 1
fi
case "${service_pid}" in
  ''|*[!0-9]*) echo "launchctl returned an invalid PID" >&2; exit 1 ;;
esac
attempts=0
while sudo kill -0 "${service_pid}" 2>/dev/null; do
  attempts=$((attempts + 1))
  if [ "${attempts}" -ge 180 ]; then
    echo "guarded refresh did not exit within 180 seconds" >&2
    exit 1
  fi
  sleep 1
done
if ! stdout_delta="$(sudo tail -c "+$((stdout_size + 1))" "${stdout_path}")"; then
  echo "could not read current stdout" >&2
  exit 1
fi
if ! current_stderr_size="$(sudo stat -f %z "${stderr_path}" 2>/dev/null)"; then
  echo "could not stat current stderr" >&2
  exit 1
fi
case "${current_stderr_size}" in
  ''|*[!0-9]*) echo "invalid current stderr size" >&2; exit 1 ;;
esac
if [ "${current_stderr_size}" -ne "${stderr_size}" ]; then
  echo "current activation wrote to stderr" >&2
  sudo tail -c "+$((stderr_size + 1))" "${stderr_path}" >&2
  exit 1
fi
if ! status="$(printf '%s\n' "${stdout_delta}" | /usr/bin/plutil -extract status raw -o - - 2>/dev/null)"; then
  echo "current stdout is not one valid result JSON object" >&2
  exit 1
fi
case "${status}" in
  refreshed|skipped) ;;
  *) echo "unexpected guarded refresh status: ${status}" >&2; exit 1 ;;
esac
sudo launchctl print system/io.github.posaune0423.flop-agent.refresh
printf '%s\n' "${stdout_delta}"
```

Codexからこれらのcommandを実行しないでください。kickstartしたprocessの終了後、
`launchctl print`が前回の正常終了を示し、今回のactivationが出力したJSONで`status`が`refreshed`
または`skipped`になり、今回のactivationがstderrへ何も書いていないことを確認するまでcalendar
slotを利用しないでください。`refreshed`の場合は、一致するreceiptとreadbackも検証しなければなりません。

## 検証

daemon を loaded のままにする前に、次のすべてを確認してください。

- launchd が `UserName = _floprefresh` と root-owned binary path を報告すること。
- launchd が期待する 4 つの calendar interval を報告し、`KeepAlive` または `RunAtLoad` key
  がないこと。
- binary と plist の hash が review 済み release artifact と一致すること。
- service runtime に暗号化された identity や無関係な file がないこと。
- due run が承認済みの 2 つの note だけを更新し、一致する readback receipt を記録すること。
- origin、plan、target、value を 1 byte 変更すると network write が 0 回になること。
- service が human identity vault または user home を read できず、process を spawn
  できず、environment variable を read できず、別の host/port に connect できないこと。

## ロールバック

まず LaunchDaemon を unload してください。public runtime state を保持した上で、以前に review 済みの
binary と plist を restore するか、service を disabled のままにします。identity storage は別の
transaction であり、refresh rollback の一部として削除または移動してはいけません。

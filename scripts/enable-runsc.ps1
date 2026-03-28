param(
    [string]$RuntimePath = "/mnt/docker-desktop-disk/gvisor/bin/runsc"
)

function Get-DockerdPid {
    $dockerdPid = wsl -d docker-desktop -- /bin/sh -lc "ps -ef | grep /usr/local/bin/dockerd | grep -v grep | head -n 1 | tr -s ' ' | cut -d ' ' -f2"
    $dockerdPid = ($dockerdPid | Out-String).Trim()
    if (-not $dockerdPid) {
        throw "dockerd PID not found in docker-desktop VM."
    }
    return $dockerdPid
}

function Read-DaemonJson([string]$DockerdPid) {
    $raw = wsl -d docker-desktop -- /bin/sh -lc "nsenter -t $DockerdPid -m -p -u -i -n -- cat /run/config/docker/daemon.json"
    return ($raw | Out-String).Trim()
}

function Write-DaemonJson([string]$DockerdPid, [string]$json) {
    $b64 = [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($json))
    $cmd = "echo $b64 | base64 -d | nsenter -t $DockerdPid -m -p -u -i -n -- tee /run/config/docker/daemon.json > /dev/null"
    wsl -d docker-desktop -- /bin/sh -lc $cmd | Out-Null
}

function Reload-Dockerd([string]$DockerdPid) {
    wsl -d docker-desktop -- /bin/sh -lc "kill -HUP $DockerdPid" | Out-Null
}

$dockerdPid = Get-DockerdPid
$raw = Read-DaemonJson -DockerdPid $dockerdPid
try {
    if ([string]::IsNullOrWhiteSpace($raw)) { throw "empty" }
    $config = $raw | ConvertFrom-Json
} catch {
    $config = [pscustomobject]@{}
}

if (-not $config.runtimes) {
    $config | Add-Member -NotePropertyName runtimes -NotePropertyValue ([pscustomobject]@{}) -Force
}

if (-not $config.runtimes.runsc) {
    $config.runtimes | Add-Member -NotePropertyName runsc -NotePropertyValue ([pscustomobject]@{ path = $RuntimePath }) -Force
} else {
    $config.runtimes.runsc.path = $RuntimePath
}

$updated = $config | ConvertTo-Json -Depth 20 -Compress
Write-DaemonJson -DockerdPid $dockerdPid -json $updated
Reload-Dockerd -DockerdPid $dockerdPid

Write-Output "runsc runtime registered and dockerd reloaded."

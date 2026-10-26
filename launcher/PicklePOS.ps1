# =====================================================================
#  PicklePOS launcher (started hidden by "Start POS.bat")
#   1. Installs an update that was downloaded earlier (only between runs,
#      never while the app is open). Your data in "data\" is never touched.
#   2. Opens PicklePOS in Chrome/Edge as its own window.
#   3. While it is open, checks GitHub for a newer version every few hours
#      and downloads it in the background (needs internet).
#   4. When the app asks to restart (title "[pp:restart]"), closes it and
#      opens it again, which installs the update.
#  Works with Windows PowerShell 2.0 and newer (Windows 7 and up).
#  Log file: updates\update-log.txt
# =====================================================================
param(
  [string]$DataDir = 'data',   # folder for the browser profile (sales data)
  [switch]$NoKiosk,            # show the print dialog (Test POS.bat)
  [switch]$CheckOnly,          # only check/download an update, then exit
  [string]$ExtraFlags = ''     # extra browser flags (troubleshooting)
)

$Repo = 'ljdstechva/PicklePOS'
$Branch = 'main'
$CheckEveryHours = 3
$FirstCheckSeconds = 20

$App = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$Upd = Join-Path $App 'updates'
$Ready = Join-Path $Upd 'ready'
$StatusFile = Join-Path $App 'update-status.js'
$MsgFile = Join-Path $App 'messenger-status.js'
$LogFile = Join-Path $Upd 'update-log.txt'
# Never copied by an update, never backed up: user data and update work folders
$Skip = @('data', 'test-data', 'updates', 'update-status.js', 'messenger-status.js', '.git', '.complete')
if (-not (Test-Path $Upd)) { New-Item -ItemType Directory -Path $Upd | Out-Null }

function Log([string]$msg) {
  try {
    if ((Test-Path $LogFile) -and ((Get-Item $LogFile).Length -gt 200KB)) { Remove-Item $LogFile -Force }
    Add-Content -Path $LogFile -Value ((Get-Date).ToString('yyyy-MM-dd HH:mm:ss') + '  ' + $msg)
  } catch { }
}

function Read-Text([string]$file) {
  if (Test-Path $file) { return [IO.File]::ReadAllText($file) }
  return ''
}
function Get-Field([string]$text, [string]$name) {
  $m = [regex]::Match($text, $name + "\s*=\s*'([^']*)'")
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}
function Is-Newer($a, $b) {
  if (-not $a) { return $false }
  if (-not $b) { return $true }
  try { return ([version]$a) -gt ([version]$b) } catch { return $false }
}

function Js([string]$s) {
  if ($s -eq $null) { $s = '' }
  return '"' + (($s -replace '\\', '\\') -replace '"', '\"' -replace '[\r\n]+', ' ') + '"'
}
# The app reads this small file every minute to know about updates
function Write-Status([string]$state, [string]$version, [string]$notes, [string]$message) {
  try {
    $ms = [long](((Get-Date).ToUniversalTime() - (New-Object DateTime 1970, 1, 1, 0, 0, 0, 0)).TotalMilliseconds)
    $js = 'window.POS_UPDATE = {"launcher":true,"state":' + (Js $state) + ',"version":' + (Js $version) +
      ',"notes":' + (Js $notes) + ',"message":' + (Js $message) + ',"checkedAt":' + $ms + '};'
    $tmp = $StatusFile + '.tmp'
    [IO.File]::WriteAllText($tmp, $js)
    if (Test-Path $StatusFile) { Remove-Item $StatusFile -Force }
    Move-Item $tmp $StatusFile
  } catch { Log ('Could not write status: ' + $_.Exception.Message) }
}

# ---- Messenger: unread chats, read from the Messenger window's title ("(3) Messenger") ----
# Written to messenger-status.js every few seconds; the app shows the number on its Messenger button.
$script:WinApiOk = $null
function Get-WindowTitles {
  if ($script:WinApiOk -eq $null) {
    try {
      Add-Type -TypeDefinition @"
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public class PPWindows {
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
  public static List<string> Titles() {
    List<string> r = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (IsWindowVisible(h)) {
        int n = GetWindowTextLength(h);
        if (n > 0) { StringBuilder sb = new StringBuilder(n + 1); GetWindowText(h, sb, n + 1); r.Add(sb.ToString()); }
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
      $script:WinApiOk = $true
    } catch { $script:WinApiOk = $false }
  }
  if ($script:WinApiOk) { try { return [PPWindows]::Titles() } catch { } }
  return @(Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { $_.MainWindowTitle })
}
function Write-MsgStatus {
  $found = $false; $count = 0; $title = ''
  try {
    foreach ($t in (Get-WindowTitles)) {
      if ($t -notmatch 'Messenger|Facebook|Meta Business') { continue }
      if ($t -match 'PicklePOS') { continue }
      $found = $true
      if ($t -match '^\((\d+)\)') { $n = [int]$matches[1]; if ($n -gt $count) { $count = $n; $title = $t } }
      elseif (-not $title) { $title = $t }
    }
    $ms = [long](((Get-Date).ToUniversalTime() - (New-Object DateTime 1970, 1, 1, 0, 0, 0, 0)).TotalMilliseconds)
    $f = 'false'; if ($found) { $f = 'true' }
    $js = 'window.POS_MSG = {"window":' + $f + ',"count":' + $count + ',"title":' + (Js $title) + ',"at":' + $ms + '};'
    $tmp = $MsgFile + '.tmp'
    [IO.File]::WriteAllText($tmp, $js)
    if (Test-Path $MsgFile) { Remove-Item $MsgFile -Force }
    Move-Item $tmp $MsgFile
  } catch { }
}

function New-Web {
  # GitHub needs TLS 1.2 (3072). Old Windows 7 needs .NET 4.5+ for this.
  try { [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor 3072 } catch { }
  $wc = New-Object Net.WebClient
  $wc.Headers.Add('User-Agent', 'PicklePOS-updater')
  return $wc
}

function Expand-Zip([string]$zip, [string]$dest) {
  New-Item -ItemType Directory -Path $dest -Force | Out-Null
  try {
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($zip, $dest)
  } catch {
    # Fallback for computers without .NET 4.5
    $sh = New-Object -ComObject Shell.Application
    $sh.NameSpace($dest).CopyHere($sh.NameSpace($zip).Items(), 0x14)
    Start-Sleep -Seconds 3
  }
}

# Copies every file under $from into $to (same relative paths), skipping $Skip names at the top level
function Copy-Tree([string]$from, [string]$to) {
  $base = (Resolve-Path $from).Path.TrimEnd('\')
  Get-ChildItem -Path $from -Recurse -Force | Where-Object { -not $_.PSIsContainer } | ForEach-Object {
    $rel = $_.FullName.Substring($base.Length + 1)
    $top = $rel.Split('\')[0]
    if ($Skip -notcontains $top) {
      $target = Join-Path $to $rel
      $dir = Split-Path -Parent $target
      if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
      Copy-Item -LiteralPath $_.FullName -Destination $target -Force
    }
  }
}

function Check-Update {
  $local = Get-Field (Read-Text (Join-Path $App 'version.js')) 'POS_VERSION'
  $readyText = Read-Text (Join-Path $Ready 'version.js')
  $staged = Get-Field $readyText 'POS_VERSION'
  $stagedOk = (Test-Path (Join-Path $Ready '.complete')) -and (Is-Newer $staged $local)
  Write-Status 'checking' '' '' ''
  try {
    $remoteText = (New-Web).DownloadString('https://raw.githubusercontent.com/' + $Repo + '/' + $Branch + '/version.js?t=' + [DateTime]::Now.Ticks)
  } catch {
    # A WebException with a response means GitHub answered with an error; without one, no internet
    $we = $_.Exception.InnerException
    $msg = $_.Exception.Message
    if ($we) { $msg = $we.Message }
    Log ('Update check failed: ' + $msg)
    if ($stagedOk) { Write-Status 'ready' $staged (Get-Field $readyText 'POS_NOTES') '' }
    elseif ($we -and $we.Response) { Write-Status 'error' '' '' ('GitHub: ' + $msg) }
    else { Write-Status 'offline' '' '' $msg }
    return
  }
  $remote = Get-Field $remoteText 'POS_VERSION'
  $notes = Get-Field $remoteText 'POS_NOTES'
  if (-not $remote) { Write-Status 'error' '' '' 'Could not read the version on GitHub'; return }
  if (-not (Is-Newer $remote $local)) { Write-Status 'current' $remote $notes ''; return }
  if ($stagedOk -and -not (Is-Newer $remote $staged)) { Write-Status 'ready' $staged $notes ''; return }

  Write-Status 'downloading' $remote $notes ''
  Log ('Downloading version ' + $remote + ' (installed: ' + $local + ')')
  $zip = Join-Path $Upd 'download.zip'
  $ext = Join-Path $Upd 'extract'
  try {
    foreach ($p in @($zip, $ext, $Ready)) { if (Test-Path $p) { Remove-Item $p -Recurse -Force } }
    (New-Web).DownloadFile('https://codeload.github.com/' + $Repo + '/zip/refs/heads/' + $Branch, $zip)
    Expand-Zip $zip $ext
    $root = Get-ChildItem $ext | Where-Object { $_.PSIsContainer } | Select-Object -First 1
    if (-not $root) { throw 'The download was empty' }
    foreach ($must in @('index.html', 'version.js', 'js\app.js', 'launcher\PicklePOS.ps1')) {
      if (-not (Test-Path (Join-Path $root.FullName $must))) { throw ('The download is missing ' + $must) }
    }
    $got = Get-Field (Read-Text (Join-Path $root.FullName 'version.js')) 'POS_VERSION'
    if (-not (Is-Newer $got $local)) { throw ('Downloaded version ' + $got + ' is not newer') }
    Move-Item $root.FullName $Ready
    New-Item -ItemType File -Path (Join-Path $Ready '.complete') | Out-Null
    Write-Status 'ready' $got (Get-Field (Read-Text (Join-Path $Ready 'version.js')) 'POS_NOTES') ''
    Log ('Version ' + $got + ' is ready; it installs on the next restart')
  } catch {
    Log ('Download failed: ' + $_.Exception.Message)
    if (Test-Path $Ready) { Remove-Item $Ready -Recurse -Force }
    Write-Status 'error' $remote $notes $_.Exception.Message
  } finally {
    foreach ($p in @($zip, $ext)) { if (Test-Path $p) { Remove-Item $p -Recurse -Force -ErrorAction SilentlyContinue } }
  }
}

# Installs a downloaded update. Only called while the app is closed.
function Install-Update {
  if (-not (Test-Path (Join-Path $Ready '.complete'))) { return }
  $old = Get-Field (Read-Text (Join-Path $App 'version.js')) 'POS_VERSION'
  $new = Get-Field (Read-Text (Join-Path $Ready 'version.js')) 'POS_VERSION'
  if (-not (Is-Newer $new $old)) { Remove-Item $Ready -Recurse -Force; return }
  $prev = Join-Path $Upd 'previous'
  try {
    # Keep the current version so it can be put back if ever needed
    if (Test-Path $prev) { Remove-Item $prev -Recurse -Force }
    New-Item -ItemType Directory -Path $prev | Out-Null
    Copy-Tree $App $prev
    Copy-Tree $Ready $App
    Remove-Item $Ready -Recurse -Force
    Write-Status 'current' $new '' ''
    Log ('Installed version ' + $new + ' (was ' + $old + ')')
  } catch {
    Log ('Install failed, restoring version ' + $old + ': ' + $_.Exception.Message)
    try { Copy-Tree $prev $App } catch { Log ('Restore failed: ' + $_.Exception.Message) }
    if (Test-Path $Ready) { Remove-Item $Ready -Recurse -Force -ErrorAction SilentlyContinue }
  }
}

function Find-Browser {
  # Chrome first (any install location), then Edge. ProgramFiles(x86) is empty on 32-bit Windows.
  $roots = @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LocalAppData) | Where-Object { $_ }
  foreach ($exe in @('Google\Chrome\Application\chrome.exe', 'Microsoft\Edge\Application\msedge.exe')) {
    foreach ($r in $roots) {
      $b = Join-Path $r $exe
      if (Test-Path $b) { return $b }
    }
  }
  return $null
}

# Chrome keeps "lockfile" open while a window uses this profile
function Profile-InUse([string]$profileDir) {
  $lf = Join-Path $profileDir 'lockfile'
  if (-not (Test-Path $lf)) { return $false }
  try { $s = [IO.File]::Open($lf, 'Open', 'ReadWrite', 'None'); $s.Close(); return $false } catch { return $true }
}

# ---------------------------------------------------------------------
if ($CheckOnly) { Check-Update; exit }

$browser = Find-Browser
if (-not $browser) {
  Add-Type -AssemblyName System.Windows.Forms
  [Windows.Forms.MessageBox]::Show('Google Chrome or Microsoft Edge was not found on this laptop. Please install Google Chrome, then open PicklePOS again.', 'PicklePOS') | Out-Null
  exit 1
}
$dataPath = Join-Path $App $DataDir
$profileDir = Join-Path $dataPath 'browser-profile'
if (-not (Test-Path $dataPath)) { New-Item -ItemType Directory -Path $dataPath | Out-Null }
$url = (New-Object Uri (Join-Path $App 'index.html')).AbsoluteUri
$flags = '--user-data-dir="' + $profileDir + '" --app="' + $url + '" --start-maximized --no-first-run --no-default-browser-check --disable-features=Translate --disable-background-mode'
if (-not $NoKiosk) { $flags = $flags + ' --kiosk-printing' }
if ($ExtraFlags) { $flags = $flags + ' ' + $ExtraFlags }

while ($true) {
  $inUse = Profile-InUse $profileDir
  if (-not $inUse) {
    Install-Update
    Write-Status 'idle' '' '' ''
  }
  $psi = New-Object Diagnostics.ProcessStartInfo $browser
  $psi.Arguments = $flags
  $psi.UseShellExecute = $false
  $proc = [Diagnostics.Process]::Start($psi)
  # Already open? Chrome hands over to the open window and this launcher is not needed
  if ($inUse) { exit }

  $restart = $false
  $nextCheck = (Get-Date).AddSeconds($FirstCheckSeconds)
  $lastAsk = (Get-Date).AddMinutes(-5)
  $msgTick = 0
  Write-MsgStatus
  while (-not $proc.HasExited) {
    $msgTick++
    if ($msgTick % 3 -eq 0) { Write-MsgStatus }   # unread Messenger chats, about every 6 seconds
    $title = ''
    try { $proc.Refresh(); $title = [string]$proc.MainWindowTitle } catch { }
    if ($title.Contains('[pp:restart]')) {
      Log 'Restart requested by the app'
      $restart = $true
      try { $proc.CloseMainWindow() | Out-Null } catch { }
      if (-not $proc.WaitForExit(15000)) { try { $proc.Kill() } catch { } }
      break
    }
    if ($title.Contains('[pp:check]') -and ((Get-Date) -gt $lastAsk.AddSeconds(30))) {
      $lastAsk = Get-Date
      $nextCheck = Get-Date
    }
    if ((Get-Date) -ge $nextCheck) {
      try { Check-Update } catch { Log ('Check error: ' + $_.Exception.Message) }
      $nextCheck = (Get-Date).AddHours($CheckEveryHours)
    }
    Start-Sleep -Seconds 2
  }
  if (-not $restart) { break }
  # Give Chrome a moment to release the profile, then install and reopen
  for ($i = 0; $i -lt 20 -and (Profile-InUse $profileDir); $i++) { Start-Sleep -Milliseconds 500 }
}

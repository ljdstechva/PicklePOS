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
$PrintFile = Join-Path $App 'print-status.js'
$FbFile = Join-Path $App 'fb-connect.js'
$LogFile = Join-Path $Upd 'update-log.txt'
# Never copied by an update, never backed up: user data and update work folders
$Skip = @('data', 'test-data', 'updates', 'update-status.js', 'messenger-status.js', 'print-status.js', 'fb-connect.js', '.git', '.complete')
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
    $js = 'window.POS_UPDATE = {"launcher":true,"launcherVersion":' + (Js $script:LauncherVersion) + ',"state":' + (Js $state) + ',"version":' + (Js $version) +
      ',"notes":' + (Js $notes) + ',"message":' + (Js $message) + ',"checkedAt":' + $ms + '};'
    $tmp = $StatusFile + '.tmp'
    [IO.File]::WriteAllText($tmp, $js)
    if (Test-Path $StatusFile) { Remove-Item $StatusFile -Force }
    Move-Item $tmp $StatusFile
  } catch { Log ('Could not write status: ' + $_.Exception.Message) }
}

# ---- Messenger: a floating inbox window (opened in the POS browser profile, docked at the bottom
#      right, no address bar) and the unread count read from its title ("(3) Messenger").
#      The app presses its Messenger button -> title signal "[pp:msg:<url>]" -> Toggle-Messenger.
#      messenger-status.js is rewritten every few seconds; the app shows the number on the button. ----
$script:WinApiOk = $null
$script:PosPid = 0
$script:MsgProc = $null
$script:Installed = $false
$script:LauncherVersion = ''
$script:MsgDock = $null          # where the Messenger window must sit (set by the app's Messenger tab)
$script:PosHwnd = [IntPtr]::Zero
$MsgTitleMatch = 'Messenger|Facebook|Meta Business|messenger\.com|facebook\.com|Chats'
function Load-WinApi {
  if ($script:WinApiOk -ne $null) { return $script:WinApiOk }
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
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int cmd);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h, IntPtr after, int x, int y, int w, int hh, uint flags);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L; public int T; public int R; public int B; }
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  // left, top, width, height in device pixels
  public static int[] Rect(IntPtr h) { RECT r; GetWindowRect(h, out r); return new int[] { r.L, r.T, r.R - r.L, r.B - r.T }; }
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetWindowTextLength(IntPtr h);
  // "handle|pid|title" for every visible top-level window that has a title
  public static List<string> Windows() {
    List<string> r = new List<string>();
    EnumWindows(delegate(IntPtr h, IntPtr l) {
      if (IsWindowVisible(h)) {
        int n = GetWindowTextLength(h);
        if (n > 0) {
          StringBuilder sb = new StringBuilder(n + 1); GetWindowText(h, sb, n + 1);
          uint pid; GetWindowThreadProcessId(h, out pid);
          r.Add(h.ToInt64().ToString() + "|" + pid.ToString() + "|" + sb.ToString());
        }
      }
      return true;
    }, IntPtr.Zero);
    return r;
  }
}
"@
    $script:WinApiOk = $true
  } catch { $script:WinApiOk = $false }
  return $script:WinApiOk
}
# Visible windows as objects with Handle, Pid and Title
function Get-Windows {
  if (Load-WinApi) {
    try {
      $list = @()
      foreach ($line in [PPWindows]::Windows()) {
        $p = $line.Split('|', 3)
        $list += New-Object PSObject -Property @{ Handle = [IntPtr][long]$p[0]; Pid = [int]$p[1]; Title = $p[2] }
      }
      return $list
    } catch { }
  }
  return @(Get-Process | Where-Object { $_.MainWindowTitle } | ForEach-Object { New-Object PSObject -Property @{ Handle = $_.MainWindowHandle; Pid = $_.Id; Title = $_.MainWindowTitle } })
}
# The Messenger window: the one this launcher opened (its own Chrome, profile data\messenger-profile)
function Find-MsgWindow {
  $cands = @(Get-Windows | Where-Object { $_.Title -match $MsgTitleMatch -and $_.Title -notmatch 'PicklePOS' })
  if (-not $cands.Count) { return $null }
  if ($script:MsgProc) {
    foreach ($c in $cands) { if ($c.Pid -eq $script:MsgProc.Id) { return $c } }
  }
  foreach ($c in $cands) {
    $cl = ''
    try { $cl = [string](Get-WmiObject Win32_Process -Filter ("ProcessId=" + $c.Pid)).CommandLine } catch { }
    if ($cl -match 'messenger-profile') { return $c }
  }
  return $null
}
# Snap the Messenger window over the tab's content area. Its own title bar (about 32 px) is placed just
# above the area, i.e. over the POS title bar, so the chat content fills the tab exactly. While docked it
# stays above the POS (topmost) - the per-second check below hides it when neither is in front.
function Place-MsgWindow($w) {
  $d = $script:MsgDock
  if (-not $d) { return }
  try {
    $th = [int][Math]::Round(32 * $d.Dpr / 100)
    [PPWindows]::ShowWindow($w.Handle, 9) | Out-Null                                                                        # SW_RESTORE
    [PPWindows]::SetWindowPos($w.Handle, [IntPtr](-1), $d.X, ($d.Y - $th), $d.W, ($d.H + $th), [uint32]0x0040) | Out-Null   # HWND_TOPMOST, SWP_SHOWWINDOW
    [PPWindows]::SetForegroundWindow($w.Handle) | Out-Null
  } catch { Log ('Messenger window: ' + $_.Exception.Message) }
}
# The app opened its Messenger tab: open the window if needed and snap it in
function Dock-Messenger([string]$msgUrl) {
  if (-not (Load-WinApi)) { Log 'Messenger window: Windows API not available'; return }
  if (-not $msgUrl) { $msgUrl = 'https://www.messenger.com/' }
  $w = Find-MsgWindow
  if (-not $w) {
    try {
      $d = $script:MsgDock
      if (-not (Test-Path $MsgProfile)) { New-Item -ItemType Directory -Path $MsgProfile | Out-Null }
      $psi2 = New-Object Diagnostics.ProcessStartInfo $browser
      $psi2.Arguments = '--user-data-dir="' + $MsgProfile + '" --app="' + $msgUrl + '" --window-size=' + $d.W + ',' + ($d.H + 32) +
        ' --window-position=' + $d.X + ',' + [Math]::Max(0, $d.Y - 32) + ' --no-first-run --no-default-browser-check --disable-background-mode' +
        ' --disable-extensions --disable-component-update --disable-sync --disable-breakpad --no-pings --disable-features=Translate'
      $psi2.UseShellExecute = $false
      $script:MsgProc = [Diagnostics.Process]::Start($psi2)
    } catch { Log ('Could not open Messenger: ' + $_.Exception.Message); return }
    for ($i = 0; $i -lt 30; $i++) { Start-Sleep -Milliseconds 400; $w = Find-MsgWindow; if ($w) { break } }
    if (-not $w) { Log 'Messenger window did not appear'; return }
  }
  Place-MsgWindow $w
  Write-MsgStatus
}
# The app left its Messenger tab: tuck the window away (it keeps running, logged in)
function Hide-Messenger {
  $script:MsgDock = $null
  $w = Find-MsgWindow
  if ($w) {
    try {
      [PPWindows]::SetWindowPos($w.Handle, [IntPtr](-2), 0, 0, 0, 0, [uint32]0x0003) | Out-Null   # HWND_NOTOPMOST, SWP_NOSIZE|SWP_NOMOVE
      [PPWindows]::ShowWindow($w.Handle, 6) | Out-Null                                            # SW_MINIMIZE
    } catch { }
  }
  Write-MsgStatus
}
# Every second while docked: show the window when the POS or the window itself is in front, hide it otherwise
function Keep-Messenger {
  if (-not $script:MsgDock -or -not $script:WinApiOk) { return }
  $w = Find-MsgWindow
  if (-not $w) { return }
  $fg = [PPWindows]::GetForegroundWindow()
  $inFront = ($fg -eq $w.Handle) -or ($fg -eq $script:PosHwnd)
  if ($inFront) { if ([PPWindows]::IsIconic($w.Handle)) { Place-MsgWindow $w } }
  elseif (-not [PPWindows]::IsIconic($w.Handle)) { [PPWindows]::ShowWindow($w.Handle, 6) | Out-Null }
}
function Close-Messenger {
  $script:MsgDock = $null
  try { if ($script:MsgProc -and -not $script:MsgProc.HasExited) { $script:MsgProc.CloseMainWindow() | Out-Null; $script:MsgProc.WaitForExit(2500) | Out-Null } } catch { }
  try { $w = Find-MsgWindow; if ($w) { Stop-Process -Id $w.Pid -Force -ErrorAction SilentlyContinue } } catch { }
  $script:MsgProc = $null
}

# ---- Connecting a Facebook Page: the connect page (shown in the Messenger tab) puts the sign-in result
#      in its window title as "[pp:fbtoken:...]"; for 5 minutes after "[pp:fbconnect]" it is copied to
#      fb-connect.js, which the app reads to finish the connection. ----
$script:FbWatchUntil = [DateTime]::MinValue
$script:FbLastToken = ''
function Watch-FbToken {
  if ((Get-Date) -ge $script:FbWatchUntil) { return }
  try {
    foreach ($w in (Get-Windows)) {
      if ($w.Title -match '\[pp:fbtoken:([^\]\s]+)\]') {
        $tok = $matches[1]
        if ($tok -eq $script:FbLastToken) { return }
        $script:FbLastToken = $tok
        $ms = [long](((Get-Date).ToUniversalTime() - (New-Object DateTime 1970, 1, 1, 0, 0, 0, 0)).TotalMilliseconds)
        $js = 'window.POS_FB = {"token":' + (Js $tok) + ',"at":' + $ms + '};'
        $tmp = $FbFile + '.tmp'
        [IO.File]::WriteAllText($tmp, $js)
        if (Test-Path $FbFile) { Remove-Item $FbFile -Force }
        Move-Item $tmp $FbFile
        Log 'Facebook sign-in result received'
        return
      }
    }
  } catch { }
}
function Write-MsgStatus {
  $found = $false; $open = $false; $count = 0; $title = ''
  try {
    $panel = Find-MsgWindow
    if ($panel -and $script:MsgDock) {
      if ($script:WinApiOk) { if (-not [PPWindows]::IsIconic($panel.Handle)) { $open = $true } } else { $open = $true }
    }
    foreach ($w in (Get-Windows)) {
      $t = $w.Title
      if ($t -notmatch $MsgTitleMatch -or $t -match 'PicklePOS') { continue }
      $found = $true
      if ($t -match '^\((\d+)\)') { $n = [int]$matches[1]; if ($n -gt $count) { $count = $n; $title = $t } }
      elseif (-not $title) { $title = $t }
    }
    $ms = [long](((Get-Date).ToUniversalTime() - (New-Object DateTime 1970, 1, 1, 0, 0, 0, 0)).TotalMilliseconds)
    $f = 'false'; if ($found) { $f = 'true' }
    $o = 'false'; if ($open) { $o = 'true' }
    $js = 'window.POS_MSG = {"window":' + $f + ',"open":' + $o + ',"count":' + $count + ',"title":' + (Js $title) + ',"at":' + $ms + '};'
    $tmp = $MsgFile + '.tmp'
    [IO.File]::WriteAllText($tmp, $js)
    if (Test-Path $MsgFile) { Remove-Item $MsgFile -Force }
    Move-Item $tmp $MsgFile
  } catch { }
}

# ---- Printing: watch the Windows print queue after the app signals "[pp:print:<ms>]", so the app
#      can say "Done" only when the job has really gone to the printer (and show printer problems). ----
$script:PrintSig = 0
$script:PrintSince = [DateTime]::MinValue
$script:PrintWatchUntil = [DateTime]::MinValue
$script:PrintIdleWritten = $true
function Write-PrintStatus {
  try {
    $state = 'idle'; $detail = ''; $doc = ''; $pname = ''
    if ((Get-Date) -lt $script:PrintWatchUntil) {
      $printer = Get-WmiObject Win32_Printer -Filter 'Default=TRUE' | Select-Object -First 1
      if ($printer) { $pname = [string]$printer.Name }
      $active = $false; $seen = $false; $err = ''
      foreach ($j in @(Get-WmiObject Win32_PrintJob)) {
        if ($pname -and -not ([string]$j.Name).StartsWith($pname + ',')) { continue }
        $ts = [DateTime]::MinValue
        try { $ts = [Management.ManagementDateTimeConverter]::ToDateTime($j.TimeSubmitted) } catch { }
        if ($ts -lt $script:PrintSince.AddSeconds(-5)) { continue }
        $seen = $true; $doc = [string]$j.Document
        $st = [string]$j.JobStatus
        if ($st -match 'Error|Paper|Offline|Jam|Intervention|Blocked') { $err = $st }
        elseif ($st -match 'Printed|Complete|Deleting') { }
        else { $active = $true }
      }
      if ($err) { $state = 'error'; $detail = $err }
      elseif ($active) { $state = 'printing' }
      elseif ($seen) { $state = 'done' }
      else { $state = 'waiting' }
      if ($printer -and $state -ne 'done') {
        $codes = @{ 3 = 'Paper is low'; 4 = 'Out of paper'; 7 = 'Cover is open'; 8 = 'Paper jam'; 9 = 'Printer is offline'; 10 = 'Printer needs attention' }
        $ps = 0; try { $ps = [int]$printer.DetectedErrorState } catch { }
        if ($codes.ContainsKey($ps)) { $state = 'error'; $detail = $codes[$ps] }
        if ($printer.WorkOffline) { $state = 'error'; $detail = 'Printer is set to "Use Printer Offline"' }
      }
      $script:PrintIdleWritten = $false
    } else {
      if ($script:PrintIdleWritten) { return }
      $script:PrintIdleWritten = $true
    }
    $ms = [long](((Get-Date).ToUniversalTime() - (New-Object DateTime 1970, 1, 1, 0, 0, 0, 0)).TotalMilliseconds)
    $js = 'window.POS_PRINT = {"state":' + (Js $state) + ',"printer":' + (Js $pname) + ',"document":' + (Js $doc) + ',"detail":' + (Js $detail) +
      ',"since":' + $script:PrintSig + ',"at":' + $ms + '};'
    $tmp = $PrintFile + '.tmp'
    [IO.File]::WriteAllText($tmp, $js)
    if (Test-Path $PrintFile) { Remove-Item $PrintFile -Force }
    Move-Item $tmp $PrintFile
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
    elseif ($we -and $we.Response) { Write-Status 'error' '' '' ('Update server: ' + $msg) }
    else { Write-Status 'offline' '' '' $msg }
    return
  }
  $remote = Get-Field $remoteText 'POS_VERSION'
  $notes = Get-Field $remoteText 'POS_NOTES'
  if (-not $remote) { Write-Status 'error' '' '' 'Could not read the latest version'; return }
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
    $script:Installed = $true
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
# The version of the files this launcher was started from (the app checks it is not stale)
$script:LauncherVersion = Get-Field (Read-Text (Join-Path $App 'version.js')) 'POS_VERSION'
if ($CheckOnly) { Check-Update; exit }

$browser = Find-Browser
if (-not $browser) {
  Add-Type -AssemblyName System.Windows.Forms
  [Windows.Forms.MessageBox]::Show('Google Chrome or Microsoft Edge was not found on this laptop. Please install Google Chrome, then open PicklePOS again.', 'PicklePOS') | Out-Null
  exit 1
}
$dataPath = Join-Path $App $DataDir
$profileDir = Join-Path $dataPath 'browser-profile'
$MsgProfile = Join-Path $dataPath 'messenger-profile'
if (-not (Test-Path $dataPath)) { New-Item -ItemType Directory -Path $dataPath | Out-Null }
$url = (New-Object Uri (Join-Path $App 'index.html')).AbsoluteUri
# The extra --disable-* flags stop background work Chrome does not need for a local POS (lighter on old laptops)
$flags = '--user-data-dir="' + $profileDir + '" --app="' + $url + '" --start-maximized --no-first-run --no-default-browser-check --disable-features=Translate --disable-background-mode' +
  ' --disable-extensions --disable-component-update --disable-sync --disable-breakpad --no-pings'
if (-not $NoKiosk) { $flags = $flags + ' --kiosk-printing' }
if ($ExtraFlags) { $flags = $flags + ' ' + $ExtraFlags }

while ($true) {
  $inUse = Profile-InUse $profileDir
  if (-not $inUse) {
    $script:Installed = $false
    Install-Update
    Write-Status 'idle' '' '' ''
    if ($script:Installed) {
      # This launcher file may have changed too: hand over to a fresh copy of it and leave
      Log 'Handing over to the updated launcher'
      $a = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $MyInvocation.MyCommand.Path + '" -DataDir "' + $DataDir + '"'
      if ($NoKiosk) { $a += ' -NoKiosk' }
      if ($ExtraFlags) { $a += ' -ExtraFlags "' + $ExtraFlags + '"' }
      Start-Process -FilePath 'powershell.exe' -ArgumentList $a -WindowStyle Hidden
      exit
    }
  }
  $psi = New-Object Diagnostics.ProcessStartInfo $browser
  $psi.Arguments = $flags
  $psi.UseShellExecute = $false
  $proc = [Diagnostics.Process]::Start($psi)
  # Already open? Chrome hands over to the open window and this launcher is not needed
  if ($inUse) { exit }
  # Right after an update the previous browser may still be shutting down: if the new one quits within a
  # few seconds it only handed its request to the dying one, so open it again
  for ($try = 0; $try -lt 3 -and $proc.WaitForExit(4000); $try++) {
    Log ('Browser closed right away (try ' + ($try + 1) + '), opening it again')
    Start-Sleep -Seconds 3
    $proc = [Diagnostics.Process]::Start($psi)
  }

  $restart = $false
  $nextCheck = (Get-Date).AddSeconds($FirstCheckSeconds)
  $lastAsk = (Get-Date).AddMinutes(-5)
  $script:LastDockKey = ''
  $script:MsgDock = $null
  $script:PosPid = $proc.Id
  $msgTick = 0
  Write-MsgStatus
  while (-not $proc.HasExited) {
    $msgTick++
    if ($msgTick % 6 -eq 0) { Write-MsgStatus }   # unread Messenger chats, about every 6 seconds
    $title = ''
    try { $proc.Refresh(); $title = [string]$proc.MainWindowTitle } catch { }
    try { $script:PosHwnd = $proc.MainWindowHandle } catch { }
    # Only the newest signal in the title counts
    $sigs = [regex]::Matches($title, '\[pp:[^\]]*\]')
    $last = ''
    if ($sigs.Count -gt 0) { $last = $sigs[$sigs.Count - 1].Value }
    if ($last -match '\[pp:msgdock:(\d+),(\d+),(\d+),(\d+),(\d+):([^\]]*)\]') {
      $key = $matches[0]
      if ($key -ne $script:LastDockKey) {
        $script:LastDockKey = $key
        $script:MsgDock = @{ X = [int]$matches[1]; Y = [int]$matches[2]; W = [int]$matches[3]; H = [int]$matches[4]; Dpr = [int]$matches[5] }
        $u = ''
        try { $u = [Uri]::UnescapeDataString($matches[6]) } catch { }
        try { Dock-Messenger $u } catch { Log ('Messenger: ' + $_.Exception.Message) }
      }
    } elseif ($last -eq '[pp:msghide]') {
      if ($script:MsgDock) { $script:LastDockKey = ''; try { Hide-Messenger } catch { } }
    } elseif ($last -eq '[pp:msgclose]') {
      if ($script:LastDockKey -ne 'closed') { $script:LastDockKey = 'closed'; try { Close-Messenger } catch { } }
    } elseif ($last -eq '[pp:fbconnect]') {
      if ($script:LastDockKey -ne 'fbconnect') { $script:LastDockKey = 'fbconnect'; $script:FbWatchUntil = (Get-Date).AddMinutes(5); $script:FbLastToken = ''; try { Close-Messenger } catch { } }
    }
    try { Watch-FbToken } catch { }
    try { Keep-Messenger } catch { }
    if ($title -match '\[pp:print:(\d+)\]') {
      $sig = [long]$matches[1]
      if ($sig -ne $script:PrintSig) {
        $script:PrintSig = $sig
        $script:PrintSince = (New-Object DateTime 1970, 1, 1, 0, 0, 0, 0).AddMilliseconds($sig).ToLocalTime()
        $script:PrintWatchUntil = (Get-Date).AddSeconds(45)
      }
    }
    Write-PrintStatus   # only does work while a print is being watched
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
    Start-Sleep -Seconds 1
  }
  if (-not $restart) { break }
  # Give Chrome a moment to release the profile, then install and reopen
  for ($i = 0; $i -lt 20 -and (Profile-InUse $profileDir); $i++) { Start-Sleep -Milliseconds 500 }
}
# The POS was closed: close the Messenger panel with it
Close-Messenger

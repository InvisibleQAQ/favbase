param(
  [int]$Port = 17836,
  [int]$DurationSeconds = 330,
  [int]$IntervalSeconds = 20
)

$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
$chromePath = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
$builtExtension = Join-Path $repoRoot '.output/chrome-mv3'
$reportPath = Join-Path $PSScriptRoot 'phase-0-result.json'
$tempParent = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
$tempRoot = Join-Path $tempParent ('favbase-agent-bridge-phase-0-' + [guid]::NewGuid().ToString('N'))
$derivedExtension = Join-Path $tempRoot 'extension'
$profilePath = Join-Path $tempRoot 'chrome-profile'
$readyPath = Join-Path $tempRoot 'peer.ready'
$peerStdout = Join-Path $tempRoot 'peer.stdout.log'
$peerStderr = Join-Path $tempRoot 'peer.stderr.log'
$peerScript = Join-Path $PSScriptRoot 'ws-peer.py'
$loaderScript = Join-Path $PSScriptRoot 'load-extension.mjs'
$previousSpikeFlag = $env:VITE_AGENT_BRIDGE_SPIKE
$previousSpikePort = $env:VITE_AGENT_BRIDGE_SPIKE_PORT
$peerProcess = $null
$chromeProcess = $null

function Assert-ChildOfTemp([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $separator = [IO.Path]::DirectorySeparatorChar
  $prefix = $tempParent.TrimEnd($separator) + $separator
  if (-not $fullPath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase)) {
    throw ('Refusing to operate outside the system temp directory: ' + $fullPath)
  }
}

function Stop-IsolatedChrome {
  $matches = @(
    Get-CimInstance Win32_Process -Filter 'Name = ''chrome.exe''' |
      Where-Object { $_.CommandLine -like ('*' + $profilePath + '*') }
  )
  foreach ($process in $matches) {
    Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Remove-SpikeTemp {
  if (-not (Test-Path -LiteralPath $tempRoot)) {
    return
  }
  Assert-ChildOfTemp $tempRoot
  $cleanupDeadline = [DateTime]::UtcNow.AddSeconds(10)
  do {
    try {
      Remove-Item -LiteralPath $tempRoot -Recurse -Force -ErrorAction Stop
    } catch {
      if ([DateTime]::UtcNow -ge $cleanupDeadline) {
        throw
      }
      Start-Sleep -Milliseconds 250
    }
  } while (Test-Path -LiteralPath $tempRoot)
}

try {
  if (-not (Test-Path -LiteralPath $chromePath)) {
    throw ('Chrome not found at ' + $chromePath)
  }

  New-Item -ItemType Directory -Path $tempRoot | Out-Null
  Assert-ChildOfTemp $tempRoot
  if (Test-Path -LiteralPath $reportPath) {
    Remove-Item -LiteralPath $reportPath -Force
  }

  $env:VITE_AGENT_BRIDGE_SPIKE = '1'
  $env:VITE_AGENT_BRIDGE_SPIKE_PORT = [string]$Port
  & pnpm.cmd build
  if ($LASTEXITCODE -ne 0) {
    throw ('pnpm build failed with exit code ' + $LASTEXITCODE)
  }
  if (-not (Test-Path -LiteralPath $builtExtension)) {
    throw ('WXT build output missing: ' + $builtExtension)
  }

  Copy-Item -LiteralPath $builtExtension -Destination $derivedExtension -Recurse
  $manifestPath = Join-Path $derivedExtension 'manifest.json'
  $manifest = Get-Content -Raw -LiteralPath $manifestPath | ConvertFrom-Json
  $manifest.host_permissions = @(
    $manifest.host_permissions | Where-Object {
      $_ -ne '<all_urls>' -and
      $_ -notmatch '127[.]0[.]0[.]1' -and
      $_ -notmatch 'localhost'
    }
  )
  $manifestJson = $manifest | ConvertTo-Json -Depth 100
  $utf8NoBom = [Text.UTF8Encoding]::new($false)
  [IO.File]::WriteAllText($manifestPath, $manifestJson, $utf8NoBom)

  $peerArgs = @(
    $peerScript,
    '--port', $Port,
    '--duration-seconds', $DurationSeconds,
    '--interval-seconds', $IntervalSeconds,
    '--output', $reportPath,
    '--ready-file', $readyPath
  )
  $peerProcess = Start-Process -FilePath 'python' -ArgumentList $peerArgs -PassThru -WindowStyle Hidden -RedirectStandardOutput $peerStdout -RedirectStandardError $peerStderr

  $readyDeadline = [DateTime]::UtcNow.AddSeconds(15)
  while (-not (Test-Path -LiteralPath $readyPath)) {
    $peerProcess.Refresh()
    if ($peerProcess.HasExited) {
      throw 'WebSocket peer exited before becoming ready'
    }
    if ([DateTime]::UtcNow -ge $readyDeadline) {
      throw 'WebSocket peer readiness timed out'
    }
    Start-Sleep -Milliseconds 100
  }

  $chromeArgs = @(
    ('--user-data-dir=' + $profilePath),
    '--remote-debugging-port=0',
    '--enable-unsafe-extension-debugging',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-default-apps',
    '--disable-component-update',
    '--disable-background-networking',
    '--window-position=-32000,-32000',
    '--window-size=800,600'
  )
  $chromeProcess = Start-Process -FilePath $chromePath -ArgumentList $chromeArgs -PassThru -WindowStyle Hidden

  $devToolsPortPath = Join-Path $profilePath 'DevToolsActivePort'
  $devToolsDeadline = [DateTime]::UtcNow.AddSeconds(20)
  while (-not (Test-Path -LiteralPath $devToolsPortPath)) {
    $chromeProcess.Refresh()
    if ($chromeProcess.HasExited) {
      throw 'Chrome exited before DevTools became ready'
    }
    if ([DateTime]::UtcNow -ge $devToolsDeadline) {
      throw 'Chrome DevTools readiness timed out'
    }
    Start-Sleep -Milliseconds 100
  }

  $debuggingPort = (Get-Content -LiteralPath $devToolsPortPath -TotalCount 1).Trim()
  $loadResult = & node $loaderScript $debuggingPort $derivedExtension
  if ($LASTEXITCODE -ne 0) {
    throw ('Extensions.loadUnpacked failed with exit code ' + $LASTEXITCODE)
  }
  Write-Host ('Loaded spike extension: ' + $loadResult)

  $deadline = [DateTime]::UtcNow.AddSeconds($DurationSeconds + 90)
  while (-not $peerProcess.HasExited) {
    $peerProcess.Refresh()
    $chromeProcess.Refresh()
    if ($chromeProcess.HasExited) {
      throw 'Chrome exited before the spike completed'
    }
    if ([DateTime]::UtcNow -ge $deadline) {
      throw 'Phase 0 spike timed out'
    }
    Start-Sleep -Seconds 1
  }

  $peerProcess.WaitForExit()
  $peerProcess.Refresh()

  if (-not (Test-Path -LiteralPath $reportPath)) {
    throw 'Phase 0 peer produced no result file'
  }
  $reportJson = Get-Content -Raw -LiteralPath $reportPath
  $report = $reportJson | ConvertFrom-Json
  if ($report.summary.verdict -ne 'GO') {
    if (Test-Path -LiteralPath $peerStderr) {
      Get-Content -LiteralPath $peerStderr
    }
    throw 'Phase 0 peer reported NO-GO'
  }
  $reportJson
} finally {
  Stop-IsolatedChrome
  if ($chromeProcess -and -not $chromeProcess.HasExited) {
    Stop-Process -Id $chromeProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($peerProcess -and -not $peerProcess.HasExited) {
    Stop-Process -Id $peerProcess.Id -Force -ErrorAction SilentlyContinue
  }
  if ($null -eq $previousSpikeFlag) {
    Remove-Item Env:VITE_AGENT_BRIDGE_SPIKE -ErrorAction SilentlyContinue
  } else {
    $env:VITE_AGENT_BRIDGE_SPIKE = $previousSpikeFlag
  }
  if ($null -eq $previousSpikePort) {
    Remove-Item Env:VITE_AGENT_BRIDGE_SPIKE_PORT -ErrorAction SilentlyContinue
  } else {
    $env:VITE_AGENT_BRIDGE_SPIKE_PORT = $previousSpikePort
  }
  Remove-SpikeTemp
}

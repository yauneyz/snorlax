$ErrorActionPreference = 'Stop'

function Wait-ForCondition {
  param(
    [Parameter(Mandatory = $true)][scriptblock]$Condition,
    [Parameter(Mandatory = $true)][string]$FailureMessage,
    [int]$TimeoutSeconds = 30
  )

  $deadline = [DateTime]::UtcNow.AddSeconds($TimeoutSeconds)
  while ([DateTime]::UtcNow -lt $deadline) {
    if (& $Condition) { return }
    Start-Sleep -Milliseconds 500
  }
  throw $FailureMessage
}

function Get-TalysmanUninstallEntry {
  $roots = @(
    'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
  )
  foreach ($root in $roots) {
    if (-not (Test-Path -LiteralPath $root)) { continue }
    $entry = Get-ChildItem -LiteralPath $root |
      Get-ItemProperty |
      Where-Object { $_.DisplayName -eq 'Talysman' -and $_.InstallLocation } |
      Select-Object -First 1
    if ($entry) { return $entry }
  }
  throw 'Talysman did not register an uninstall entry.'
}

function Start-CheckedProcess {
  param(
    [Parameter(Mandatory = $true)][string]$FilePath,
    [string[]]$ArgumentList = @()
  )

  $process = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -Wait -PassThru
  if ($process.ExitCode -ne 0) {
    throw "Process failed with exit code $($process.ExitCode): $FilePath $($ArgumentList -join ' ')"
  }
}

$installer = Get-ChildItem -LiteralPath (Join-Path $PSScriptRoot '..\dist') -Filter 'Talysman-Setup-*-x64.exe' |
  Sort-Object LastWriteTimeUtc -Descending |
  Select-Object -First 1
if (-not $installer) { throw 'No Windows installer was found in dist.' }

Write-Host "Installing $($installer.Name) silently..."
Start-CheckedProcess -FilePath $installer.FullName -ArgumentList @('/S')

Wait-ForCondition -FailureMessage 'TalysmanSvc did not reach Running.' -Condition {
  (Get-Service -Name 'TalysmanSvc' -ErrorAction SilentlyContinue).Status -eq 'Running'
}

$entry = Get-TalysmanUninstallEntry
$installDirectory = [string]$entry.InstallLocation
$appPath = Join-Path $installDirectory 'Talysman.exe'
if (-not (Test-Path -LiteralPath $appPath -PathType Leaf)) {
  throw "Installed desktop executable is missing: $appPath"
}

Write-Host 'Launching the tray app so uninstall exercises app and service shutdown together...'
Start-Process -FilePath $appPath
Wait-ForCondition -FailureMessage 'Talysman.exe did not start.' -Condition {
  @(Get-Process -Name 'Talysman' -ErrorAction SilentlyContinue).Count -gt 0
}

$quietUninstall = [string]$entry.QuietUninstallString
if ($quietUninstall -notmatch '^"([^"]+)"\s*(.*)$') {
  throw "Unexpected QuietUninstallString: $quietUninstall"
}
$uninstallerPath = $Matches[1]
$uninstallerArguments = @($Matches[2].Trim()) | Where-Object { $_ }

Write-Host 'Uninstalling silently while Talysman and TalysmanSvc are running...'
Start-CheckedProcess -FilePath $uninstallerPath -ArgumentList $uninstallerArguments

Wait-ForCondition -FailureMessage 'TalysmanSvc still exists after uninstall.' -Condition {
  $null -eq (Get-Service -Name 'TalysmanSvc' -ErrorAction SilentlyContinue)
}
Wait-ForCondition -FailureMessage 'Talysman.exe is still running after uninstall.' -Condition {
  @(Get-Process -Name 'Talysman' -ErrorAction SilentlyContinue).Count -eq 0
}
Wait-ForCondition -FailureMessage "Install directory still exists after uninstall: $installDirectory" -Condition {
  -not (Test-Path -LiteralPath $installDirectory)
}

$remainingRules = @(Get-NetFirewallRule -DisplayName 'Talysman-*' -ErrorAction SilentlyContinue)
if ($remainingRules.Count -ne 0) {
  throw "Talysman firewall rules remain after uninstall: $($remainingRules.DisplayName -join ', ')"
}

Write-Host 'Windows install/uninstall smoke test passed.'

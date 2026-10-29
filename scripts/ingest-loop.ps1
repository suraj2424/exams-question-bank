# Ingest loop for Windows Task Scheduler
# Run this script via Task Scheduler every 15-30 minutes
# or run manually for a one-time ingestion cycle.

param(
    [switch]$DryRun,
    [string]$SourceId,
    [string]$PaperKey,
    [int]$IntervalMinutes = 30
)

$projectRoot = "D:\College\Projects\Web Development\question-bank"
$logFile = Join-Path $projectRoot "logs\ingest-loop.log"

function Write-Log {
    param([string]$Message)
    $timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    $line = "[$timestamp] $Message"
    Write-Host $line
    Add-Content -Path $logFile -Value $line
}

# Ensure log directory exists
if (-not (Test-Path (Split-Path $logFile))) {
    New-Item -ItemType Directory -Path (Split-Path $logFile) -Force | Out-Null
}

Write-Log "=== Ingest loop started ==="

if ($DryRun) { Write-Log "Mode: DRY RUN" }
if ($SourceId) { Write-Log "Source filter: $SourceId" }
if ($PaperKey) { Write-Log "Paper filter: $PaperKey" }

do {
    $start = Get-Date
    Write-Log "--- Cycle start ---"

    $args = @("run", "src/cli.ts", "tick")
    if ($DryRun) { $args += "--dry-run" }
    if ($SourceId) { $args += "--source", $SourceId }
    if ($PaperKey) { $args += "--paper", $PaperKey }

    try {
        $result = & bun $args 2>&1
        Write-Log "tick output: $result"
    } catch {
        Write-Log "tick ERROR: $($_.Exception.Message)"
    }

    $elapsed = (Get-Date) - $start
    Write-Log "Cycle completed in $($elapsed.TotalSeconds) seconds"

    $waitSec = $IntervalMinutes * 60
    Write-Log "Waiting ${IntervalMinutes} minutes..."
    Start-Sleep -Seconds $waitSec
} while ($true)
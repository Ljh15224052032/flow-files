param(
    [Parameter(Mandatory = $true)]
    [string]$ProcessName,
    [Parameter(Mandatory = $true)]
    [ValidateSet('idle', 'ten-tabs', 'scroll-1000', 'real-thumbnails')]
    [string]$Scenario,
    [switch]$IncludeDescendants
)

$processes = Get-Process -Name $ProcessName -ErrorAction Stop
if ($IncludeDescendants) {
    $processTable = Get-CimInstance Win32_Process
    $queue = [System.Collections.Generic.Queue[int]]::new()
    $processes.Id | ForEach-Object { $queue.Enqueue($_) }
    $ids = [System.Collections.Generic.HashSet[int]]::new([int[]]$processes.Id)

    while ($queue.Count -gt 0) {
        $parentId = $queue.Dequeue()
        $processTable.Where({ $_.ParentProcessId -eq $parentId }).ForEach({
            if ($ids.Add($_.ProcessId)) { $queue.Enqueue($_.ProcessId) }
        })
    }
    $processes = Get-Process -Id @($ids | ForEach-Object { $_ }) -ErrorAction SilentlyContinue
}

$row = [PSCustomObject]@{
    Timestamp = (Get-Date).ToString('s')
    Scenario = $Scenario
    Process = $ProcessName
    ProcessCount = @($processes).Count
    # WorkingSetPrivate is the closest match for Task Manager's default "Memory" column.
    # PrivateBytes is committed private virtual memory; it is useful for diagnostics but is not RAM in use.
    WorkingSetMB = 0
    ActivePrivateWorkingSetMB = 0
    PrivateCommitMB = 0
    Handles = ($processes | Measure-Object HandleCount -Sum).Sum
}

$processIds = [int[]]@($processes.Id)
$perf = Get-CimInstance Win32_PerfFormattedData_PerfProc_Process |
    Where-Object { $processIds -contains [int]$_.IDProcess }
$row.WorkingSetMB = [math]::Round((($perf | Measure-Object WorkingSet -Sum).Sum / 1MB), 1)
$row.ActivePrivateWorkingSetMB = [math]::Round((($perf | Measure-Object WorkingSetPrivate -Sum).Sum / 1MB), 1)
$row.PrivateCommitMB = [math]::Round((($perf | Measure-Object PrivateBytes -Sum).Sum / 1MB), 1)

$output = Join-Path $PSScriptRoot '..\measurements.csv'
$row | Export-Csv -Path $output -NoTypeInformation -Append -Encoding utf8
$row | Format-List

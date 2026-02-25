$w = 'C:\Users\Precision 7680\Documents\Claude Infohub\Worker.js.txt'
$a = 'C:\Users\Precision 7680\Documents\Claude Infohub\app.js.txt'

$workerFns = @('kvPutWithThrottle','shouldIncludeInProximity','handleApiStream','archiveIncidents','listArchiveDates','isRelevantIncident','sendAlertEmail','refreshTravelData','handleAdminAction','runIngestion')
$appFns    = @('initMap','wrapLongitude','renderAssetsOnMap','renderIncidentsOnMap','normaliseWorkerIncident','connectSSE','loadFromWorker','loadProximityFromWorker')

Write-Output '=== Worker.js.txt function presence ==='
foreach ($fn in $workerFns) {
    $hits = Select-String -Path $w -Pattern ('function\s+' + $fn + '\b') | Select-Object LineNumber, Line
    if ($hits) { $hits | ForEach-Object { Write-Output ('  FOUND   ln {0}: {1}' -f $_.LineNumber, $_.Line.Trim()) } }
    else        { Write-Output ('  MISSING: ' + $fn) }
}

Write-Output ''
Write-Output '=== app.js.txt function presence ==='
foreach ($fn in $appFns) {
    $hits = Select-String -Path $a -Pattern ('function\s+' + $fn + '\b') | Select-Object LineNumber, Line
    if ($hits) { $hits | ForEach-Object { Write-Output ('  FOUND   ln {0}: {1}' -f $_.LineNumber, $_.Line.Trim()) } }
    else        { Write-Output ('  MISSING: ' + $fn) }
}

Write-Output ''
Write-Output '=== async checks for shouldIncludeInProximity and kvPutWithThrottle ==='
Select-String -Path $w -Pattern 'async function (kvPutWithThrottle|shouldIncludeInProximity)' | Select-Object LineNumber, Line

Write-Output ''
Write-Output '=== ctx=undefined default on shouldIncludeInProximity ==='
Select-String -Path $w -Pattern 'shouldIncludeInProximity.*ctx\s*=' | Select-Object LineNumber, Line

Write-Output ''
Write-Output '=== handleApiStream existence ==='
Select-String -Path $w -Pattern 'handleApiStream' | Select-Object LineNumber, Line | Select-Object -First 3

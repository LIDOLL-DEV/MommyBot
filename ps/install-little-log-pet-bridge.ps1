$ErrorActionPreference = 'Stop'
$patchRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../data/little-log-pet-patch'))
$targetRoot = [IO.Path]::GetFullPath('C:\Scripts\omo-trainer')
$entries = Get-Content -LiteralPath (Join-Path $patchRoot 'manifest.json') -Raw | ConvertFrom-Json
foreach ($entry in $entries) {
    $target = [IO.Path]::GetFullPath((Join-Path $targetRoot $entry.path))
    $staged = [IO.Path]::GetFullPath((Join-Path $patchRoot $entry.source))
    if (-not $target.StartsWith($targetRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or -not $staged.StartsWith($patchRoot + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Patch path escaped its directory.' }
    if ($null -eq $entry.before) {
        if (Test-Path -LiteralPath $target) { throw "A new file now exists: $target" }
    } elseif (-not (Test-Path -LiteralPath $target) -or (Get-FileHash -LiteralPath $target -Algorithm SHA256).Hash.ToLowerInvariant() -ne $entry.before) {
        throw "The source changed after staging: $target"
    }
} # Check every original before making any changes to the sibling project.
foreach ($entry in $entries) {
    $target = Join-Path $targetRoot $entry.path
    Copy-Item -LiteralPath (Join-Path $patchRoot $entry.source) -Destination $target
}
Write-Output "Installed $($entries.Count) reviewed Little Log files. No services were restarted."

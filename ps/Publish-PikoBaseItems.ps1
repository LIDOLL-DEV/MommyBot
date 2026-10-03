$ErrorActionPreference = 'Stop'
$sourcePack = 'C:\Scripts\MommyBot\output\newSpriteSystem_clothing_base'
$destinations = @(
    'C:\Scripts\MommyBot\output\newSpriteSystem_clothing',
    'C:\Scripts\MommyBot\output\newSpriteSystem_clothing_grayscale',
    'C:\Users\langley\GameMakerProjects\extraAssets\newSpriteSystem\Clothing_Expansion_v1'
)
$sourceManifest = Get-Content -LiteralPath (Join-Path $sourcePack 'manifest.json') -Raw | ConvertFrom-Json
$sourceFiles = Get-ChildItem -LiteralPath $sourcePack -File -Recurse
$obsoleteFiles = @()

foreach ($destinationPack in $destinations) {
    $oldManifest = Get-Content -LiteralPath (Join-Path $destinationPack 'manifest.json') -Raw | ConvertFrom-Json
    foreach ($item in $oldManifest.items) {
        $baseItem = @($sourceManifest.items | Where-Object { $_.id -eq $item.design })
        if ($baseItem.Count -ne 1) { throw "Unknown design: $($item.design)" }
        if ($item.file -eq $baseItem[0].file) { continue }
        $leaf = [System.IO.Path]::GetFileName($item.file)
        if ($item.file -ne "sheets/$leaf") { throw "Unexpected sprite path: $($item.file)" }
        $obsolete = Join-Path (Join-Path $destinationPack 'sheets') $leaf
        $replacement = Join-Path $sourcePack $baseItem[0].file
        if ((Get-FileHash -LiteralPath $obsolete).Hash -ne (Get-FileHash -LiteralPath $replacement).Hash) {
            throw "Sprite was changed; refusing to remove it: $obsolete"
        }
        $obsoleteFiles += $obsolete  # Only exact duplicates declared by the old pack manifest can be removed.
    }
}

foreach ($destinationPack in $destinations) {
    foreach ($file in $sourceFiles) {
        $relative = $file.FullName.Substring($sourcePack.Length + 1)
        $target = Join-Path $destinationPack $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
        Copy-Item -LiteralPath $file.FullName -Destination $target -Force
        if ((Get-FileHash -LiteralPath $file.FullName).Hash -ne (Get-FileHash -LiteralPath $target).Hash) {
            throw "Copy verification failed: $target"
        }
    }
}  # Publish and verify all base sprites and references before removing old filenames.

foreach ($obsolete in $obsoleteFiles) {
    Remove-Item -LiteralPath $obsolete
}  # Remove only the individually verified duplicate files; never delete a directory.

foreach ($destinationPack in $destinations) {
    $actual = @(Get-ChildItem -LiteralPath (Join-Path $destinationPack 'sheets') -Filter '*.png' -File)
    if ($actual.Count -ne 10) { throw "Unexpected sprite count in $destinationPack" }
    Write-Output "Verified 10 unique base-item sheets in $destinationPack"
}

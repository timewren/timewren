$ErrorActionPreference = 'Stop'
$root = Join-Path $PSScriptRoot '..'
$src = Join-Path $root 'src\app'
$files = Get-ChildItem -Path $src -Recurse -Filter 'page.tsx'
$no = @()
foreach ($f in $files) {
  $c = (Get-Content -LiteralPath $f.FullName) -join "`n"
  if ($c -notmatch 'export const metadata') {
    $no += $f.FullName
  }
}
$no | Sort-Object

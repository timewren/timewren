# Pak TimeTrack 0.2.23 (crates/tt-app) som Windows-installer (NSIS).
#
#   pwsh scripts/bundle-windows.ps1 [-OutDir dist\windows]
#
# Kører på Forgejo-runneren mahope-pc (labels windows/windows-latest) og på
# GitHub-spejlets windows-latest. Kræver Rust (MSVC), fxc.exe fra Windows SDK
# (GPUI's shadere) og NSIS (makensis). Laver i OutDir:
#   TimeTrack_<version>_x64-setup.exe        installer (samme navn som 0.2.x)
#   TimeTrack_<version>_x64-setup.exe.sig    kun med TAURI_SIGNING_PRIVATE_KEY
#
# Installeren lægger appen som %LOCALAPPDATA%\TimeTrack\timetrack.exe og afløser
# Tauri-appens timetrack-desktop.exe (se bundle/windows/installer.nsi).
#
# Signering (kun hvis alt er sat; ellers usigneret, og det skal stå i release-noterne):
#   Authenticode via Azure Artifact (Trusted) Signing:
#     AZURE_CLIENT_ID, AZURE_CLIENT_SECRET, AZURE_TENANT_ID,
#     AZURE_ENDPOINT, AZURE_ACCOUNT_NAME, AZURE_PROFILE_NAME
#     og trusted-signing-cli i PATH (cargo install trusted-signing-cli).
#     Både exe'en og installeren signeres, FØR updater-signaturen laves.
#   Updater (minisign): TAURI_SIGNING_PRIVATE_KEY (+ _PASSWORD), samme nøgle som 0.2.x.
# TT_SKIP_BUILD=1 bruger en allerede bygget binær.
param(
    [string]$OutDir = ""
)
$ErrorActionPreference = 'Stop'
$root = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
Set-Location $root
if (-not $OutDir) { $OutDir = Join-Path $root 'dist\windows' }
$target = 'x86_64-pc-windows-msvc'

$m = Select-String -Path 'crates\tt-app\Cargo.toml' -Pattern '^version = "(.+)"$' | Select-Object -First 1
if (-not $m) { throw 'Kan ikke læse versionen i crates\tt-app\Cargo.toml' }
$version = $m.Matches[0].Groups[1].Value
# VIProductVersion skal være fire tal: 0.2.24-beta.2 -> 0.2.24.0
$viVersion = ($version -replace '[-+].*$', '') + '.0'

function Invoke-Checked([string]$what, [scriptblock]$cmd) {
    & $cmd
    if ($LASTEXITCODE -ne 0) { throw "$what fejlede (exit $LASTEXITCODE)" }
}

$targetDir = if ($env:CARGO_TARGET_DIR) { $env:CARGO_TARGET_DIR } else { Join-Path $root 'target' }
# Indbygget lokal AI (llama.cpp, statisk linket, CPU med AVX2 og ggml's egen
# trådpulje, se crates/tt-ai/Cargo.toml). TT_FEATURES=none bygger uden (en tom
# miljøvariabel findes ikke på Windows).
$features = if ($env:TT_FEATURES -eq 'none') { '' } elseif ($env:TT_FEATURES) { $env:TT_FEATURES } else { 'local-llm' }
if (-not $env:TT_SKIP_BUILD) {
    # cmake og libclang til llama.cpp (findes de ikke, hentes portable kopier).
    if ($features) { . (Join-Path $PSScriptRoot 'llama-tools-windows.ps1') }
    # Som array: Windows PowerShell 5 dropper et tomt "" til native programmer.
    $featureArgs = if ($features) { @('--features', $features) } else { @() }
    Invoke-Checked 'cargo build' { cargo build --release --locked -p tt-app --bin timetrack --target $target @featureArgs }
}
$bin = Join-Path $targetDir "$target\release\timetrack.exe"
# TT_SKIP_BUILD efter en almindelig `cargo build --release` (uden --target).
if (-not (Test-Path $bin) -and $env:TT_SKIP_BUILD) { $bin = Join-Path $targetDir 'release\timetrack.exe' }
if (-not (Test-Path $bin)) { throw "Binæren mangler: $bin" }

# Én installer til alle maskiner: exe'en må ikke kræve DLL'er, som ikke følger
# med Windows (OpenMP's vcomp140.dll, en dynamisk llama.cpp/ggml eller CUDA).
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
$dumpbin = if (Test-Path $vswhere) {
    & $vswhere -latest -products * -find 'VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe' | Select-Object -First 1
}
if ($dumpbin) {
    $deps = & $dumpbin /nologo /dependents $bin | Where-Object { $_ -match '^\s+\S+\.dll\s*$' } | ForEach-Object { $_.Trim() }
    Write-Host "DLL'er: $($deps -join ', ')"
    $bad = $deps | Where-Object { $_ -match '^(vcomp|vcruntime|msvcp|llama|ggml|cudart|cublas|nvcuda|vulkan)' }
    if ($bad) { throw "timetrack.exe kræver DLL'er, der ikke følger med Windows: $($bad -join ', ')" }
} else {
    Write-Host 'dumpbin findes ikke; DLL-tjekket springes over'
}

Write-Host "Pakker TimeTrack $version ($target) i $OutDir"
if (Test-Path $OutDir) { Remove-Item -Recurse -Force $OutDir }
$stage = Join-Path $OutDir 'stage'
New-Item -ItemType Directory -Force -Path $stage | Out-Null
# Den nye exe hedder timetrack.exe; installeren afløser den gamle
# timetrack-desktop.exe (proces, genveje, autostart), se installer.nsi.
Copy-Item $bin (Join-Path $stage 'timetrack.exe')

$azureVars = 'AZURE_CLIENT_ID', 'AZURE_CLIENT_SECRET', 'AZURE_TENANT_ID', 'AZURE_ENDPOINT', 'AZURE_ACCOUNT_NAME', 'AZURE_PROFILE_NAME'
$canSign = -not ($azureVars | Where-Object { -not [Environment]::GetEnvironmentVariable($_) })
if ($canSign -and -not (Get-Command trusted-signing-cli -ErrorAction SilentlyContinue)) {
    throw 'Azure-secrets er sat, men trusted-signing-cli findes ikke (cargo install trusted-signing-cli)'
}
function Sign-Authenticode([string]$file) {
    if (-not $canSign) { return }
    Invoke-Checked "Authenticode-signering af $file" {
        trusted-signing-cli -e $env:AZURE_ENDPOINT -a $env:AZURE_ACCOUNT_NAME -c $env:AZURE_PROFILE_NAME -d TimeTrack $file
    }
}
if ($canSign) { Write-Host 'Signerer med Azure Artifact Signing' }
else { Write-Host 'ADVARSEL: Azure-secrets mangler. Installeren er USIGNERET (SmartScreen advarer).' }
Sign-Authenticode (Join-Path $stage 'timetrack.exe')

# makensis: PATH, standardinstallation eller Tauri-CLI'ens kopi fra 0.2.x-builds.
$makensis = (Get-Command makensis.exe -ErrorAction SilentlyContinue).Source
foreach ($c in @("${env:ProgramFiles(x86)}\NSIS\makensis.exe", "$env:ProgramFiles\NSIS\makensis.exe", "$env:LOCALAPPDATA\tauri\NSIS\makensis.exe")) {
    if (-not $makensis -and (Test-Path $c)) { $makensis = $c }
}
if (-not $makensis) { throw 'makensis.exe findes ikke (installér NSIS 3, fx choco install nsis -y)' }

$setup = Join-Path $OutDir "TimeTrack_${version}_x64-setup.exe"
Push-Location (Join-Path $root 'crates\tt-app\bundle\windows')
try {
    Invoke-Checked 'makensis' { & $makensis -V2 "-DVERSION=$version" "-DVIVERSION=$viVersion" "-DSRC=$stage" "-DOUTFILE=$setup" installer.nsi }
} finally { Pop-Location }
Sign-Authenticode $setup

if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    Invoke-Checked 'tauri signer sign' { npx --yes '@tauri-apps/cli@2.11.2' signer sign $setup }
    if (-not (Test-Path "$setup.sig")) { throw 'Updater-signaturen blev ikke lavet' }
} else {
    Write-Host 'TAURI_SIGNING_PRIVATE_KEY mangler: ingen .sig (updateren vil afvise pakken)'
}
Remove-Item -Recurse -Force $stage
Write-Host 'Færdig:'
Get-ChildItem $OutDir | Format-Table Name, Length

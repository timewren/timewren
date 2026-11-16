# Byggeværktøjer til den indbyggede lokale AI (llama.cpp, feature local-llm) på Windows.
#
#   ./scripts/llama-tools-windows.ps1
#
# llama-cpp-sys-2 kræver cmake og libclang (bindgen) ud over MSVC. Findes de
# allerede (PATH, LIBCLANG_PATH, LLVM eller Visual Studios clang-værktøjer),
# bruges de. Ellers hentes portable kopier til en mappe under RUNNER_TEMP/TEMP,
# tjekket med SHA256. Der installeres intet på maskinen.
#
# I GitHub/Forgejo Actions skrives PATH og LIBCLANG_PATH til GITHUB_PATH og
# GITHUB_ENV, så de gælder for jobbets næste trin. Lokalt: kør med `.` foran
# (dot-source), så de gælder i den aktuelle PowerShell.
$ErrorActionPreference = 'Stop'

$cmakeVersion = '4.4.4'
$cmakeSha = 'bace36e94b31c68ab6fa295f26dfa11219e0701cf7c94b0284a7d1cb13dac536'
$libclangUrl = 'https://files.pythonhosted.org/packages/0b/2d/3f480b1e1d31eb3d6de5e3ef641954e5c67430d5ac93b7fa7e07589576c7/libclang-18.1.1-py2.py3-none-win_amd64.whl'
$libclangSha = '4dd2d3b82fab35e2bf9ca717d7b63ac990a3519c7e312f19fa8e86dcc712f7fb'

$base = if ($env:RUNNER_TEMP) { $env:RUNNER_TEMP } else { $env:TEMP }
$tools = Join-Path $base 'timetrack-llama-tools'
New-Item -ItemType Directory -Force -Path $tools | Out-Null

function Get-Checked([string]$url, [string]$sha, [string]$file) {
    if ((Test-Path $file) -and ((Get-FileHash -Algorithm SHA256 $file).Hash -eq $sha)) { return }
    Write-Host "Henter $url"
    $ProgressPreference = 'SilentlyContinue'
    # Windows PowerShell 5.1 bruger ellers måske TLS 1.0/1.1, som GitHub og PyPI afviser.
    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $url -OutFile $file -UseBasicParsing
    $actual = (Get-FileHash -Algorithm SHA256 $file).Hash
    if ($actual -ne $sha) {
        Remove-Item $file -Force
        throw "SHA256 passer ikke for $url (fik $actual)"
    }
}

function Add-ToPath([string]$dir) {
    $env:PATH = "$dir;$env:PATH"
    if ($env:GITHUB_PATH) { Add-Content $env:GITHUB_PATH $dir }
}

function Set-JobEnv([string]$name, [string]$value) {
    Set-Item -Path "env:$name" -Value $value
    if ($env:GITHUB_ENV) { Add-Content $env:GITHUB_ENV "$name=$value" }
}

# --- cmake
$cmake = Get-Command cmake.exe -ErrorAction SilentlyContinue
if (-not $cmake) {
    $zip = Join-Path $tools "cmake-$cmakeVersion.zip"
    Get-Checked "https://github.com/Kitware/CMake/releases/download/v$cmakeVersion/cmake-$cmakeVersion-windows-x86_64.zip" $cmakeSha $zip
    $dir = Join-Path $tools "cmake-$cmakeVersion-windows-x86_64"
    if (-not (Test-Path (Join-Path $dir 'bin\cmake.exe'))) { Expand-Archive -Force $zip $tools }
    Add-ToPath (Join-Path $dir 'bin')
}
Write-Host "cmake: $((Get-Command cmake.exe).Source)"

# --- libclang (bindgen)
function Find-Libclang {
    if ($env:LIBCLANG_PATH -and (Test-Path (Join-Path $env:LIBCLANG_PATH 'libclang.dll'))) { return $env:LIBCLANG_PATH }
    $llvm = Join-Path $env:ProgramFiles 'LLVM\bin'
    if (Test-Path (Join-Path $llvm 'libclang.dll')) { return $llvm }
    $vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio\Installer\vswhere.exe'
    if (Test-Path $vswhere) {
        foreach ($vs in & $vswhere -products * -property installationPath) {
            $d = Join-Path $vs 'VC\Tools\Llvm\x64\bin'
            if (Test-Path (Join-Path $d 'libclang.dll')) { return $d }
        }
    }
    return $null
}
$libclang = Find-Libclang
if (-not $libclang) {
    # Det officielle libclang-hjul fra PyPI er en zip med libclang.dll; Python behøves ikke.
    $whl = Join-Path $tools 'libclang-18.1.1.zip'
    Get-Checked $libclangUrl $libclangSha $whl
    $dir = Join-Path $tools 'libclang-18.1.1'
    $libclang = Join-Path $dir 'libclang-18.1.1.data\platlib\clang\native'
    if (-not (Test-Path (Join-Path $libclang 'libclang.dll'))) { Expand-Archive -Force $whl $dir }
}
Set-JobEnv 'LIBCLANG_PATH' $libclang
Write-Host "libclang: $libclang"

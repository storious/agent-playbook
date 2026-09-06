param(
    [string]$Version = $(if ($env:AGULATER_VERSION) { $env:AGULATER_VERSION } else { "{{VERSION}}" }),
    [string]$InstallDir = $(
        if ($env:AGULATER_INSTALL_DIR) { $env:AGULATER_INSTALL_DIR }
        else { Join-Path $env:LOCALAPPDATA "Programs\Agulater\bin" }
    ),
    [string]$SetupHome = $env:AGULATER_HOME,
    [switch]$NoModifyPath,
    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
$Version = $Version.Trim()
if ($Version -match '^\{\{.+\}\}$') {
    throw "this checkout installer has no embedded release; pass -Version or set AGULATER_VERSION"
}
$Version = $Version.TrimStart("v")
if (-not [Environment]::Is64BitOperatingSystem -or
    [Runtime.InteropServices.RuntimeInformation]::OSArchitecture -ne
        [Runtime.InteropServices.Architecture]::X64) {
    throw "Agulater currently publishes a Windows x64 binary"
}

$Platform = "windows-x64"
$Archive = "agulater-v$Version-$Platform.zip"
$Url = "https://github.com/storious/agulater/releases/download/v$Version/$Archive"
$Destination = Join-Path $InstallDir "agulater.exe"
$GitHubCli = Get-Command gh -ErrorAction SilentlyContinue
$UseGitHubCli = $false
if ($GitHubCli -and -not $DryRun) {
    & gh auth status *> $null
    $UseGitHubCli = $LASTEXITCODE -eq 0
}

Write-Output "Agulater $Version -> $Destination"
if ($DryRun) {
    if ($UseGitHubCli) {
        Write-Output "gh release download v$Version --repo storious/agulater --pattern $Archive"
    } else {
        Write-Output $Url
    }
    Write-Output "Setup: agulater setup user --if-missing"
    if (-not $NoModifyPath) {
        Write-Output "PATH: add $InstallDir to the user PATH when needed"
    }
    return
}

$Temporary = Join-Path ([IO.Path]::GetTempPath()) ("agulater-install-" + [Guid]::NewGuid())
try {
    New-Item -ItemType Directory -Path $Temporary | Out-Null
    $ArchivePath = Join-Path $Temporary $Archive
    if ($UseGitHubCli) {
        & gh release download "v$Version" `
            --repo storious/agulater `
            --pattern $Archive `
            --dir $Temporary
        if ($LASTEXITCODE -ne 0) {
            throw "gh release download failed with exit code $LASTEXITCODE"
        }
    } else {
        Invoke-WebRequest -Uri $Url -OutFile $ArchivePath
    }
    Expand-Archive -LiteralPath $ArchivePath -DestinationPath $Temporary
    New-Item -ItemType Directory -Path $InstallDir -Force | Out-Null
    $Bundle = Join-Path $Temporary "agulater-v$Version-$Platform"
    $Source = Join-Path $Bundle "agulater.exe"
    Copy-Item -LiteralPath $Source -Destination $Destination -Force

    $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $PathEntries = @($UserPath -split ";" | Where-Object { $_ })
    if (-not ($PathEntries | Where-Object { $_.TrimEnd("\") -ieq $InstallDir.TrimEnd("\") })) {
        if ($NoModifyPath) {
            Write-Output "Add $InstallDir to the user PATH"
        } else {
            $UpdatedPath = (@($PathEntries) + $InstallDir) -join ";"
            [Environment]::SetEnvironmentVariable("Path", $UpdatedPath, "User")
            $env:Path = "$env:Path;$InstallDir"
            Write-Output "Added $InstallDir to the user PATH"
        }
    }

    if ($SetupHome) {
        & $Destination setup user --if-missing --home $SetupHome
    } else {
        & $Destination setup user --if-missing
    }
    if ($LASTEXITCODE -ne 0) {
        throw "Agulater user setup failed with exit code $LASTEXITCODE"
    }
    Write-Output "Installed $Destination"
} finally {
    if (Test-Path -LiteralPath $Temporary) {
        Remove-Item -LiteralPath $Temporary -Recurse -Force
    }
}

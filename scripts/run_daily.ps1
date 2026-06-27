$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
Set-Location $ProjectRoot

$BundledPython = "C:\Users\Xavier\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if (Test-Path $BundledPython) {
    & $BundledPython .\runner\run_checks.py
    exit $LASTEXITCODE
}

$PythonCommand = Get-Command python -ErrorAction SilentlyContinue
if ($PythonCommand) {
    & $PythonCommand.Source .\runner\run_checks.py
    exit $LASTEXITCODE
}

$PyCommand = Get-Command py -ErrorAction SilentlyContinue
if ($PyCommand) {
    & $PyCommand.Source .\runner\run_checks.py
    exit $LASTEXITCODE
}

throw "No se encontro Python. Instala Python o actualiza scripts\run_daily.ps1 con la ruta correcta."

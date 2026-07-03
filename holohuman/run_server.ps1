$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$env:HF_HOME = Join-Path $Root ".cache\huggingface"
$env:XDG_CACHE_HOME = Join-Path $Root ".cache\xdg"
$env:PIP_CACHE_DIR = Join-Path $Root ".cache\pip"

New-Item -ItemType Directory -Force -Path $env:HF_HOME, $env:XDG_CACHE_HOME, $env:PIP_CACHE_DIR | Out-Null

$python = "C:\Users\TOM BROWN\AppData\Local\Programs\Python\Python313\python.exe"
& $python -m uvicorn server.main:app --port 8710 --app-dir $Root

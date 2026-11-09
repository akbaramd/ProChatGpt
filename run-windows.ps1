$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
$exe = Join-Path $PSScriptRoot "host\ChatDeskWin\bin\Release\net10.0-windows\ChatDeskWin.exe"
if(-not (Test-Path $exe)) { throw "Windows executable missing. Run: dotnet build host\ChatDeskWin\ChatDeskWin.csproj -c Release" }
if(-not (Test-Path (Join-Path $PSScriptRoot "dist\index.html"))) { throw "React build missing. Run: npm run build" }
Start-Process -FilePath $exe -WorkingDirectory $PSScriptRoot

@echo off
rem Atolye guncelleme: release\ ve release-staging\ icinden HANGISI YENIYSE onu digerine kopyalar,
rem boylece masaustu kisayolu hangi klasoru acarsa acsin en yeni surum calisir.
rem Atolye acikken calismaz (dosyalar kilitli olur); once Atolye'yi kapat.
chcp 65001 >nul
setlocal
set "ROOT=%~dp0.."
rem Masaustune kopyalanmis olabilir: o zaman Atolye klasorunu dogrudan kullan
if not exist "%ROOT%\release" if not exist "%ROOT%\release-staging" set "ROOT=%USERPROFILE%\Desktop\TO DO\Atolye"
tasklist /FI "IMAGENAME eq Atolye.exe" 2>nul | find /I "Atolye.exe" >nul
if not errorlevel 1 (
  echo Atolye su an acik. Once Atolye'yi kapat, sonra bu dosyayi tekrar calistir.
  pause
  exit /b 1
)
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$r='%ROOT%'; $a=Join-Path $r 'release\win-unpacked'; $b=Join-Path $r 'release-staging\win-unpacked';" ^
  "$ta=(Get-Item (Join-Path $a 'resources\app.asar') -ErrorAction SilentlyContinue).LastWriteTime;" ^
  "$tb=(Get-Item (Join-Path $b 'resources\app.asar') -ErrorAction SilentlyContinue).LastWriteTime;" ^
  "if (-not $ta -and -not $tb) { Write-Host ('Surum bulunamadi: ' + $r); exit 1 }" ^
  "if ($ta -ge $tb) { $src=$a; $dst=$b } else { $src=$b; $dst=$a }" ^
  "robocopy $src $dst /MIR /NFL /NDL /NJH /NJS /NP | Out-Null; if ($LASTEXITCODE -ge 8) { Write-Host 'Kopyalama hatasi.'; exit 1 }" ^
  "Write-Host ('Guncellendi: ' + $src); Start-Process (Join-Path $dst 'Atolye.exe')"
if errorlevel 1 (
  pause
  exit /b 1
)
endlocal

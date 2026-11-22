@echo off
rem Atolye guncelleme: release-staging\win-unpacked -> release\win-unpacked (masaustu kisayolunun actigi yer).
rem Atolye acikken calismaz (dosyalar kilitli olur); once Atolye'yi kapat.
chcp 65001 >nul
setlocal
set "ROOT=%~dp0.."
tasklist /FI "IMAGENAME eq Atolye.exe" 2>nul | find /I "Atolye.exe" >nul
if not errorlevel 1 (
  echo Atolye su an acik. Once Atolye'yi kapat, sonra bu dosyayi tekrar calistir.
  pause
  exit /b 1
)
if not exist "%ROOT%\release-staging\win-unpacked\Atolye.exe" (
  echo Yeni surum bulunamadi: release-staging\win-unpacked
  pause
  exit /b 1
)
robocopy "%ROOT%\release-staging\win-unpacked" "%ROOT%\release\win-unpacked" /MIR /NFL /NDL /NJH /NJS /NP >nul
if %ERRORLEVEL% GEQ 8 (
  echo Kopyalama hatasi ^(kod %ERRORLEVEL%^). Hicbir sey silinmedi; tekrar dene.
  pause
  exit /b 1
)
echo Atolye guncellendi. Simdi aciliyor...
start "" "%ROOT%\release\win-unpacked\Atolye.exe"
endlocal

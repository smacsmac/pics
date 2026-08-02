@echo off
rem Lance Photon sous Windows : double-cliquez sur ce fichier.
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js est introuvable. Installez-le depuis https://nodejs.org puis relancez.
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Premiere installation, cela prend une minute...
  call npm install || (echo Installation echouee. & pause & exit /b 1)
)

if not exist "web\dist\index.html" (
  echo Construction de l'interface...
  call npm run build || (echo Construction echouee. & pause & exit /b 1)
)

call npm start
pause

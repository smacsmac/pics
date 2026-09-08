@echo off
rem Bilan de sante de Photon : double-cliquez sur ce fichier.
rem Ce fichier doit garder des fins de ligne CRLF (voir .gitattributes).
setlocal
title Photon - bilan de sante
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if not exist "node_modules\" goto :nodeps

call npm run --silent docteur
goto :end

:nonode
echo.
echo Node.js est introuvable.
echo Installez-le depuis https://nodejs.org (version LTS), puis relancez ce fichier.
goto :end

:nodeps
echo.
echo Les dependances ne sont pas installees.
echo Lancez start.bat une premiere fois, ou tapez : npm install
goto :end

:end
echo.
pause

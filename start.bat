@echo off
rem Lance Photon sous Windows : double-cliquez sur ce fichier.
rem Ce fichier doit garder des fins de ligne CRLF (voir .gitattributes).
setlocal
title Photon
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 goto :nonode

if exist "node_modules\" goto :deps_ok
echo.
echo Premiere installation des dependances, comptez une minute...
call npm install
if errorlevel 1 goto :fail
:deps_ok

if exist "web\dist\index.html" goto :build_ok
echo.
echo Construction de l'interface...
call npm run build
if errorlevel 1 goto :fail
:build_ok

echo.
echo Demarrage de Photon. Laissez cette fenetre ouverte.
echo Pour arreter : Ctrl+C, ou fermez la fenetre.
echo.
call npm start
goto :end

:nonode
echo.
echo Node.js est introuvable.
echo Installez-le depuis https://nodejs.org (version LTS), puis relancez ce fichier.
goto :end

:fail
echo.
echo Echec. Le message d'erreur est affiche juste au-dessus.
goto :end

:end
echo.
pause

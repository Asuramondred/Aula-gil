@echo off
chcp 65001 > nul
cd /d "%~dp0"
title AulaAgil - Generador de Instalador para Windows (.exe)
echo ==========================================================
echo   AulaAgil - Compilador para Windows 10 / 11 (.exe)
echo ==========================================================
echo Carpeta actual: %CD%
echo.

if not exist "package.json" (
  echo [ERROR] No se encontro "package.json" en esta carpeta.
  echo Asegurate de haber DESCOMPRIMIDO todo el archivo ZIP primero
  echo y no ejecutar este archivo desde dentro del ZIP.
  pause
  exit /b 1
)

where node >nul 2>nul
if %errorlevel% neq 0 (
  echo [ERROR] No se encontro Node.js instalado en esta computadora.
  echo Descarga e instala Node.js LTS desde: https://nodejs.org/
  echo Despues vuelve a ejecutar este archivo.
  pause
  exit /b 1
)

echo [1/3] Verificando e instalando dependencias...
call npm install --legacy-peer-deps
if %errorlevel% neq 0 (
  echo [ERROR] Fallo la instalacion de dependencias con npm install.
  pause
  exit /b 1
)

echo.
echo [2/3] Compilando interfaz, servidor local y ejecutable (.exe)...
set CSC_IDENTITY_AUTO_DISCOVERY=false
call npm run electron:build
if %errorlevel% neq 0 (
  echo [ERROR] Fallo la compilacion del ejecutable de Windows.
  pause
  exit /b 1
)

echo.
echo [3/3] Proceso terminado con exito.
echo Tus archivos .exe se encuentran en la carpeta "release":
echo   - AulaAgil Setup 1.0.0.exe (Instalador con acceso directo)
echo   - AulaAgil 1.0.0.exe (Portable)
echo.
explorer "%~dp0release"
pause

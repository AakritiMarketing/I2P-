@echo off
setlocal
title Framewise launcher

rem Change this path if your ComfyUI folder is somewhere else.
set "COMFYUI_DIR=F:\ComfyUI\ComfyUI_windows_portable"
set "PROJECT_DIR=E:\AAKRITI\PROJECTS\IMAGE2PROMPT"

if not exist "%COMFYUI_DIR%" (
  echo ComfyUI was not found at:
  echo %COMFYUI_DIR%
  echo.
  echo Edit COMFYUI_DIR near the top of this file, then try again.
  pause
  exit /b 1
)

if not exist "%COMFYUI_DIR%\run_nvidia_gpu.bat" (
  echo Could not find run_nvidia_gpu.bat in:
  echo %COMFYUI_DIR%
  echo Check the COMFYUI_DIR path in this file.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\package.json" (
  echo Framewise project was not found at:
  echo %PROJECT_DIR%
  pause
  exit /b 1
)

echo Starting ComfyUI...
powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath '%COMFYUI_DIR%\python_embeded\python.exe' -WorkingDirectory '%COMFYUI_DIR%' -ArgumentList '-s','%COMFYUI_DIR%\ComfyUI\main.py','--listen','0.0.0.0'"

echo Waiting for ComfyUI...
timeout /t 8 /nobreak >nul

echo Starting Framewise website...
powershell.exe -NoProfile -NonInteractive -Command "Start-Process -FilePath 'C:\Program Files\nodejs\node.exe' -WorkingDirectory '%PROJECT_DIR%' -ArgumentList 'server.js'"

timeout /t 3 /nobreak >nul
start "" "http://127.0.0.1:3000"

echo.
echo Framewise is starting.
echo Mobile URL: http://100.71.182.111:3000
echo Keep the ComfyUI and Framewise processes running.

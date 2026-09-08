@echo off
setlocal
set "PROJECT_DIR=E:\AAKRITI\PROJECTS\IMAGE2PROMPT"
set "CONTROLLER_TASK=I2P Vision Controller"
set "TAILSCALE_TASK=I2P Tailscale HTTPS"

if not exist "%PROJECT_DIR%\START_CONTROLLER.bat" (
  echo START_CONTROLLER.bat was not found.
  pause
  exit /b 1
)

if not exist "%PROJECT_DIR%\START_TAILSCALE_SERVE.bat" (
  echo START_TAILSCALE_SERVE.bat was not found.
  pause
  exit /b 1
)

schtasks /Create /TN "%CONTROLLER_TASK%" /TR "\"%PROJECT_DIR%\START_CONTROLLER.bat\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
  echo Could not create the startup task.
  echo Try right-clicking this file and choosing Run as administrator.
  pause
  exit /b 1
)

schtasks /Create /TN "%TAILSCALE_TASK%" /TR "\"%PROJECT_DIR%\START_TAILSCALE_SERVE.bat\"" /SC ONLOGON /RL LIMITED /F
if errorlevel 1 (
  echo Controller task created, but Tailscale task could not be created.
  pause
  exit /b 1
)

echo Done. I2P controller and Tailscale HTTPS will start automatically when you sign in.
echo Restart Windows once to test the automatic startup.
pause

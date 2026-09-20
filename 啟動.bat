@echo off
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>&1
if errorlevel 1 (
  echo 找不到 Python。
  echo.
  echo 請先到 https://www.python.org/downloads/ 安裝，
  echo 安裝時務必勾選 Add python.exe to PATH。
  echo.
  pause
  exit /b 1
)

echo 正在安裝／更新套件（第一次可能要幾分鐘）……
python -m pip install -r requirements.txt
if errorlevel 1 (
  echo.
  echo 套件安裝失敗。請確認已安裝 Python，且電腦能連上網路。
  echo.
  pause
  exit /b 1
)

echo.
echo 正在啟動嵌字台……
python app.py
echo.
pause

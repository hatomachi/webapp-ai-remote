@echo off
chcp 65001 > nul
echo ========================================================
echo   AI Remote Bridge Agent (Windows 11)
echo ========================================================
echo.

if not exist .env (
  if exist .env.example (
    echo [.env が見つかりません] .env.example をコピーして .env を作成します...
    copy .env.example .env
    echo .env を作成しました。必要に応じて EC2 の接続先 URL を編集してください。
    echo.
  )
)

echo Agent を起動します...
call npm run agent
pause

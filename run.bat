@echo off
echo ============================
echo   AI Arena - Deploy Script
echo ============================
echo.

set /p msg="Commit message (press Enter for default): "

if "%msg%"=="" (
    set msg=update
)

echo.
echo Adding files...
git add .

echo Committing...
git commit -m "%msg%"

echo Pushing to GitHub...
git push

echo.
echo ============================
echo   Done! Render will redeploy
echo   your app shortly.
echo ============================
echo.
pause

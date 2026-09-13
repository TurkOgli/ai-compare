@echo off
chcp 65001 >nul
echo ============================
echo   AI Arena - Deploy Script
echo ============================
echo.

set /p msg="پیام کامیت رو بنویس (یا خالی بذار و اینتر بزن): "

if "%msg%"=="" (
    set msg=update
)

echo.
echo در حال اضافه کردن فایل‌ها...
git add .

echo در حال ثبت تغییرات...
git commit -m "%msg%"

echo در حال ارسال به گیت‌هاب...
git push

echo.
echo ============================
echo   تمام شد! Render بزودی
echo   نسخه جدید رو دیپلوی می‌کنه.
echo ============================
echo.
pause

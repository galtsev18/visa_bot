@echo off
REM Usage: start-bot.bat <current_date> [target_date] [min_date]
REM Example: start-bot.bat 2024-06-15
REM Example: start-bot.bat 2024-06-15 2024-06-01 2024-05-01

if "%1"=="" (
    echo Usage: start-bot.bat ^<current_date^> [target_date] [min_date]
    echo Example: start-bot.bat 2024-06-15
    pause
    exit /b 1
)

node src/index.js bot -c %1 %2 %3 %4 %5
pause

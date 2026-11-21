@echo off
REM Mantém a ponte do WhatsApp no ar: se cair, volta em 5 s. Registro em %USERPROFILE%\.wco_agente\ponte.log
cd /d "%~dp0"
if not exist "%USERPROFILE%\.wco_agente" mkdir "%USERPROFILE%\.wco_agente"
:loop
node daemon.mjs >> "%USERPROFILE%\.wco_agente\ponte.log" 2>&1
timeout /t 5 /nobreak >nul
goto loop

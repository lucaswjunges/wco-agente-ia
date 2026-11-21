@echo off
REM Inicia a ponte do WhatsApp e o agente de IA da W&Co. Fica no "Inicializar" do Windows (instalar\windows.ps1).
cd /d "%~dp0"
if not exist "%USERPROFILE%\.wco_agente" mkdir "%USERPROFILE%\.wco_agente"
start "Ponte WhatsApp W&Co" /min cmd /c "%~dp0wa\ponte.bat"
timeout /t 10 /nobreak >nul
start "Agente W&Co" cmd /k claude "Comece o turno: siga o CLAUDE.md (primeira vez, se faltar algo; depois o ciclo de atendimento) e mantenha o vigia sempre rodando."

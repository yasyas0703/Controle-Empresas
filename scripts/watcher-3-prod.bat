@echo off
REM ============================================================
REM  ETAPA 3 - PRODUCAO (pasta unica, dia a dia)
REM ============================================================
REM
REM  Modo "esquecer e funcionar":
REM   - Observa a pasta T:\Fiscal\1-ENVIOS
REM   - O pessoal joga as guias la; o sistema identifica por
REM     dentro (OCR), envia e move pra pasta da empresa.
REM   - Sem limite
REM   - Loop com auto-restart: se cair, espera 10s e sobe de novo
REM
REM  COMO USAR:
REM   - Manual: 2 cliques neste arquivo (vai abrir terminal preto
REM     com logs do watcher rolando).
REM   - Automatico no boot: configurar Task Scheduler apontando
REM     pra este arquivo (instrucoes no README ao lado).
REM
REM  COMO PARAR:
REM   - Manual: feche o terminal (X no canto) ou Ctrl+C
REM   - Task: desative a tarefa no Agendador de Tarefas
REM
REM  LOGS:
REM   - Tempo real no terminal (cores)
REM   - Arquivo: scripts\.watcher.log (JSON, persistente)
REM   - State (nao re-envia mesmo PDF): scripts\.watcher-state.json
REM
REM  ============================================================

cd /d "%~dp0.."

:loop
echo.
echo ============================================================
echo  [%date% %time%] Iniciando watcher PROD...
echo  URL: https://controle-empresas.vercel.app
echo  Pasta: T:\Fiscal\1-ENVIOS
echo ============================================================
echo.

node scripts\watcher-guias.mjs --url https://controle-empresas.vercel.app

echo.
echo ============================================================
echo  [%date% %time%] Watcher caiu (exit %errorlevel%).
echo  Reiniciando em 10 segundos... (Ctrl+C pra cancelar)
echo ============================================================
timeout /t 10 /nobreak >nul
goto loop

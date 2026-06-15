@echo off
REM ============================================================
REM  CERTIDOES - OBSERVANDO (continuo, dia a dia)
REM ============================================================
REM
REM  Modo "esquecer e funcionar":
REM   - Fica observando a pasta do mes; conforme os PDFs caem,
REM     ele identifica e grava no Controle Cadastro.
REM   - Sem limite.
REM   - Loop com auto-restart: se cair, espera 10s e sobe de novo.
REM
REM  COMO USAR:
REM   - Manual: 2 cliques (abre terminal preto com logs rolando).
REM   - No boot: Task Scheduler apontando pra este arquivo.
REM
REM  COMO PARAR:
REM   - Feche o terminal (X) ou Ctrl+C.
REM
REM  SEGURO: nunca envia e-mail e nunca mexe nos arquivos da
REM  pasta. So le e cataloga. Idempotente (nao reprocessa).
REM
REM  LOGS / STATE:
REM   - Terminal em tempo real (cores)
REM   - scripts\.watcher-certidoes.log  (persistente)
REM   - scripts\.watcher-certidoes-state.json  (nao reprocessa)
REM
REM  MES: vazio = mes atual (vira sozinho na virada do mes).
REM       Especifico: set MES=2026-07
REM  ============================================================

set MES=
set MESARG=
if not "%MES%"=="" set MESARG=--mes %MES%

cd /d "%~dp0.."

:loop
echo.
echo ============================================================
echo  [%date% %time%] Iniciando watcher de CERTIDOES...
echo  URL: https://controle-empresas.vercel.app
echo  Pasta: T:\Office\PARCELAMENTOS\CERTIDOES
echo ============================================================
echo.

node scripts\watcher-certidoes.mjs --url https://controle-empresas.vercel.app %MESARG%

echo.
echo ============================================================
echo  [%date% %time%] Watcher caiu (exit %errorlevel%).
echo  Reiniciando em 10 segundos... (Ctrl+C pra cancelar)
echo ============================================================
timeout /t 10 /nobreak >nul
goto loop

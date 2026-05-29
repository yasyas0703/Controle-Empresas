@echo off
REM ============================================================
REM  DEV LIMPO - mata processos travados e sobe o servidor local
REM ============================================================
REM
REM  Use isso quando o "npm run dev" nao abrir, travar, ou dar
REM  erro estranho (ex: "Unable to acquire lock", "porta 3000 em
REM  uso", erro de tailwindcss que nao faz sentido).
REM
REM  O que ele faz, em ordem:
REM    1. Mata TODOS os processos node.exe (servidores zumbis que
REM       ficaram presos em memoria de execucoes anteriores)
REM    2. Apaga a pasta .next (cache de build, pode corromper)
REM    3. Sobe o servidor limpo na porta 3000
REM
REM  Depois que abrir, acesse no navegador:
REM    http://localhost:3000/sistema-triar
REM
REM  IMPORTANTE: deixe esta janela ABERTA enquanto usa o sistema.
REM  Se fechar a janela, o servidor cai. Pra parar, e so fechar.
REM
REM  ============================================================

cd /d "%~dp0.."

echo.
echo ============================================================
echo  DEV LIMPO
echo ============================================================
echo.

echo [1/3] Matando processos node travados...
taskkill /F /IM node.exe >nul 2>&1
if errorlevel 1 (
  echo       Nenhum processo node estava rodando. Ok.
) else (
  echo       Processos node finalizados.
)
echo.

echo [2/3] Limpando cache de build (.next)...
if exist ".next" (
  rmdir /s /q ".next"
  echo       Cache .next removido.
) else (
  echo       Nao havia cache .next. Ok.
)
echo.

echo [3/3] Subindo o servidor...
echo.
echo ------------------------------------------------------------
echo  Quando aparecer "Ready", abra no navegador:
echo    http://localhost:3000/sistema-triar
echo.
echo  NAO feche esta janela enquanto estiver usando o sistema.
echo ------------------------------------------------------------
echo.

call npm run dev

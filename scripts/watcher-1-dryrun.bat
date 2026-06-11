@echo off
REM ============================================================
REM  DRY RUN - pasta unica (zero risco, NAO envia email)
REM ============================================================
REM
REM  Roda o watcher em modo simulacao:
REM   - Observa a pasta T:\Fiscal\1-GUIAS A ENVIAR
REM   - Limita a 5 PDFs (--limit 5)
REM   - Sai sozinho (--once)
REM   - MODO --dry-run: NAO chama a API, NAO move, so loga
REM
REM  Use isso pra confirmar que o watcher enxerga a pasta e
REM  detecta os PDFs, sem disparar nada.
REM  ============================================================

cd /d "%~dp0.."

echo.
echo ============================================================
echo  WATCHER - DRY RUN (sem envio, sem mover)
echo  Pasta: T:\Fiscal\1-GUIAS A ENVIAR  ^|  Limite: 5
echo ============================================================
echo.

node scripts\watcher-guias.mjs ^
  --url https://controle-empresas.vercel.app ^
  --limit 5 ^
  --once ^
  --dry-run

echo.
echo ============================================================
echo  TERMINOU. Confira os logs acima.
echo  Pressione qualquer tecla para fechar.
echo ============================================================
pause >nul

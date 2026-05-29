@echo off
REM ============================================================
REM  ETAPA 1 - DRY RUN (zero risco, NAO envia email)
REM ============================================================
REM
REM  Roda o watcher em modo simulacao:
REM   - Filtra so a empresa 2GETHER
REM   - Limita a 5 PDFs (--limit 5)
REM   - Sai sozinho (--once)
REM   - MODO --dry-run: NAO chama a API real, so loga
REM
REM  Resultado: voce ve no terminal exatamente quais PDFs
REM  ele ENVIARIA, sem disparar email pra ninguem.
REM
REM  Use isso pra confirmar:
REM    - watcher consegue ler o T:\Fiscal\EMPRESA\2GETHER\
REM    - detecta os PDFs certos (FECHAMENTO/2026/*.pdf)
REM    - hashes calculados ok
REM
REM  ============================================================

cd /d "%~dp0.."

echo.
echo ============================================================
echo  WATCHER - ETAPA 1 (DRY RUN, sem envio)
echo  Empresa: 2GETHER  ^|  Limite: 5  ^|  URL: prod
echo ============================================================
echo.

node scripts\watcher-guias.mjs ^
  --url https://controle-triar.vercel.app ^
  --empresa 2GETHER ^
  --limit 5 ^
  --once ^
  --dry-run

echo.
echo ============================================================
echo  TERMINOU. Confira os logs acima.
echo  Pressione qualquer tecla para fechar.
echo ============================================================
pause >nul

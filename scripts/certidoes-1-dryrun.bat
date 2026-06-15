@echo off
REM ============================================================
REM  CERTIDOES - DRY RUN (zero risco, so simula)
REM ============================================================
REM
REM  Roda o watcher de CERTIDOES em modo simulacao:
REM   - Le a pasta T:\Office\PARCELAMENTOS\CERTIDOES\<mes>
REM     (+ subpastas FGTS, TRABALHISTA, cndmg)
REM   - Limita a 5 PDFs (--limit 5)
REM   - Sai sozinho (--once)
REM   - MODO --dry-run: NAO chama a API, NAO grava, so loga
REM
REM  Use pra confirmar que ele enxerga a pasta e detecta os PDFs.
REM
REM  MES: deixe vazio = mes atual. Pra um mes especifico, escreva
REM       no formato AAAA-MM (ex.: set MES=2026-07).
REM  ============================================================

set MES=
set MESARG=
if not "%MES%"=="" set MESARG=--mes %MES%

cd /d "%~dp0.."

echo.
echo ============================================================
echo  CERTIDOES - DRY RUN (nao grava, nao envia)
echo  Pasta: T:\Office\PARCELAMENTOS\CERTIDOES   ^|  Limite: 5
echo ============================================================
echo.

node scripts\watcher-certidoes.mjs ^
  --url https://controle-empresas.vercel.app ^
  %MESARG% ^
  --limit 5 ^
  --once ^
  --dry-run

echo.
echo ============================================================
echo  TERMINOU. Confira os logs acima.
echo  Pressione qualquer tecla para fechar.
echo ============================================================
pause >nul

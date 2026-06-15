@echo off
REM ============================================================
REM  CERTIDOES - RODAR O MES (grava no sistema)
REM ============================================================
REM
REM  Este e o do dia a dia: processa o mes e SAI (--once).
REM
REM  Como usar:
REM   1. Garanta que as certidoes do mes estao na pasta:
REM        T:\Office\PARCELAMENTOS\CERTIDOES\<mes>
REM      (+ subpastas FGTS, TRABALHISTA, cndmg)
REM   2. De 2 cliques neste arquivo.
REM   3. Olhe os logs no terminal preto.
REM
REM  O watcher le cada PDF por dentro, descobre a empresa, o tipo
REM  (Federal/Estadual/Municipal/FGTS/Trabalhista), o resultado
REM  (Negativa/PEN/Positiva) e a VALIDADE, e grava no Controle
REM  Cadastro. O que nao casar vira pendencia em
REM  certidoes_auto_problemas (nao some, da pra resolver na mao).
REM
REM  SEGURO POR NATUREZA:
REM   - NUNCA envia e-mail (so cataloga).
REM   - NUNCA move, renomeia ou apaga arquivos da pasta.
REM   - Idempotente: o mesmo PDF nao reprocessa (hash).
REM
REM  MES: vazio = mes atual. Especifico: set MES=2026-07
REM  ============================================================

set MES=
set MESARG=
if not "%MES%"=="" set MESARG=--mes %MES%

cd /d "%~dp0.."

echo.
echo ============================================================
echo  CERTIDOES - RODAR (grava no sistema, NAO envia e-mail)
echo  Pasta: T:\Office\PARCELAMENTOS\CERTIDOES
echo  URL: https://controle-empresas.vercel.app
echo ============================================================
echo.

node scripts\watcher-certidoes.mjs ^
  --url https://controle-empresas.vercel.app ^
  %MESARG% ^
  --once

echo.
echo ============================================================
echo  TERMINOU.
echo   - Certidoes reconhecidas: ja estao no Controle Cadastro.
echo   - Pendencias (empresa nao encontrada etc): ficam em
echo     certidoes_auto_problemas pra resolver na mao.
echo.
echo  Pressione qualquer tecla para fechar.
echo ============================================================
pause >nul

@echo off
REM ============================================================
REM  TESTE REAL - pasta unica (envia email DE VERDADE)
REM ============================================================
REM
REM  Como testar:
REM   1. Coloque uma ou mais guias (PDF) dentro da pasta:
REM        T:\Fiscal\1-ENVIOS
REM   2. De 2 cliques neste arquivo.
REM   3. Olhe os logs no terminal preto.
REM
REM  O watcher le cada PDF por dentro (OCR), descobre a empresa,
REM  o imposto e o mes, e:
REM    - se estiver tudo certo -> ENVIA o email e move a guia
REM      pra pasta da empresa (T:\Fiscal\EMPRESA\<EMPRESA>\...)
REM    - se nao -> move pra subpasta _PENDENTES e registra no
REM      painel /vencimentos-fiscais/auto-problemas
REM
REM  Protecoes que podem segurar o envio (nao manda):
REM   1. Mesmo arquivo ja enviado antes (por conteudo)
REM   2. 1a vez de uma empresa+imposto = vira pendencia pra aprovar
REM   3. Competencia (mes) antiga (> 60 dias) ou no futuro
REM   4. Validacao de PDF (CNPJ / codigo de receita)
REM
REM  --limit 5 = processa no maximo 5 guias.  --once = roda e sai.
REM  ============================================================

cd /d "%~dp0.."

echo.
echo ============================================================
echo  WATCHER - TESTE REAL (envio liberado)
echo  Pasta: T:\Fiscal\1-ENVIOS   ^|  Limite: 5
echo  URL: https://controle-empresas.vercel.app
echo.
echo  Coloque as guias na pasta ANTES de continuar.
echo  Emails REAIS podem sair. Ctrl+C cancela.
echo ============================================================
echo.
pause

node scripts\watcher-guias.mjs ^
  --url https://controle-empresas.vercel.app ^
  --limit 5 ^
  --once

echo.
echo ============================================================
echo  TERMINOU.
echo   - Guias enviadas: foram pra pasta da empresa.
echo   - Guias seguradas/com erro: foram pra _PENDENTES e
echo     aparecem em /vencimentos-fiscais/auto-problemas
echo.
echo  Pressione qualquer tecla para fechar.
echo ============================================================
pause >nul

@echo off
REM ============================================================
REM  ETAPA 2 - TESTE REAL (envia email DE VERDADE)
REM ============================================================
REM
REM  Roda o watcher SEM dry-run:
REM   - Filtra so a empresa 2GETHER
REM   - Limita a 5 PDFs
REM   - Sai sozinho (--once)
REM
REM  ATENCAO: emails REAIS sairao pra 2GETHER (max 5).
REM
REM  Mas o sistema tem 3 protecoes que vao filtrar:
REM   1. 1a vez = nao envia, vira pendencia pra voce aprovar
REM   2. Competencia > 60 dias = nao envia, vira pendencia
REM   3. Validacao de PDF rigorosa (CNPJ, codigo de receita)
REM
REM  Na pratica: na 1a rodada PROVAVELMENTE nada sai por email,
REM  tudo vira pendencia. Voce vai aprovar no painel
REM  /vencimentos-fiscais/auto-problemas e ai sim o email sai.
REM
REM  Confira o painel apos rodar.
REM
REM  ============================================================

cd /d "%~dp0.."

echo.
echo ============================================================
echo  WATCHER - ETAPA 2 (TESTE REAL, envio liberado)
echo  Empresa: 2GETHER  ^|  Limite: 5  ^|  URL: prod
echo.
echo  Emails REAIS podem sair se a empresa+obrigacao ja teve
echo  envio anterior. Caso contrario vira pendencia pra
echo  voce aprovar no painel /vencimentos-fiscais/auto-problemas
echo ============================================================
echo.

REM Pequena confirmacao manual antes de disparar
echo  Pressione CTRL+C pra cancelar agora, ou
pause

node scripts\watcher-guias.mjs ^
  --url https://controle-triar.vercel.app ^
  --empresa 2GETHER ^
  --limit 5 ^
  --once

echo.
echo ============================================================
echo  TERMINOU.
echo.
echo  Proximos passos:
echo   1. Abra https://controle-triar.vercel.app/vencimentos-fiscais
echo   2. Clique na aba "Pendencias Auto"
echo   3. Veja se aparecem as 5 guias (ou as que passaram)
echo   4. Se aparecer botao "Aprovar e enviar", o sistema esta OK
echo.
echo  Pressione qualquer tecla para fechar.
echo ============================================================
pause >nul

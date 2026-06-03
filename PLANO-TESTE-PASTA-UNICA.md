# Plano de teste — Envio de guias por pasta única (identificação por OCR)

Pasta de entrada: `T:\Fiscal\EMPRESA\1-GUIAS A ENVIAR`
Vai do mais seguro (não manda e-mail) pro envio real. Faça na ordem.

---

## 0. Preparação (1 vez)

1. **Dois terminais** abertos na pasta do projeto.
2. **Terminal 1 — servidor:** `npm run dev`
   - Sobe em `http://localhost:3000`. Deixe rodando.
   - Se aparecer aquele erro fantasma de tailwindcss/webpack, é processo node zumbi: feche e rode `dev-limpo.bat`.
3. **No navegador:** abra `http://localhost:3000/sistema-triar`, faça login, e deixe abertas duas abas:
   - `/vencimentos-fiscais/auto-problemas` (painel de pendências)
   - `/vencimentos-fiscais/checklist` (pra ver a célula ficar verde)
4. **Gmail ghost conectado?** Sem isso o envio real falha com `gmail_nao_conectado` (seguro, mas não testa o e-mail). Confira antes do Teste 3.
5. Separe **1–2 PDFs de guia reais** (de `FECHAMENTO` de alguma empresa) pra usar nos testes.

> O watcher, sem `NEXT_PUBLIC_APP_URL` no `.env.local`, aponta pra `http://localhost:3000` — que é o `npm run dev`. Por isso o Terminal 1 precisa estar no ar.

---

## Teste 1 — A seco (detecta o arquivo?)

Não chama a API, não move nada. Só confirma que o watcher enxerga a pasta.

1. **Terminal 2:** `node scripts/watcher-guias.mjs --dry-run --once`
2. Copie **1 PDF** pra `T:\Fiscal\EMPRESA\1-GUIAS A ENVIAR\`.
3. Rode de novo: `node scripts/watcher-guias.mjs --dry-run --once`

**Esperado:** log `Processando <arquivo>.pdf` e `[DRY-RUN] Faria POST...`. O arquivo **continua** na pasta.

---

## Teste 2 — Pipeline sem mandar e-mail (mais seguro)

Exercita identificação + validação + move, **sem incomodar cliente**.
Use uma guia que vá cair numa trava de "não envia":
- empresa+obrigação **já enviada esse mês** (vira `duplicado_periodo`), **ou**
- guia de **competência antiga** (vira `pendente_aprovacao_competencia_antiga`), **ou**
- qualquer guia de empresa **nova no sistema** (vira `pendente_aprovacao_primeira_vez`).

1. **Terminal 2:** `node scripts/watcher-guias.mjs --once --limit 1`
2. Copie o PDF pra pasta de entrada.

**Esperado:**
- Log amarelo/cinza: `pendente_*` ou `duplicado_periodo`, seguido de `Movido pra _PENDENTES`.
- O arquivo **saiu** da entrada e está em `...\1-GUIAS A ENVIAR\_PENDENTES\`.
- Se foi pendência, aparece em `/vencimentos-fiscais/auto-problemas`.
- **Nenhum e-mail saiu.** ✅

---

## Teste 3 — Envio real (controlado) ⚠️

Aqui o e-mail sai **de verdade** pro e-mail de cliente cadastrado da empresa.

**Pra não incomodar cliente real:** use uma **empresa de teste** cujo e-mail de cliente seja o **seu**
(ou troque temporariamente o e-mail de cliente de uma empresa pro seu, em `Detalhes da empresa`).

Pra sair automático, a guia precisa: **não** ser 1ª vez dessa empresa+obrigação **e não** ter sido enviada esse mês.
- Se for **1ª vez**, o sistema segura em `pendente_aprovacao_primeira_vez`. Aí vá em `/vencimentos-fiscais/auto-problemas` e **aprove** → o e-mail sai. (Nesse caminho o arquivo físico fica em `_PENDENTES`; arquive na pasta da empresa na mão.)

1. **Terminal 2:** `node scripts/watcher-guias.mjs --once --limit 1`
2. Copie o PDF pra pasta de entrada.

**Esperado:**
- Log **verde**: `enviado`, seguido de `Arquivado: 2026-05 - <OBRIGAÇÃO>.pdf → T:\Fiscal\EMPRESA\<EMPRESA>\FECHAMENTO\2026\`.
- O **e-mail chega** (no seu endereço, se usou empresa de teste).
- No `/checklist`, a célula da empresa+obrigação fica **verde**.
- O documento aparece no **portal** da empresa.
- O arquivo **não está mais** na entrada — está na pasta da empresa. ✅

---

## Cenários de erro pra testar (opcional, sem e-mail)

Solte cada um e confira que **não envia** e vai pra `_PENDENTES` / painel:
- **Empresa não cadastrada** (CNPJ desconhecido) → `empresa_nao_identificada`.
- **Guia só com a razão social** (sem CNPJ/IE no PDF) → `empresa_match_fraco` (não envia por segurança).
- **Competência no futuro** → `competencia_futura`.
- **PDF escaneado/imagem** (sem texto) → `pdf_ilegivel`.

---

## Reset pra repetir um teste

O sistema é **idempotente por conteúdo (hash)** — soltar o mesmo PDF de novo dá `ja_processado`.
Pra repetir o teste com o mesmo arquivo:
1. Apague a entrada dele em `scripts\.watcher-state.json` (ou apague o arquivo todo; ele se recria).
2. No Supabase, apague a linha em `guias_auto_processadas` com aquele `hash_arquivo`.
3. Se já marcou o checklist, limpe o status na tela `/checklist`.
4. Tire o arquivo de `_PENDENTES` e solte de novo na entrada.

> Mais fácil ainda: use um **PDF diferente** a cada rodada.

---

## Legenda dos status no log do watcher

| Status | Cor | O que aconteceu | Move pra |
|---|---|---|---|
| `enviado` | verde | mandou o e-mail + marcou check | pasta da empresa |
| `interno_marcado_feito` | verde | obrigação interna, só marcou check | pasta da empresa |
| `pendente_correcao` | amarelo | não identificou / validação falhou | `_PENDENTES` + painel |
| `pendente_aprovacao_*` | amarelo | segurou pra aprovação manual | `_PENDENTES` + painel |
| `duplicado_periodo` | cinza | já tinha sido enviada esse mês | `_PENDENTES` |
| `ja_processado` | cinza | mesmo arquivo já enviado antes | `_PENDENTES` |
| `erro_rede` | vermelho | não chegou no servidor (dev caiu?) | **fica na entrada** (re-tenta) |

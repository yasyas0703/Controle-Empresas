# Como funciona o envio automático de guias — de ponta a ponta

Atualizado em 2026-06-08.

## Visão geral

São 3 peças:

1. **Watcher** — um programinha que roda no PC/servidor e vigia a pasta onde a equipe joga as guias.
2. **Sistema na nuvem** (Vercel, `controle-empresas.vercel.app`) — recebe cada guia, descobre de qual empresa/obrigação/mês é, valida e envia.
3. **Destinos** — email do cliente (Gmail), Portal do cliente e o Checklist interno.

O fluxo resumido:

```
Equipe joga o PDF na pasta  →  Watcher detecta  →  manda pro sistema na nuvem
   →  sistema identifica (empresa + obrigação + competência) + valida
   →  envia email pro cliente + publica no Portal + marca o Checklist como feito
   →  watcher arquiva o PDF na pasta da empresa
Se algo não bate em qualquer passo  →  vai pra PENDÊNCIA + dispara ALERTA (sino/email)
```

A identificação é **pelo CONTEÚDO do PDF** (lê o texto de dentro), não pelo nome do arquivo.

---

## Etapa 1 — Watcher (vigia a pasta)

- Observa `T:\Fiscal\EMPRESA\1-GUIAS A ENVIAR` (o caminho é configurável — `FISCAL_ROOT` — pra poder rodar no servidor por caminho de rede).
- Verifica a pasta a cada **30 segundos** (drive de rede não permite detecção instantânea).
- Para cada PDF novo: lê o arquivo, calcula uma "impressão digital" do conteúdo (hash SHA-256) e envia pro sistema na nuvem, autenticando por um token de máquina (`X-Machine-Token`).
- **Idempotência local:** só pula o que já teve desfecho final (enviado/duplicado). O que foi pra **pendência reprocessa** se você re-soltar o arquivo (corrigido hoje).
- **Heartbeat:** "bate ponto" a cada 5 min. Se parar de bater em horário comercial, o sistema avisa que o watcher parou.
- **Resiliência:** tenta de novo (backoff 1s/4s/16s) em falha de rede; após várias falhas seguidas, reinicia sozinho.
- **Arquivamento:** enviado → move pro `T:\Fiscal\EMPRESA\<EMPRESA>\<REGIME>\<ANO>\`; o resto → `_PENDENTES`.

---

## Etapa 2 — Sistema identifica (no servidor)

Ordem de decisão. **Qualquer passo que falha vira PENDÊNCIA** (com alerta), em vez de enviar errado:

1. **Autenticação** (token de máquina) + **rate limit** (20/min, 300/h) — trava watcher em loop.
2. **Idempotência por hash** — se esse PDF (mesmo conteúdo) já foi enviado, não reenvia (proteção contra mandar 2x pro cliente). É por conteúdo: renomear o arquivo não burla.
3. **Extrai o texto** do PDF. Se for imagem/escaneado (sem texto) → pendência `pdf_ilegivel`.
4. **Identifica a EMPRESA** pelo conteúdo:
   - CNPJ ou Inscrição Estadual no PDF = **forte** (envia).
   - Só razão social = **fraco** (não envia sozinho — risco de cliente errado).
   - 2+ empresas com CNPJ/IE no PDF = **ambíguo** (pendência).
5. **Identifica a OBRIGAÇÃO** pelo conteúdo: roda as ~30 regras (`validarGuia`) e vê qual bate. Se mais de uma bate, **desempata pelo código de receita** cadastrado na empresa.
6. **Identifica a COMPETÊNCIA** (mês de referência) — ver seção própria abaixo.
7. **Confere o cadastro da empresa:** a obrigação precisa estar **ATIVA** pra essa empresa. Inativa ou não cadastrada → pendência. *(Isto é cadastro, não erro do sistema.)*
8. **Valida o PDF** de novo no servidor (CNPJ bate, denominação, código de receita).
9. **Trava de competência:** competência no futuro → pendência; mais de 60 dias atrás → pendência de aprovação (evita mandar guia retroativa sem querer).
10. **Trava de duplicado:** se já houve envio com sucesso dessa empresa+mês+obrigação → não reenvia.

---

## Etapa 3 — Envio

Passando em tudo:

- Manda o **email** pro cliente pelo **Gmail do usuário automático (ghost)**, com o PDF anexado e um **pixel de abertura** (é o que faz aparecer "Visualizado" quando o cliente abre o email — corrigido hoje também pro envio automático).
- Marca o **Checklist** como feito, no **mês da competência**.
- Publica no **Portal do cliente** + manda **push** (se a empresa tiver cliente no portal).
- O watcher **arquiva** o PDF na pasta da empresa.

---

## Reconhecimento — o que melhorou hoje

Tudo por conteúdo. Os ajustes de hoje:

- **ISS:** antes casava por pedaço de palavra ("em**iss**ão", "comi**ss**ão") e contaminava quase toda guia → ambiguidade em massa. Agora exige a **palavra inteira** (ISS/ISSQN) ou "imposto sobre serviço", exige a **cidade da empresa** no texto, e **não casa com documento de Simples Nacional** (o DAS lista o ISS por dentro).
- **DIME:** casava com "a**tendime**nto" — agora exige a palavra `DIME`.
- **ST × DIFAL:** são tributos **separados**. ICMS-ST = substituição tributária; DIFAL = "DIFERENCIAL DE ALIQUOTA" (obrigação própria). Renomeados: `ICMS-ST/DIFAL`→**ICMS-ST**, `GIA-ST/DIFAL`→**GIA-ST**.
- **ICMS-ST geral:** passa a pegar "ICMS ST indústria/comércio/saída" (DAE-MG), não só "entradas".
- **GNRE:** quando não traz o período, lê o mês pela **chave da nota fiscal** (em vez de chutar pelo vencimento).
- **DAS (Simples):** recibo, declaração e guia separados.

---

## Competência (mês de referência) — como é lida

Em camadas, da mais confiável pro último recurso:

1. **Intervalo de apuração** ("01 a 31/05/2026") → mês final.
2. **Campo "Mês/Ano de Referência" / "Competência" / "Período de Apuração"** — agora lê tanto com o rótulo antes do valor quanto com o **valor antes do rótulo** (DAE-MG e DARE-SP escrevem assim), sem confundir com a data de vencimento.
3. **Chave da nota fiscal** (GNRE sem período).
4. **Vencimento − 1 mês** — só como último recurso (é um chute).

> A competência é o **período de apuração** (ex: ICMS de maio vence em junho, mas a competência é **maio**). É por isso que o Envio/Checklist abrem no **mês anterior**.

---

## O que ENVIA sozinho × o que vira PENDÊNCIA

**Envia automático** quando: empresa identificada por CNPJ/IE + obrigação reconhecida e **ativa** no cadastro + competência válida + email do cliente cadastrado + Gmail conectado.

**Vira pendência (com alerta)** quando:
- não reconheceu a empresa / ambígua / só por nome;
- não reconheceu a obrigação / ambígua;
- PDF é imagem (sem texto);
- competência no futuro ou muito antiga;
- **obrigação inativa ou não configurada pra empresa** (cadastro);
- empresa sem email cadastrado;
- Gmail do automático desconectado.

**Importante:** pendência não é guia perdida — é o sistema **segurando de propósito** pra não mandar errado, e te **avisando**.

---

## Rede de segurança (pra nada se perder em silêncio)

- Toda guia que trava cria **alerta no sino na hora** + entra no **email-resumo** diário.
- **Heartbeat:** se o watcher parar (PC desligado, drive caiu, token quebrou) em horário comercial, você é avisada.
- **Painel "Auto-problemas"**: lista tudo que travou, com o motivo e o "como resolver".
- *(Em modo teste: os alertas vão só pra você por enquanto.)*

---

## O que depende de CADASTRO (não é bug do sistema)

O envio automático só funciona se o cadastro estiver certo:

1. A **obrigação ativa** por empresa (em "Configurar Obrigações"). Ex: ALTEA estava com ICMS NORMAL inativo; CELEIRO com ICMS-ST inativo; ELEMAR sem ICMS-ST cadastrado → todas caíram em pendência corretamente.
2. **Email do cliente** cadastrado na empresa.
3. **Gmail do ghost** conectado.

Quando falta um desses, o sistema **segura** (pendência) em vez de mandar errado. O caminho pra "não acontecer mais" é deixar os **cadastros completos** — por isso vale a **auditoria de config** (comparar, por empresa, as obrigações que ela recebe guia vs as ativas no cadastro).

---

## Sempre ligado (servidor)

- O watcher é portável (`FISCAL_ROOT` por caminho de rede) pra rodar num servidor 24/7 sem depender de um PC pessoal.
- Há um guia de instalação pra TI: `scripts/DEPLOY-WATCHER-SERVIDOR.md`.

---

## Estado de TESTE atual (reverter quando terminar)

1. **Alertas só pra você** (não vão pra equipe).
2. **Seu email semeado em todas as empresas** — os envios de teste caem no seu Gmail.
3. **bianca@/anapaula@/diego desativados** dos emails de cliente.

Quando for "pra valer", é só pedir que reverto os 3.

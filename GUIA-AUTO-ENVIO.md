# Guia do Auto-Envio de Guias Fiscais

Guia prático pra equipe. O **auto-envio** lê os PDFs que vocês salvam nas pastas
do servidor (`T:\Fiscal\EMPRESA\...`) e manda as guias pros clientes sozinho —
com conferência de PDF e aprovação na primeira vez.

> **Site de produção:** https://controle-empresas.vercel.app
> A URL antiga `controle-triar.vercel.app` **não existe mais**.

---

## 1. O que abrir toda vez que ligar o PC

Abra **um** arquivo, dois cliques:

```
controle-triar\scripts\watcher-3-prod.bat
```

- Vai abrir uma **janela preta** com os logs rolando. **Deixe ela aberta** — é
  ela que vigia as pastas o tempo todo e manda as guias.
- Se a janela cair, ela se reinicia sozinha em 10 segundos.
- Pra parar: feche a janela (X) ou Ctrl+C.

Pronto. Com essa janela aberta, é só salvar as guias nas pastas que o resto
acontece sozinho.

> **Não precisa do site local pra isso.** O watcher fala direto com a produção.
> O `dev-limpo.bat` só serve se você quiser rodar o sistema na sua máquina pra
> desenvolvimento — pro dia a dia, use o site de produção no navegador.

---

## 2. Passo a passo do dia a dia

1. **Abra o `watcher-3-prod.bat`** (se ainda não estiver aberto).
2. **Salve a guia (PDF)** na pasta da empresa, com o nome no padrão (ver seção 3):
   ```
   T:\Fiscal\EMPRESA\<NOME DA EMPRESA>\FECHAMENTO\<ANO>\AAAA-MM OBRIGAÇÃO.pdf
   ```
   (Para Simples Nacional, a pasta é `SIMPLES NACIONAL` no lugar de `FECHAMENTO`.)
3. O watcher detecta em segundos e manda pra conferência.
4. **Acompanhe no painel:**
   https://controle-empresas.vercel.app/vencimentos-fiscais → aba **"Aprovações pendentes"**
   (ou direto em `/vencimentos-fiscais/auto-problemas`).
5. **Aprove** o que estiver pendente. Na **primeira vez** de cada empresa+obrigação
   o sistema sempre pede aprovação. Depois disso, os próximos meses saem automáticos.

---

## 3. Como nomear as guias (a parte mais importante)

O nome do arquivo **tem que começar com a data** (ano-mês), depois o nome da obrigação:

```
AAAA-MM OBRIGAÇÃO.pdf
```

Exemplos certos:

| Nome do arquivo | Lê como |
|---|---|
| `2026-05 ICMS TDD.pdf` | maio/2026 · ICMS TDD |
| `2026-04 PIS.pdf` | abril/2026 · PIS |
| `2026-05 IPI.pdf` | maio/2026 · IPI |
| `2026-04 SPED FISCAL.pdf` | abril/2026 · SPED ICMS/IPI |
| `2026-05 DAS.pdf` | maio/2026 · EMISSÃO GUIA DAS |

Detalhes:
- A data é `ano-mês`: `2026-05` = **maio/2026**, `2026-12` = **dezembro/2026**.
- Pode usar maiúscula, minúscula e acento — o sistema entende.
- Separador pode ser espaço, hífen, underscore ou ponto (`2026-05_ICMS_TDD.pdf` também vale).
- **O que NÃO pode:** o nome começar com outra coisa que não a data. Ex:
  `2GETHER 2026-05 ICMS.pdf` → erro. `ICMS A RECOLHER - TTD.pdf` (sem data) → erro.

### Nomes válidos — Regime Normal

```
ICMS NORMAL      ICMS TDD            SPED ICMS/IPI       IPI
GIA-ST           ICMS-ST             REINF               DARF-SERVIÇOS TOMADOS
PIS              COFINS              SPED CONTRIBUIÇÕES   CSLL
IRPJ             DIFERENCIAL DE ALIQUOTA                  DAPI
DIME             LIVROS FISCAIS      DEMONSTR. APURAÇÃO
ISS - PRESTAÇÃO DE SERVIÇOS          ISS - SERVIÇOS TOMADOS
```

### Nomes válidos — Simples Nacional

```
EMISSÃO GUIA DAS    RECIBO DAS       DECLARAÇÃO DAS      SINTEGRA
DESTDA              ICMS ANTECIPADO  ST ANTECIPADO       DIFERENCIAL DE ALIQUOTA
```

### Apelidos que também funcionam

| Você pode escrever | Vira |
|---|---|
| `SPED FISCAL`, `EFD FISCAL`, `SPED ICMS` | SPED ICMS/IPI |
| `SPED CONTRIB`, `EFD CONTRIBUIÇÕES` | SPED CONTRIBUIÇÕES |
| `DAS`, `GUIA DAS`, `EMISSÃO DAS` | EMISSÃO GUIA DAS |
| `PGDAS`, `RECIBO PGDAS` | RECIBO DAS |
| `DIFAL`, `DIF ALIQ`, `DIF ALIQUOTA` | DIFERENCIAL DE ALIQUOTA |
| `GIA`, `GIA ST` | GIA-ST |
| `ICMS ST`, `ST DIFAL` | ICMS-ST |
| `ISS PRESTADOR` | ISS - PRESTAÇÃO DE SERVIÇOS |
| `ISS TOMADOR`, `ISS TOMADOS` | ISS - SERVIÇOS TOMADOS |
| `REINF`, `EFD REINF` | REINF |

> Essa lista também fica **dentro do sistema**, no topo do painel
> `/vencimentos-fiscais/auto-problemas` (cartão "Como nomear as guias").

---

## 4. Sim — o sistema CONFERE o conteúdo do PDF

Não basta o nome estar certo. Antes de enviar, o servidor **abre o PDF e valida**:

- O **CNPJ** dentro do PDF bate com o cadastro da empresa.
- O **código de receita** bate com o esperado pra aquela obrigação.
- O layout/denominação confere com a obrigação.

Então, se você pegar um **ICMS Normal** e salvar com o nome `2026-05 ICMS TDD.pdf`,
o sistema **vai recusar** (vira pendência "PDF não confere com a empresa/obrigação").
Isso é de propósito — é a proteção contra mandar a guia errada pro cliente.

---

## 5. Quando ele envia sozinho × quando pede aprovação

O envio automático só dispara o e-mail se passar por **tudo**:

1. Empresa reconhecida pela pasta
2. Nome no padrão (data + obrigação válida)
3. Obrigação **configurada e ativa** pra empresa (em "Configurar Obrigações")
4. PDF passa na validação (CNPJ + código de receita)
5. Competência com **menos de 60 dias**
6. **Não é a 1ª vez** dessa empresa+obrigação (a 1ª sempre pede aprovação)
7. Ainda não foi enviada antes (sem duplicado)

Se qualquer um falhar, **nada é perdido** — vira pendência no painel com o motivo
exato, pra você corrigir ou aprovar na mão.

---

## 6. Checagem agressiva — bateria de testes

Use a empresa de teste (com **o seu e-mail** cadastrado como cliente, pra a guia
chegar pra você e não pro cliente real). Faça um de cada e confira o resultado no
painel `/vencimentos-fiscais/auto-problemas`.

> **IMPORTANTE pra testar:** o sistema **não reprocessa o mesmo arquivo** (ele guarda
> por caminho + conteúdo). Pra refazer um teste, **mude o nome** do arquivo ou troque
> o PDF. Senão ele responde "já processado" e não faz nada.

| # | O que fazer | Resultado esperado |
|---|---|---|
| 1 | Guia certa, nome certo, obrigação configurada, competência recente, **1ª vez** | Pendência **"primeira vez"** → você aprova → e-mail sai |
| 2 | Repetir a mesma obrigação, **outro mês** (depois de já ter aprovado a 1ª) | **Envia automático** (e-mail direto, sem pendência) |
| 3 | Nome **sem data** (ex: `ICMS TDD.pdf`) | Pendência **"nome fora do padrão"** |
| 4 | Obrigação **inventada** (ex: `2026-05 BANANA.pdf`) | Pendência **"obrigação não reconhecida"** |
| 5 | **ICMS Normal** salvo com nome `2026-05 ICMS TDD.pdf` (PDF não bate) | Pendência **"PDF não confere"** (prova que lê o PDF) |
| 6 | Salvar numa pasta de empresa que **não existe** no cadastro | Pendência **"empresa não cadastrada"** |
| 7 | Competência **antiga** (ex: `2025-01 ICMS TDD.pdf`) | Pendência **"competência > 60 dias"** |
| 8 | Soltar **o mesmo arquivo** de novo, sem mudar nada | **"já processado"** — ignora, não duplica |
| 9 | Obrigação **interna** (ex: `2026-05 SPED FISCAL.pdf`, se marcada "não envia ao cliente") | Marca como feito, **NÃO manda e-mail** |
| 10 | Obrigação **não configurada** pra aquela empresa | Pendência **"obrigação não configurada"** |

Se todos derem o resultado esperado, o auto-envio está redondo.

---

## 7. Se algo der errado

| Sintoma | O que fazer |
|---|---|
| Salvei a guia e nada aconteceu | A janela do `watcher-3-prod.bat` está aberta? Sem ela, ninguém vigia. |
| "nome fora do padrão" | O nome tem que **começar** com `AAAA-MM`. Renomeie e salve de novo. |
| "empresa não cadastrada" | O nome da pasta no `T:\` tem que bater com o apelido da empresa no cadastro. |
| "PDF não confere" | É proteção: o CNPJ/código no PDF não bate. Confira se o PDF é o certo. |
| O site não abre / dá erro estranho no **local** | Use o `dev-limpo.bat` (mata travas e reinicia). Mas no dia a dia use a produção. |
| Re-testar o mesmo arquivo não faz nada | Mude o nome ou o PDF — ele não reprocessa arquivo já visto. |

---

*Dúvida sobre nomes? O cartão "Como nomear as guias" no topo do painel de
pendências tem a lista sempre atualizada.*

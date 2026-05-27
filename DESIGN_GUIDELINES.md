# DESIGN_GUIDELINES.md

Guia de design do **Controle Triar** (sistema interno + portal do cliente). Vale para tema claro e escuro. **Tudo deve passar por tokens centrais** (`src/app/globals.css`). Cor, fonte, raio, sombra e espaçamento hardcoded espalhados em componentes são tratados como bug.

---

## 0. Stack e onde os tokens vivem

- **Tailwind v4** (config-less, via `@theme inline { ... }` em [src/app/globals.css](src/app/globals.css)). Não existe `tailwind.config.js`.
- **Tokens de tema**: CSS custom properties em `:root` e `.dark` no mesmo `globals.css`.
- **Fontes**: injetadas em [src/app/layout.tsx](src/app/layout.tsx) via `next/font/google`.
- **Tema dark**: classe `.dark` no `<html>` (gerenciada por `src/app/context/ThemeContext.tsx`). Toda regra dark deve usar o variant `dark:` ou seletor `.dark` — nunca `@media (prefers-color-scheme)`.

Toda alteração de paleta/tipografia deve ser feita em **um único lugar** (`globals.css` + `layout.tsx`). Se você precisar mudar a marca pra azul, deve ser uma linha — não 40 arquivos.

---

## 1. Princípio central

> A tela é 90% neutra (cinzas). Cor só aparece quando significa algo. Hierarquia se cria por tamanho/peso de fonte e por neutros, não por encher de cor.

Antes de pintar qualquer coisa, pergunte: **isso comunica um estado (erro/aviso/sucesso) ou uma ação primária?** Se a resposta for não, é cinza.

---

## 2. Paleta

### 2.1. Neutros (a base de tudo)

Escala de cinza de 11 passos. **A maior parte do app vive aqui.** Não use `gray-X` ou `slate-X` do Tailwind diretamente — use os tokens.

| Token              | Light       | Dark        | Uso                                          |
| ------------------ | ----------- | ----------- | -------------------------------------------- |
| `--surface-0`      | `#ffffff`   | `#0e0f12`   | Fundo da página (NÃO usar preto puro no dark) |
| `--surface-1`      | `#f7f8fa`   | `#15171c`   | Áreas levemente recuadas, header de tabela   |
| `--surface-2`      | `#ffffff`   | `#1a1d23`   | Cards, modais, sidebar                       |
| `--surface-3`      | `#f1f3f6`   | `#22262e`   | Hover de cards/linhas                        |
| `--border-subtle`  | `#eceef2`   | `#262a32`   | Borda quase invisível (zebras, divisores)    |
| `--border`         | `#dde0e6`   | `#2f343d`   | Borda padrão de cards/inputs                 |
| `--border-strong`  | `#c4c9d2`   | `#3d434f`   | Borda de hover/focus em inputs               |
| `--text-1`         | `#0d1014`   | `#eef0f4`   | Texto principal                              |
| `--text-2`         | `#3a4150`   | `#b8bdc7`   | Texto secundário                             |
| `--text-3`         | `#6b7280`   | `#878d99`   | Texto terciário, labels                      |
| `--text-muted`     | `#9aa0ac`   | `#5e6470`   | Placeholders, metadados                      |

### 2.2. Marca (ciano) — uso pontual

| Token             | Light      | Dark       | Uso                                                        |
| ----------------- | ---------- | ---------- | ---------------------------------------------------------- |
| `--brand`         | `#0891b2`  | `#22d3ee`  | Texto/ícone do item ativo, link, valor de destaque         |
| `--brand-strong`  | `#0e7490`  | `#06b6d4`  | Hover/focus de link, botão primário                        |
| `--brand-soft`    | `#ecfeff`  | `#0c3a44`  | **Raríssimo.** Faixa lateral de item ativo, fundo de chip de marca |

Regras:
- **Botão primário = sólido `--brand`**, branco em cima. Nunca gradiente.
- **Item de menu ativo = barra lateral fina + texto/ícone em `--brand`**. NÃO fundo retangular tingido.
- **No máximo um destaque de marca por bloco visível.** Se a tela inteira tem ciano, o ciano deixa de destacar.

### 2.3. Funcionais (apenas com significado, nunca decoração)

| Token         | Light      | Dark       | Significado          |
| ------------- | ---------- | ---------- | -------------------- |
| `--danger`    | `#dc2626`  | `#f87171`  | Erro, vencido        |
| `--danger-soft` | `#fef2f2` | `#3a1a1f` | Faixa/banner de erro |
| `--warn`      | `#d97706`  | `#fbbf24`  | Atenção, vence em breve |
| `--warn-soft` | `#fffbeb`  | `#352a10`  | Faixa/banner de aviso |
| `--ok`        | `#16a34a`  | `#4ade80`  | Sucesso, ok          |
| `--ok-soft`   | `#f0fdf4`  | `#0e2820`  | Faixa/banner de sucesso |
| `--info`      | `#2563eb`  | `#60a5fa`  | Informação neutra (raro — prefira `--text-2`) |

Regras:
- Use a cor da letra/ícone (`--danger`) sobre fundo neutro. O **soft só entra em banners**, nunca em ícones soltos ou textos.
- Tabelas com muitas linhas: pinte texto/badge da coluna de status, **não a linha inteira**.

### 2.4. Proibições absolutas

- **Gradiente em qualquer elemento** — botão, header, ícone, badge, card, banner. Cor é sólida, sempre.
- **Gradiente roxo→azul, violet→fuchsia, purple→pink** (clichê de IA).
- **Roxo / violeta / lavanda / fuchsia / pink / indigo / orange** como cor decorativa. Não existem na paleta. Cyan da marca + funcionais (`danger`/`warn`/`ok`) + neutros. Fim.
- **Tons departamentais únicos** (fiscal em vermelho-laranja, pessoal em violeta, contábil em azul, cadastro em amarelo). Departamento é texto/label, não cor de fundo.
- **Emojis em títulos, KPIs ou banners.** Ícones vão de Lucide (já instalado).

---

## 3. Tipografia

### 3.1. Famílias

| Token         | Família                          | Uso                                  |
| ------------- | -------------------------------- | ------------------------------------ |
| `--font-sans` | Space Grotesk, system-ui, sans   | Tudo (UI, títulos, labels, parágrafos) |
| `--font-mono` | JetBrains Mono, ui-monospace     | Números (datas, CNPJ, contadores, códigos de receita, valores R$), IDs, status fiscal |

Carregamento: `next/font/google` em [src/app/layout.tsx](src/app/layout.tsx). **Substitui `Geist` e `Geist_Mono` que estão lá hoje.**

Proibido: Inter, Geist, Plus Jakarta Sans, Roboto, Arial fallback. O fallback no `body` (`Arial, Helvetica, sans-serif`) precisa ser removido — deixa `var(--font-sans)` dominar.

### 3.2. Numéricos com mono

Toda **sequência de dígitos que existe em coluna ou em comparação visual** vai em `--font-mono` com `font-variant-numeric: tabular-nums`:

- CNPJ: `00.000.000/0000-00`
- Datas: `26/05/2026`
- Contadores: `127 empresas`, `3d restantes`, `5/12`
- Valores: `R$ 1.234,56`
- Códigos: `5952`, `IRPF`, `DAS-MEI`

Use a classe utilitária `.ct-num` (a definir em `globals.css`).

### 3.3. Escala

| Token       | Tamanho   | Line-height | Uso                                          |
| ----------- | --------- | ----------- | -------------------------------------------- |
| `text-xs`   | 12px      | 16px        | Labels de campo, metadados                   |
| `text-sm`   | 13px      | 18px        | Texto base de UI (linhas de tabela, botões)  |
| `text-base` | 14px      | 20px        | Parágrafos em modais                         |
| `text-md`   | 16px      | 22px        | Subtítulos                                   |
| `text-lg`   | 18px      | 24px        | Título de página secundária                  |
| `text-xl`   | 22px      | 28px        | Título de página principal                   |
| `text-2xl`  | 28px      | 34px        | KPIs (ex: `127` empresas no dashboard)        |

Hierarquia se faz com **peso (500 / 600 / 700) + tamanho + cor neutra**. Não com caixa colorida atrás.

### 3.4. Pesos

- `font-normal` (400): parágrafos
- `font-medium` (500): texto de UI padrão (linhas de tabela, valores em mono)
- `font-semibold` (600): labels, nomes de coluna
- `font-bold` (700): títulos, botão primário, dado principal de KPI

**Não use `font-extrabold` (800) nem `font-black` (900).** Faz parecer marketing, não SaaS. Hoje têm 20+ ocorrências — vão sair.

---

## 4. Forma — raio, sombra, espaçamento

### 4.1. Border radius (radius gordo é clichê)

| Token         | Valor   | Uso                                              |
| ------------- | ------- | ------------------------------------------------ |
| `--radius-sm` | `3px`   | Badge, chip, tag                                 |
| `--radius`    | `5px`   | Botão, input, card                               |
| `--radius-md` | `8px`   | Modal, sidebar (raríssimo, só onde precisa)      |
| `--radius-full` | `9999px` | **Apenas** para avatar/ícone circular e dot indicator |

**Máximo 6px em qualquer container.** `rounded-xl` (12px), `rounded-2xl` (16px), `rounded-3xl` (24px) saem do app. Hoje têm **783 ocorrências** dessas classes.

### 4.2. Sombras (estrutura por borda, não por sombra)

| Token           | Valor                                       | Uso                                                |
| --------------- | ------------------------------------------- | -------------------------------------------------- |
| `--shadow-none` | `none`                                      | **Padrão de tudo.**                                |
| `--shadow-sm`   | `0 1px 2px rgba(0,0,0,0.04)`                | Header de tabela fixo, dropdown                    |
| `--shadow-pop`  | `0 8px 24px rgba(0,0,0,0.12)`               | Modal, popover, painel de notificação              |

**Cards não têm sombra.** Cards têm borda de 1px (`--border`). Hoje têm 63 sombras grandes (`shadow-lg/xl/2xl`) que vão sair.

### 4.3. Espaçamento (grid de 4px)

Use os tokens do Tailwind diretamente: `gap-1` (4px), `gap-2` (8px), `gap-3` (12px), `gap-4` (16px), `gap-6` (24px), `gap-8` (32px). Nada de gap-5/7/9.

- Padding interno de card: `p-4` ou `p-5`.
- Padding lateral de página: `px-4` (mobile) / `px-6` (desktop).
- Padding vertical de linha de tabela: `py-2.5`.

---

## 5. Componentes — padrões obrigatórios

Todos viram **classes utilitárias `@layer components` em `globals.css`**, prefixadas `ct-` para não colidir com Tailwind. Componentes existentes consomem essas classes em vez de re-implementar o estilo.

### 5.1. Sidebar

- Fundo `--surface-2`, borda direita `--border` (1px). Sem sombra.
- Item padrão: ícone + label em `--text-2`. Sem fundo.
- Hover: texto `--text-1`, fundo `--surface-3`.
- **Item ativo**: barra vertical fina à esquerda (3px) em `--brand`, ícone+texto em `--brand`. **Sem fundo arredondado tingido.**
- Item ativo de vencimentos vencidos: barra em `--danger`, texto em `--danger`. Sem fundo.

### 5.2. Botões

| Classe          | Aparência                                                                 |
| --------------- | ------------------------------------------------------------------------- |
| `.ct-btn-primary` | Fundo `--brand`, texto branco. Hover: `--brand-strong`. **Sem gradiente, sem shadow-lg.** |
| `.ct-btn-secondary` | Fundo `--surface-2`, borda `--border`, texto `--text-1`. Hover: fundo `--surface-3`. |
| `.ct-btn-ghost`   | Sem borda, sem fundo. Texto `--text-2`. Hover: fundo `--surface-3`.        |
| `.ct-btn-danger`  | Fundo `--danger`, texto branco. Hover: escurece 10%. Só para ações destrutivas. |

- Radius `--radius` (5px). Sem `shadow-md`. Tipografia `font-semibold text-sm`.
- Botão primário é único por tela (geralmente). Mais de um botão primário = nenhum botão primário.

### 5.3. Inputs

`.ct-input`: fundo `--surface-2`, borda 1px `--border`, radius `--radius`, padding `px-3 py-2.5`. Focus: borda `--brand`, **sem box-shadow grande** (`0 0 0 1px --brand` no máximo).

Hoje muitos inputs usam `rounded-xl bg-gray-50 ... focus:ring-2 focus:ring-cyan-400` — vai sair.

### 5.4. Cards

- `.ct-card`: fundo `--surface-2`, borda 1px `--border`, radius `--radius`, padding `p-4`/`p-5`. **Sem sombra.**
- Blocos repetidos do mesmo tipo (ex.: responsáveis Pessoal/Fiscal/Contábil/Cadastro nos detalhes da empresa) usam **todos o mesmo fundo neutro**. A diferença é só o label (`text-xs uppercase text-text-3 font-semibold`), nunca a cor.
- Ícones de label (CNPJ, Local, Docs, Regime) em `--text-3`, não em cor.
- Badges de código/ID (`5952`, `IRPF`) em fundo `--surface-3`, texto `--text-2`, mono. **Não em ciano.**

### 5.5. Badges / chips

| Classe              | Fundo         | Texto         | Quando                  |
| ------------------- | ------------- | ------------- | ----------------------- |
| `.ct-badge`         | `--surface-3` | `--text-2`    | Padrão (códigos, ID)    |
| `.ct-badge-brand`   | `--brand-soft`| `--brand-strong` | Marca (raro)         |
| `.ct-badge-danger`  | `--danger-soft` | `--danger`  | Vencido                 |
| `.ct-badge-warn`    | `--warn-soft` | `--warn`      | Vence em X dias         |
| `.ct-badge-ok`      | `--ok-soft`   | `--ok`        | Enviado, ok             |

Radius `--radius-sm` (3px). Tipografia `text-xs font-semibold uppercase tracking-wide`.

### 5.6. Banners / alertas

`.ct-banner`: fundo `--surface-2`, **faixa lateral esquerda de 3px** na cor do nível, ícone discreto à esquerda, texto à direita. Sem fundo tingido pesado, sem glow, sem gradient.

Variantes: `.ct-banner-danger`, `.ct-banner-warn`, `.ct-banner-ok`, `.ct-banner-info`.

A animação `animate-alert-banner` (pulsing red com `box-shadow` grande, hoje em `globals.css`) **sai**. Para vencidos críticos, a faixa lateral em `--danger` + texto em mono em `--danger` já comunica.

### 5.7. Tabelas

- `.ct-table`: largura 100%, linhas com `border-bottom: 1px solid --border-subtle`.
- Header: fundo `--surface-1`, texto `--text-3 font-semibold uppercase text-xs tracking-wide`. **Sem gradiente** (hoje há `bg-gradient-to-r from-teal-50 to-cyan-50` em `historico/page.tsx`).
- Linhas: hover `--surface-3`. Zebra desligada por padrão — só ligar em tabelas muito longas, com `--surface-1`.
- Colunas de número: `.ct-num text-right`.
- Coluna de status: badge da seção 5.5, **não pinte a linha inteira**.

### 5.8. Modais

- `ModalBase`: fundo `--surface-2`, radius `--radius-md` (8px), **shadow-pop** apenas. Sem `shadow-2xl`.
- Header de modal: sem gradient, sem cor. Título em `font-bold text-md`, descrição em `text-sm text-text-2`. Botão de fechar em `--text-3`.
- Hoje `ModalLimiares`, `ModalAdicionarDocumento`, `ModalEmailsCliente`, etc. têm headers com gradient colorido — todos saem.

### 5.9. KPI / números grandes

- Valor em `.ct-num font-bold text-2xl text-text-1`.
- Label embaixo: `text-xs uppercase tracking-wide text-text-3 font-semibold`.
- Variação (delta): badge `.ct-badge-ok` / `.ct-badge-danger` com seta Lucide. Tamanho pequeno.
- **Sem ícone gigante colorido em cima** (hoje vários KPIs têm um `h-12 w-12 rounded-2xl bg-gradient-to-br from-teal-500 to-cyan-500` — sai).

### 5.10. Login / autenticação

- Card de login centrado, `.ct-card` puro, sem header colorido.
- Logo em cima em tamanho moderado.
- Botão `Entrar` é `.ct-btn-primary` sólido em `--brand`. Hoje é `bg-gradient-to-r from-cyan-600 to-teal-600` em [src/app/components/AppShell.tsx:814](src/app/components/AppShell.tsx#L814) e em [src/app/components/AppShell.tsx:843](src/app/components/AppShell.tsx#L843) — sai.

---

## 6. Tema claro vs. dark

### 6.1. Light

- Fundo de página `--surface-0` (branco) ou `--surface-1` (off-white levíssimo) — **não** `bg-gray-100` como hoje.
- Estrutura por **borda 1px `--border`**, não por cards flutuando com sombra.
- Texto principal em `--text-1` (quase preto, 0d1014). Não usar preto puro.

### 6.2. Dark

- Fundo de página `--surface-0` = `#0e0f12` (**não preto puro**, não `#000`).
- Cards em `--surface-2` = `#1a1d23` (um degrau mais claro que o fundo). Separados do fundo por **borda**, não por sombra.
- Texto principal `--text-1` = `#eef0f4` (não branco puro #fff — dói a vista em dark).
- O bloco gigantesco de overrides em `globals.css` (linhas ~89 a 416) que mapeia `bg-blue-100`, `bg-purple-200`, etc. — **desaparece**. Se nenhuma página usa `bg-purple-200`, não precisa de override.

---

## 7. Consistência operacional

- **Tudo via tokens.** Mudar `--brand` em `globals.css` deve refletir o sistema inteiro.
- **Zero classes Tailwind tinted decorativas em componentes** (`bg-purple-*`, `text-violet-*`, `from-orange-*`, `to-fuchsia-*`). As únicas exceções são as cinzentas (`bg-gray-50` etc.) que são neutralizadas no globals até a migração terminar.
- **Zero cor hex inline em `.tsx` ou em `style={{...}}`** fora de `globals.css`. Hoje há 81 ocorrências espalhadas — todas migram para tokens.
- **Componente novo? Use uma das classes `.ct-*` existentes.** Se nenhuma serve, defina uma nova em `globals.css` antes de aplicar no componente.

---

## 8. Hot spots a corrigir manualmente (hoje têm clichê de IA hardcoded)

Esses arquivos têm gradientes/cores decorativas inline que **não saem só com neutralização global** — precisam de edição direcionada:

- [src/app/components/AppShell.tsx](src/app/components/AppShell.tsx) — header e botões do modal de login com gradient cyan→teal; sininho usa `text-cyan-600` direto.
- [src/app/components/BotaoTarefas.tsx](src/app/components/BotaoTarefas.tsx) — botão com gradient `violet-600 → fuchsia-600`.
- [src/app/components/ModalLimiares.tsx](src/app/components/ModalLimiares.tsx) — header gradient `violet-500 → purple-600`.
- [src/app/components/ModalEmailsCliente.tsx](src/app/components/ModalEmailsCliente.tsx) — header gradient `indigo-500 → blue-600`.
- [src/app/components/ModalAdicionarDocumento.tsx](src/app/components/ModalAdicionarDocumento.tsx) — header gradient `orange-500 → orange-600`.
- [src/app/components/DepartamentoPlaceholder.tsx](src/app/components/DepartamentoPlaceholder.tsx) — três gradientes diferentes por departamento.
- [src/app/vencimentos-fiscais/FiscalTabs.tsx](src/app/vencimentos-fiscais/FiscalTabs.tsx) — gradient por aba.
- [src/app/vencimentos-fiscais/page.tsx](src/app/vencimentos-fiscais/page.tsx) — ícone-banner com `red-500 → orange-500 → amber-500`.
- [src/app/vencimentos-fiscais/checklist/page.tsx](src/app/vencimentos-fiscais/checklist/page.tsx) — botão SN com `purple → fuchsia → pink`, modal com `violet → purple`, modal com `amber → orange`.
- [src/app/vencimentos-fiscais/envio/page.tsx](src/app/vencimentos-fiscais/envio/page.tsx) — ícone-banner com `indigo-600 → indigo-800`.
- [src/app/empresas/page.tsx](src/app/empresas/page.tsx), [src/app/historico/page.tsx](src/app/historico/page.tsx), [src/app/lixeira/page.tsx](src/app/lixeira/page.tsx), [src/app/hoje/page.tsx](src/app/hoje/page.tsx), [src/app/dev/importar-extratos-contabil/page.tsx](src/app/dev/importar-extratos-contabil/page.tsx), [src/app/dev/importar-cliente-desde/page.tsx](src/app/dev/importar-cliente-desde/page.tsx) — KPIs e CTAs com gradientes cyan/teal/red/violet.

---

## 9. Métricas de "dívida visual" antes da refatoração

(Baseline tirado em 2026-05-26, vão pra zero ao final.)

| O que                                                      | Ocorrências | Arquivos |
| ---------------------------------------------------------- | ----------- | -------- |
| `bg-gradient-to-*` em componentes                          | 124         | 44       |
| Cores decorativas proibidas em gradientes (purple/violet/fuchsia/pink/orange/indigo) | 53          | 18       |
| `rounded-xl` / `rounded-2xl` / `rounded-3xl`               | ~783        | 60       |
| `shadow-lg` / `shadow-xl` / `shadow-2xl`                   | 63          | 37       |
| Hex hardcoded em `.ts(x)` fora de `globals.css`            | 81          | 11       |
| `font-extrabold` / `font-black`                            | (a contar)  | -        |

---

## 10. Resumo curto (one-liner de cada regra)

1. Tela = 90% cinza. Cor = significado.
2. Marca é **só ciano**, em destaque pontual.
3. Funcional = vermelho/amarelo/verde, **apenas** com semântica.
4. **Zero gradiente.** Em nada.
5. **Zero roxo/violeta/laranja/pink/indigo decorativo.**
6. Fontes: **Space Grotesk + JetBrains Mono**. Não Inter/Geist/Jakarta.
7. Números em mono com `tabular-nums`.
8. Radius máximo 6px. `rounded-xl+` sai.
9. Cards: borda 1px, sem sombra.
10. Item de menu ativo: barra lateral, **não** fundo arredondado.
11. Banner: faixa lateral 3px na cor do nível + fundo neutro.
12. Dark: cinza escuro (`#0e0f12`), nunca preto puro.
13. Botão primário: cor sólida da marca, único por tela.
14. Tudo via tokens em `globals.css`. Cor hex inline = bug.

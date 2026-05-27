# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Comandos

```bash
npm run dev      # dev server (Turbopack) em http://localhost:3000
npm run build    # build de produção
npm run start    # roda o build
npm run lint     # eslint (config: eslint-config-next + globalIgnores em eslint.config.mjs)
```

Scripts utilitários rodam com `tsx` (`.ts`) ou `node` (`.mjs`) — não há test runner configurado neste projeto. Para rodar um script único:

```bash
npx tsx scripts/auto-detectar-guias.ts --mes 2026-05 --empresa "2GETHER"
node scripts/seed-codigos-receita.mjs
```

Migrations Supabase são arquivos `supabase-migration-*.sql` na raiz — rodados manualmente no SQL Editor do Supabase. **Não há ferramenta de migration automática**. Antes de mexer em schema, verifique se existe um arquivo de migration correspondente e aplique-o no banco antes de testar.

## Arquitetura — visão geral

App Next.js 16 (App Router) com **dois sub-apps no mesmo deploy**, separados por rota e por contexto React:

1. **Sistema interno (staff)** — `/dashboard`, `/empresas`, `/vencimentos*`, etc. Usa `SistemaProvider` (`src/app/context/SistemaContext.tsx`) com fetches grandes (empresas, usuários, logs). Renderizado com `AppShell` (sidebar, notificações, modais).
2. **Portal do cliente (PWA)** — `/portal/*`. Usa `PortalProvider` próprio (`src/app/portal/PortalContext.tsx`), tem `portal-manifest.json` e `portal-sw.js`. **Pula `SistemaProvider`** (ver `src/app/providers.tsx`) — não carregue contexto do sistema interno em rotas `/portal`.

A separação importa: as rotas `/portal/*` são públicas; o resto do app está atrás do gate em `src/proxy.ts`.

### Gate de acesso ao sistema interno (`src/proxy.ts`)

Middleware (chamado `proxy` neste repo) que executa em todas as rotas exceto static. Comportamento:

- **Cookie `triar-staff=1` obrigatório** para qualquer rota não-pública. Sem cookie → devolve **404 HTML mínimo** (não renderiza AppShell, não revela nada do app). APIs sem cookie → 404 JSON.
- **Única porta de entrada visível**: `/sistema-triar`. Após login, `SistemaContext` seta o cookie `triar-staff`.
- **Rotas públicas** (não exigem cookie): `/portal/*`, `/api/portal/*`, `/sistema-triar/*`, `/api/auth/*` (OAuth callbacks), `/api/cron/*` (autenticadas via `CRON_SECRET`), `/api/checklist-fiscal/track-open/*` (pixel de email — capability token via UUID), `/api/admin/manutencao` (GET).
- **Rotas `/api/admin/*`** exigem header `Authorization: Bearer <token>` adicional (além do cookie).
- A rota raiz `/` chama `notFound()` propositalmente — não é entry point.

Ao adicionar uma rota nova, decida se ela precisa do gate de staff ou se é pública (portal/cron/webhook) e ajuste `isPublicPath` em `src/proxy.ts`.

### Camada Supabase (três clientes distintos)

- `src/lib/supabase.ts` — client **anônimo** (browser). Usa `localStorage` com `storageKey: 'controle-triar-auth'` e fallback pra memória se localStorage estiver bloqueado. Acesso via export `supabase` (Proxy lazy — só instancia quando usado).
- `src/lib/supabaseAdmin.ts` — `getSupabaseAdmin()` com **service-role key**. Só pode ser importado em API routes (server-side). Bypassa RLS.
- `src/lib/supabasePortal.ts` — client dedicado pra rotas do portal do cliente (auth/storage separados).

**Nunca importe `supabaseAdmin` em código que roda no browser.** Toda chamada que usa service role precisa estar em `/api/*` e validar o usuário via `autenticarRequest` (ex: `src/app/api/checklist-fiscal/_shared.ts`).

### Estado global (sistema interno)

`SistemaContext` é a fonte única de verdade no client: empresas, usuários, departamentos, serviços, notificações, user logado. Toda mutação passa por funções de `src/lib/db.ts`, que:

- Convertem rows snake_case do Postgres → tipos camelCase de `src/app/types.ts`.
- Têm **fallback de coluna ausente** (`hasMissingColumn`) — algumas colunas só existem após rodar migrations. Se uma query falhar com Postgres 42703, o código tenta de novo sem aquela coluna. **Não remova esse padrão sem confirmar que todas as migrations rodaram em todos os ambientes**.
- Geram histórico de vencimento automaticamente ao mudar validade de documentos/RETs.

### Auth e roles

Três roles: `admin`, `gerente`, `usuario`. Verificações principais em RLS no Supabase (funções `is_admin()`, `is_manager()`, `can_access_empresa()`) **e** no client em `SistemaContext`.

Dois usuários especiais resolvidos por env var:
- `DEVELOPER_USER_ID` — protegido contra edição por outros admins.
- `GHOST_USER_ID` — invisível em listagens de usuários; é o user que faz envios automáticos (Gmail OAuth, scripts).

Itens de menu em `AppShell.tsx` usam `ghostOnly` / `emailOnly` / `department` para filtrar visibilidade — ao adicionar uma rota, considere se ela deve aparecer só pra ghost, pra um email específico, ou pra um departamento.

### Departamentos (visibilidade)

Usuário pode ter um `departamentoId` principal **+ `departamentosExtrasIds`**. Toda lógica de "ver menu X" / "ver aba Y" / "ser responsável por empresa Z" considera **principal + extras juntos**. Use os helpers `getDepartamentoSlugDoUsuario` e `getDepartamentoSlugsDoUsuario` em `src/app/utils/departamento.ts` — não acesse `departamentoId` diretamente.

### Envio de guias fiscais (área sensível)

Toda rota em `/api/checklist-fiscal/enviar*` valida o PDF no servidor antes de mandar pro cliente (`validarGuia` em `src/app/utils/validarGuia.ts`). Defesa em profundidade:

1. Autenticação via Bearer token (`autenticarRequest`).
2. Permissão por departamento/responsabilidade (`_shared.ts`).
3. Rate limit (`src/lib/rateLimit.ts`).
4. Guard contra envio duplicado.
5. Validação de PDF por layout/conteúdo.

Erros voltam com `code: 'duplicado' | 'rate_limit' | 'permissao' | 'validacao_pdf'` pra o front diferenciar. **Não pule essas validações** quando adicionar uma rota nova de envio.

O envio sai via Gmail OAuth por usuária (`src/lib/gmailSend.ts` + `src/lib/googleOAuth.ts`) — cada usuária autoriza seu próprio Gmail; o sistema usa ghost user como fallback configurado.

### Cron jobs

Configurado em `vercel.json` — `/api/cron/alertar-vencimentos` roda 09:00 UTC diariamente. Endpoints de cron precisam validar `CRON_SECRET` no header (Vercel injeta automaticamente). Eles ficam na lista de rotas públicas do proxy.

### PDFs

`pdfjs-dist` é marcado como `serverExternalPackages` em `next.config.ts` — ele tem um `require('canvas')` em código de renderização que o bundler tenta resolver. Só usamos extração de texto (não rendering), então `canvas` nunca executa. **Não tente bundlear `pdfjs-dist`** ou o build do servidor quebra.

## Convenções deste codebase

- **TypeScript estrito**, paths com `@/*` → `./src/*`.
- Tipos centralizados em `src/app/types.ts` — adicione ali, não em ad-hoc files.
- **Datas como ISO strings** (não `Date`). Helpers em `src/app/utils/date.ts` (`isoNow`, `daysUntil`, `formatBR`).
- **Histórico de vencimento** (`HistoricoVencimentoItem[]`) é JSONB no banco, manipulado por `normalizarHistoricoVencimento` / `criarHistoricoVencimentoItem` em `src/app/utils/vencimentos.ts`. Sempre passe pela normalização.
- Português nos identificadores de domínio (empresas, vencimentos, departamentos, obrigações). Helpers genéricos podem ficar em inglês.
- Comentários em português, normalmente explicando o **porquê** (segurança, edge case, decisão histórica) — não o quê.

## Arquivos sensíveis (não commitar)

`FISCAL/`, `CODIGOS EMPRESAS.xlsx` e `scripts/output-*.csv` estão no `.gitignore` — contêm CNPJs reais, razões sociais e códigos de receita por empresa. Não copie esse conteúdo pra arquivos versionados (logs de debug, fixtures, exemplos).

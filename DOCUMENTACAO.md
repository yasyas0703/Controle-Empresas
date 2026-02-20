
---

## 📋 Visão Geral

O **Controle de Empresas** é uma plataforma web profissional desenvolvida sob medida para a **Triar Contabilidade**, projetada para centralizar e simplificar toda a gestão de empresas clientes. O sistema oferece controle completo de cadastros, documentos, vencimentos, responsabilidades por departamento, importação automatizada de dados e muito mais — tudo em uma interface moderna, responsiva e intuitiva.

---

## 🏗️ Arquitetura & Stack Tecnológica

| Camada | Tecnologia | Versão | Finalidade |
|---|---|---|---|
| **Frontend** | Next.js (App Router) | 16.1.6 | Framework React com SSR/SSG, roteamento automático |
| **UI Framework** | React | 19.2 | Biblioteca de interfaces declarativas com hooks |
| **Linguagem** | TypeScript | 5.x | Tipagem estática, segurança em tempo de desenvolvimento |
| **Estilização** | Tailwind CSS | 4.x | Utility-first CSS, design system consistente |
| **Ícones** | Lucide React | 0.563 | Biblioteca de ícones SVG leve e moderna |
| **Backend (BaaS)** | Supabase | 2.95 | PostgreSQL + Auth + Storage + Realtime |
| **Validação** | Zod | 4.x | Validação de schemas com inferência de tipos |
| **Identificadores** | UUID | 13.x | Geração de IDs universais únicos |

### Decisões de Arquitetura

- **App Router (Next.js 16)** — Utiliza o mais recente sistema de roteamento baseado em diretórios, com layouts compartilhados, componentes de servidor e cliente
- **Context API centralizado** — Um único `SistemaContext` gerencia todo o estado global da aplicação (empresas, usuários, departamentos, serviços, logs, notificações e lixeira)
- **Supabase como Backend-as-a-Service** — Elimina a necessidade de um servidor dedicado, utilizando PostgreSQL com Row Level Security (RLS), autenticação integrada e storage para arquivos
- **Layout responsivo Mobile-First** — Interface completamente adaptável com breakpoints em `sm` (640px), `md` (768px) e `lg` (1024px)

---

## 🗄️ Modelagem do Banco de Dados

O sistema utiliza **11 tabelas** no PostgreSQL (via Supabase), com relacionamentos bem definidos e integridade referencial:

```
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ departamentos │◄──────│ responsaveis │──────►│   empresas   │
└──────┬───────┘       └──────┬───────┘       └──────┬───────┘
       │                      │                      │
       ▼                      ▼                      ├──► rets
┌──────────────┐       ┌──────────────┐              ├──► documentos
│   usuarios   │       │   servicos   │              ├──► observacoes
└──────────────┘       └──────────────┘              │
                                                     ▼
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│     logs     │       │  notificacoes│       │   lixeira    │
└──────────────┘       └──────────────┘       └──────────────┘
```

| Tabela | Registros | Descrição |
|---|---|---|
| `empresas` | Ilimitado | Cadastro completo de empresas clientes |
| `usuarios` | Ilimitado | Usuários do sistema (gerentes e operadores) |
| `departamentos` | Ilimitado | Setores da contabilidade (Fiscal, Contábil, etc.) |
| `servicos` | Ilimitado | Serviços prestados às empresas |
| `responsaveis` | N:N | Vínculo empresa ↔ departamento ↔ usuário responsável |
| `rets` | Por empresa | Registros de RET com PTA e vencimentos |
| `documentos` | Por empresa | Documentos com validade e arquivo anexo |
| `observacoes` | Por empresa | Chat/notas internas por empresa |
| `logs` | Automático | Auditoria completa de todas as ações |
| `lixeira` | Automático | Soft-delete com restauração (auto-purge 10 dias) |
| `notificacoes` | Automático | Sistema de notificações em tempo real |

---

## 🔐 Segurança

### Autenticação
- **Supabase Auth** — Login/logout via email e senha com JWT
- **Sessão persistente** — Tokens são renovados automaticamente
- **Administração via API Route** — Criação de usuários pelo Admin Auth (server-side)

### Row Level Security (RLS)
O banco implementa políticas de segurança granulares diretamente no PostgreSQL:

| Entidade | Gerente | Usuário Comum |
|---|---|---|
| Empresas | CRUD completo | Lê/edita apenas empresas onde é responsável |
| Departamentos | CRUD completo | Somente leitura |
| Serviços | CRUD completo | Somente leitura |
| Usuários | CRUD completo (via Admin API) | Apenas seu próprio perfil |
| Logs | Leitura completa | Apenas inserção |
| Lixeira | CRUD completo | Sem acesso |
| Responsáveis | CRUD completo | Leitura das empresas que acessa |

### Funções de Segurança SQL
- `is_active_user()` — Verifica se o usuário autenticado está ativo
- `is_manager()` — Verifica se é gerente ativo
- `can_access_empresa(eid)` — Verifica se é gerente OU responsável pela empresa

---

## 📱 Módulos e Funcionalidades

### 1. Dashboard (`/dashboard`)
Centro de comando com visão consolidada:
- **Cards estatísticos** — Total de empresas, cadastradas, pendentes, documentos vencidos, RETs a vencer
- **Alertas inteligentes** — Destaque para documentos vencidos e em risco (críticos e atenção)
- **Filtros rápidos** — Por status de cadastro, regime federal, tipo de inscrição
- **Busca instantânea** — Por código, CNPJ, razão social ou apelido
- **Cards de empresa** — Visualização resumida com acesso rápido aos detalhes

### 2. Empresas (`/empresas`)
Gestão completa do cadastro de empresas:
- **Cadastro manual** com todos os campos (CNPJ, razão social, regime, endereço, etc.)
- **Consulta automática de CNPJ** via API pública — preenche endereço e dados automaticamente
- **Importação em massa** via planilha CSV (formato Domínio Sistemas)
- **Importação de Responsabilidades Fiscais** — Vincula responsáveis via planilha
- **Detecção automática** de tipo de inscrição (CNPJ, CPF, MEI, CEI, CAEPF, CNO)
- **Vinculação de serviços** — Associa serviços às empresas
- **Gestão de RETs** — Registros com número PTA, vencimento e última renovação
- **Documentos** — Upload de arquivos com validade (Supabase Storage, limite 10MB)
- **Observações** — Chat/notas internas por empresa (tipo WhatsApp)
- **Responsáveis por departamento** — Matriz departamento × empresa

### 3. Vencimentos (`/vencimentos`)
Painel dedicado ao controle de prazos:
- **Visão unificada** de documentos e RETs com prazo
- **Classificação por status** — Vencido (vermelho), Crítico 0-15 dias (laranja), Atenção 15-30 dias (amarelo), OK (verde)
- **Filtros avançados** — Por status, tipo (documento/RET), responsável
- **Busca por empresa** — Código, CNPJ ou razão social
- **Vista mobile** — Cards adaptados para telas pequenas (substituem a tabela no celular)

### 4. Calendário (`/calendario`)
Visualização mensal de vencimentos:
- **Grade mês/ano** com navegação
- **Eventos coloridos** indicando vencimentos por dia
- **Painel lateral** com detalhes do dia selecionado
- **Responsáveis visíveis** por evento
- **Legenda de cores** por status de vencimento

### 5. Análises (`/analises`)
Dashboard analítico com gráficos e métricas:
- **Gráficos Donut** — Distribuição por regime federal, tipo de inscrição, tipo de estabelecimento
- **Mini cards** — Métricas rápidas (total, cadastradas, com RET, com doc vencido, etc.)
- **Filtros** — Por regime e tipo de inscrição
- **Estatísticas calculadas** — Percentuais e indicadores de saúde do portfólio

### 6. Serviços (`/servicos`)
Gerenciamento de serviços prestados:
- **CRUD completo** de serviços
- **Vinculação/desvinculação** de empresas a cada serviço
- **Contador de empresas** vinculadas
- **Busca de empresas** para vincular (por código, CNPJ ou razão social)
- **Painel expansível** por serviço com listas de vinculadas/não vinculadas

### 7. Departamentos (`/departamentos`)
Gestão de setores internos:
- **CRUD completo** de departamentos
- Departamentos são usados como eixo da matriz de responsabilidades
- Vinculação automática a usuários

### 8. Usuários (`/usuarios`)
Administração de acessos:
- **CRUD completo** — Criar, editar, desativar, excluir usuários
- **Tipos de papel** — Gerente (acesso total) e Usuário (acesso restrito)
- **Vínculo a departamento** — Cada usuário pertence a um setor
- **Toggle ativo/inativo** — Bloqueia acesso sem excluir
- **Alteração de senha** — Via Supabase Auth Admin API
- **Criação automática** durante importação de planilhas

### 9. Histórico / Logs (`/historico`)
Auditoria completa e rastreável:
- **Registro automático** de todas as ações (criar, editar, excluir, login, logout)
- **Diff detalhado** — Mostra exatamente o que mudou (campo por campo, valor anterior → novo)
- **Filtros** — Por tipo de ação, por usuário, busca textual
- **Vista mobile** — Cards com badges coloridos de ação
- **Entidades rastreadas** — Empresa, Usuário, Departamento, Documento, RET

### 10. Lixeira (`/lixeira`)
Recuperação de dados excluídos:
- **Soft-delete** — Itens excluídos são movidos para a lixeira (não apagados)
- **Tipos suportados** — Empresas, Documentos, Observações
- **Restauração** — Um clique para restaurar ao estado original
- **Exclusão definitiva** — Remoção permanente com confirmação
- **Auto-purge** — Itens com mais de 10 dias são limpos automaticamente
- **Metadados** — Quem excluiu e quando

### 11. Notificações
Sistema de alertas em tempo real:
- **Sino no header** com badge de contagem de não lidas  
- **Tipos** — Informação, Sucesso, Aviso, Erro
- **Ações** — Marcar como lida, marcar todas, limpar
- **Geração automática** — Criação/exclusão de empresas gera notificação
- **Dropdown responsivo** — Adapta-se ao tamanho da tela

---

## 📦 Importação Inteligente de Dados

### Importação de Planilha do Domínio
O sistema suporta importação em massa via arquivo CSV/TSV direto do **Domínio Sistemas**:

1. **Parse automático** — Detecta separador (tab, ponto-e-vírgula, vírgula)
2. **Mapeamento de colunas** — Código, Nome, CNPJ, Inscrição Estadual, Regimes (Federal, Estadual, Municipal)
3. **Detecção de departamentos** — Colunas de responsáveis são identificadas automaticamente pelo cabeçalho
4. **Criação automática** de departamentos e usuários que não existem
5. **Consulta CNPJ** — Busca endereço e dados complementares via API pública para cada empresa
6. **Retry com backoff** — Criação de usuários com até 3 tentativas em caso de rate-limit
7. **Merge inteligente** — Empresas existentes recebem atualização de responsáveis sem sobrescrever atribuições válidas
8. **Recarregamento pós-importação** — Sincroniza state local com o banco após a importação

### Importação de Responsabilidades Fiscais
Importação específica para vincular responsáveis a empresas já existentes via planilha separada.

---

## 🔧 API Routes (Server-Side)

| Rota | Método | Descrição |
|---|---|---|
| `/api/admin/users` | `GET` | Lista todos os usuários (requer gerente) |
| `/api/admin/users` | `POST` | Cria novo usuário no Auth + perfil (requer gerente) |
| `/api/admin/users/[id]` | `PATCH` | Atualiza perfil do usuário (requer gerente) |
| `/api/admin/users/[id]/password` | `PATCH` | Altera senha do usuário no Auth (requer gerente) |
| `/api/cnpj/[cnpj]` | `GET` | Consulta CNPJ em APIs públicas (BrasilAPI/ReceitaWS) |

Todas as rotas administrativas exigem:
- Token JWT válido via header `Authorization: Bearer <token>`
- Usuário autenticado com `role = 'gerente'` e `ativo = true`

---

## 🧩 Componentes Principais

| Componente | Descrição |
|---|---|
| `AppShell` | Layout principal: header com logo, navegação, notificações, login/logout |
| `SistemaContext` | Provider global: estado, CRUD, logs, notificações |
| `ModalBase` | Modal portal reutilizável com scroll e responsividade |
| `ModalCadastrarEmpresa` | Formulário completo de cadastro/edição de empresa |
| `ModalDetalhesEmpresa` | Visualização completa com documentos, RETs, responsáveis, observações |
| `ModalImportarPlanilha` | Drag & drop + parsing + preview + importação em massa |
| `ModalImportarResponsabilidadesFiscal` | Importação específica de responsáveis |
| `ModalAdicionarDocumento` | Upload com nome e validade |
| `ConfirmModal` | Modal de confirmação com variantes (danger, warning, info, restore) |
| `ToastStack` | Sistema de alertas toast empilhados |

---

## 📂 Estrutura do Projeto

```
controle-triar/
├── public/
│   └── triar.png                  # Logo da aplicação
├── src/
│   ├── app/
│   │   ├── layout.tsx             # Layout raiz (HTML, fontes, providers)
│   │   ├── page.tsx               # Página inicial (redirect)
│   │   ├── providers.tsx          # Wrapper do SistemaProvider
│   │   ├── globals.css            # Estilos globais + Tailwind
│   │   ├── types.ts               # Todas as interfaces TypeScript
│   │   │
│   │   ├── api/                   # API Routes (server-side)
│   │   │   ├── admin/users/       # CRUD de usuários
│   │   │   └── cnpj/[cnpj]/      # Consulta CNPJ
│   │   │
│   │   ├── components/            # Componentes reutilizáveis
│   │   │   ├── AppShell.tsx       # Shell principal
│   │   │   ├── Modal*.tsx         # Sistema de modais
│   │   │   ├── ConfirmModal.tsx   # Modal de confirmação
│   │   │   └── ToastStack.tsx     # Alertas toast
│   │   │
│   │   ├── context/
│   │   │   └── SistemaContext.tsx  # Estado global (823 linhas)
│   │   │
│   │   ├── utils/                 # Utilitários
│   │   │   ├── api.ts             # Consulta CNPJ client-side
│   │   │   ├── date.ts            # Formatação e cálculo de datas
│   │   │   ├── storage.ts         # LocalStorage helpers
│   │   │   └── validation.ts      # Validação Zod (CPF, CNPJ, CEP)
│   │   │
│   │   ├── hooks/
│   │   │   └── useLocalStorageState.ts  # Hook de estado persistente
│   │   │
│   │   └── [páginas]/             # 10 páginas da aplicação
│   │       ├── dashboard/
│   │       ├── empresas/
│   │       ├── vencimentos/
│   │       ├── calendario/
│   │       ├── analises/
│   │       ├── servicos/
│   │       ├── departamentos/
│   │       ├── usuarios/
│   │       ├── historico/
│   │       └── lixeira/
│   │
│   └── lib/
│       ├── db.ts                  # Camada de acesso ao Supabase (810+ linhas)
│       ├── supabase.ts            # Cliente Supabase (client-side)
│       └── supabaseAdmin.ts       # Cliente Supabase Admin (server-side)
│
├── supabase-schema.sql            # Schema completo do banco (396 linhas)
├── package.json
├── tsconfig.json
├── next.config.ts
├── tailwind / postcss configs
└── eslint.config.mjs
```

---

## 🚀 Como Executar

### Pré-requisitos
- Node.js 18+
- Conta no [Supabase](https://supabase.com)

### Instalação

```bash
# Clonar e instalar dependências
cd controle-triar
npm install

# Configurar variáveis de ambiente
# Crie um arquivo .env.local com:
NEXT_PUBLIC_SUPABASE_URL=https://seu-projeto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
SUPABASE_SERVICE_ROLE_KEY=sua-service-role-key

# Executar o schema SQL no Supabase
# Cole o conteúdo de supabase-schema.sql no SQL Editor do Supabase

# Criar o primeiro usuário gerente no Supabase Auth
# (email deve corresponder ao seed no schema)

# Iniciar em desenvolvimento
npm run dev

# Build de produção
npm run build
npm start
```

---

## 📊 Números do Projeto

| Métrica | Valor |
|---|---|
| Páginas da aplicação | 10 |
| Componentes React | 15+ |
| Tabelas no banco | 11 |
| API Routes | 5 |
| Linhas de TypeScript | 6.000+ |
| Linhas de SQL | 396 |
| Policies RLS | 20+ |
| Índices de performance | 7 |

---

## ✨ Diferenciais Técnicos

- **100% TypeScript** — Zero `any`, tipagem rigorosa com interfaces e type guards
- **Validação Zod** — CPF, CNPJ e CEP validados com schemas reutilizáveis
- **Row Level Security** — Segurança no nível do banco, não apenas na aplicação
- **Soft-delete com auto-purge** — Nada é perdido sem querer, mas dados antigos são limpos
- **Importação inteligente** — Retry automático, merge sem sobrescrita, consulta CNPJ em batch
- **Auditoria completa** — Diff campo a campo em cada alteração, com histórico permanente
- **Interface 100% responsiva** — Desktop e mobile com layouts otimizados para cada tela
- **Performance** — Batch-loading de dados (evita N+1), índices no banco, limite Supabase configurado

---


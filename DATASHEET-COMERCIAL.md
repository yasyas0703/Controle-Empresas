# CONTROLE EMPRESAS

## Plataforma de gestão para escritórios de contabilidade

> *Documento comercial — versão 2026.04*

---

## O que é o Controle Empresas

O **Controle Empresas** é um sistema online, feito sob medida para escritórios de contabilidade, que centraliza o que hoje está espalhado em planilhas, agendas, e-mails e cabeças de pessoas: **carteira de clientes, vencimentos por departamento, documentos, RETs, responsabilidades, histórico de tudo o que foi feito e por quem**.

Em uma frase: é o "painel de comando" do escritório — quem entra de manhã sabe exatamente o que vence hoje, quem é responsável, o que está atrasado e o que precisa de atenção, sem precisar abrir 10 planilhas.

---

## Para quem é

- Escritórios de contabilidade que atendem **dezenas a centenas de empresas** simultaneamente.
- Equipes divididas por departamento (**Fiscal, Pessoal, Contábil, Cadastro**) que precisam de controle individual sem perder a visão global.
- Gestores que querem **acabar com o "achismo"**: saber em tempo real quem está com o quê, o que está atrasado e quem entregou.

---

## A dor que o sistema resolve

| Problema típico do escritório | Como o Controle Empresas resolve |
|---|---|
| Vencimentos espalhados em várias planilhas, cada departamento com a sua | Painel único de vencimentos, com visão por departamento e visão consolidada |
| Ninguém sabe quem é responsável por cada empresa em cada área | Matriz **empresa × departamento × usuário responsável**, atribuível em massa |
| RET e documentos com validade vencem sem ninguém perceber | Alertas automáticos: vencido, crítico (0–15 dias), atenção (15–30 dias), em dia |
| Cadastro novo: digitar CNPJ, endereço, regime, IE, IM... toda vez | Consulta automática de CNPJ — preenche endereço e dados em 1 clique |
| Importar 200 empresas do Onvio é um pesadelo manual | Com criação automática de departamentos, responsáveis e cruzamento com base existente |
| "Quem alterou esse cadastro? Quando?" — ninguém sabe | Auditoria completa, com diff campo a campo de cada alteração |
| Apagou sem querer? Perdeu o trabalho | Lixeira com restauração de 1 clique e auto-limpeza após 10 dias |
| Documentos da empresa em pastas no computador de alguém | Upload anexado ao cadastro da empresa, com validade e visibilidade controlada |
| Funcionário saiu / mudou de setor — e os clientes dele? | Reatribuição de responsáveis sem perder histórico, com permissões automáticas |

---

## Funcionalidades em detalhe

### 1. Cadastro de empresas (o coração do sistema)

- Cadastro completo: razão social, apelido, CNPJ/CPF/MEI/CEI/CAEPF/CNO (detecção automática do tipo de inscrição), inscrição estadual, inscrição municipal, regimes federal/estadual/municipal, endereço completo, status, código interno.
- Importação separada de **responsabilidades fiscais** (vincular responsáveis a empresas já cadastradas).
- **Apelido e código** para busca rápida (não precisa decorar CNPJ).
- **Empresas desligadas** ficam arquivadas sem sumir do histórico.

### 2. Painel de vencimentos por departamento

Cada departamento tem o seu painel dedicado, com filtros e cores coerentes:


Para cada item:
- Status visual: **Vencido (vermelho)**, **Crítico 0–15 dias (laranja)**, **Atenção 15–30 dias (amarelo)**, **Em dia (verde)**.
- **Tags personalizadas** para destacar itens especiais ("urgente", "aguardando cliente", "em revisão").
- **Histórico do vencimento**: quem fez, quando, observações — uma linha do tempo por item.
- Filtros: por status, por responsável, por tipo, por empresa.

### 3. Checklist mensal fiscal

Tela específica em formato de **grade obrigação × empresa × mês**, onde a equipe marca conforme entrega — visualmente parecida com uma planilha, mas com:
- Marcação de quem concluiu, quando e com qual observação.
- Filtros por mês, por obrigação e por empresa.
- Acompanhamento de progresso em tempo real.

### 6. Documentos com validade

- Upload anexado direto ao cadastro da empresa (até 10 MB por arquivo).
- Cada documento tem **nome, validade, departamentos responsáveis e nível de visibilidade**.
- **Visibilidade granular**: público (todos veem), por departamento, confidencial (só gestor), ou por usuários específicos.
- Aparecem nos painéis de vencimentos junto com as obrigações.

### 7. RETs (Regime Especial Tributário)

Módulo dedicado para empresas com RET:
- Número do **PTA**, vencimento, última renovação, número da **portaria**.
- Status ativo/inativo.
- Aparece nos alertas do dashboard quando se aproxima do vencimento.

### 8. Calendário visual

- Grade mensal com todos os vencimentos da carteira em cores de status.
- Painel lateral abre detalhes do dia clicado, com responsáveis visíveis.
- Navegação ágil mês a mês.

### 9. Análises e gráficos

Dashboard analítico com:
- **Donuts** de distribuição: regime federal, tipo de inscrição, tipo de estabelecimento (matriz/filial).
- **Mini-cards**: total de empresas, cadastradas, com RET, com documento vencido.
- Filtros por regime, por tipo de inscrição, por tipo de estabelecimento.
- Indicadores de "saúde" do portfólio.

### 10. Tags

Sistema de etiquetas livres para classificar empresas além do CNPJ — ex.: "Cliente VIP", "Em recuperação", "Aguardando documentação", "Holding", "Grupo X".

### 11. Serviços prestados

- Cadastro de serviços e vinculação às empresas.
- Painel mostra quantas empresas estão em cada serviço.
- Útil para honorários, escopo contratual e relatórios gerenciais.

### 12. Equipe e permissões

- Gestão de **usuários** (criar, editar, ativar/desativar, alterar senha).
- Dois papéis: **Gerente** (acesso total) e **Usuário** (só vê o que é dele).
- Cada usuário pertence a um **departamento**.
- **Reset de senha por e-mail** com código de verificação.
- O usuário comum só vê e edita empresas onde está vinculado como responsável.

### 13. Histórico / Auditoria

- **Toda ação registrada**: criar, editar, excluir, login, logout, importar, restaurar.
- **Diff campo a campo**: o sistema mostra exatamente o que mudou — "Inscrição Estadual: 12345 → 67890".
- Filtros por tipo de ação, por usuário e por entidade (empresa, documento, RET, usuário).
- Permanente — útil para auditoria interna e defesa em caso de questionamento.

### 14. Lixeira

- Tudo que é excluído vai para a lixeira (soft-delete).
- Restauração com **1 clique**, ao estado exato anterior.
- Limpeza automática após 10 dias.
- Mostra quem excluiu e quando.

### 15. Notificações em tempo real

- Sino no topo com contador de não lidas.
- Alertas dentro do sistema **+ notificações no navegador** (push) quando vence algo importante.
- Tipos: informação, sucesso, aviso, erro.

### 16. Backup automático

- Página dedicada de backup.
- Geração programada de cópias da base.
- Tranquilidade adicional além do backup nativo do banco.

### 17. Exportação para PDF

Listagens de empresas, vencimentos e relatórios podem ser exportados em PDF formatado, prontos para enviar ao cliente ou imprimir.




---

## Resultado prático para o cliente

- Em **1 dia** a base do escritório está importada e o sistema operacional.
- Em **1 semana** a equipe está navegando sem treinamento longo (a interface é autoexplicativa).
- Em **1 mês** o gestor consegue responder qualquer pergunta da carteira **em segundos** ("qual cliente está com mais coisas atrasadas?", , "quem é responsável pela ICMS da empresa X?").

### Indicadores típicos após implantação

- Redução do **tempo gasto procurando informação** — de minutos para segundos.
- Queda nas **multas por atraso** (alertas antecipados de 30 e 15 dias).
- Diminuição do **retrabalho** (cadastro feito uma vez, usado por todos).
- **Onboarding de funcionários novos** mais rápido — o sistema é a fonte da verdade, sem depender de quem "tem o conhecimento".

---

## O que está incluído

- Sistema completo, web, multi-usuário, multi-departamento.
- Importação inicial da base do escritório (planilha do Domínio).
- Treinamento da equipe.
- Suporte direto com a desenvolvedora.
- Atualizações contínuas (o sistema está em evolução constante —




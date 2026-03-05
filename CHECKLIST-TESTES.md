# Checklist de Testes - Controle Triar

Use este checklist para verificar se todas as funcionalidades estão 100%.
Marque com [x] conforme for testando.

---

## 1. AUTENTICAÇÃO E SESSÃO

- [ ] Login com email/senha válidos funciona
- [ ] Login com credenciais erradas mostra erro adequado
- [ ] Rate limiting de login funciona (5 tentativas em 3 min bloqueia)
- [ ] Usuário inativo não consegue fazer login
- [ ] Sessão é mantida ao recarregar a página
- [ ] Logout limpa a sessão corretamente
- [ ] Token de sessão é renovado automaticamente
- [ ] Redirecionamento para login quando não autenticado

---

## 2. CONTROLE DE ACESSO POR ROLE (RBAC)

### Admin
- [ ] Admin vê todas as empresas, documentos e dados
- [ ] Admin pode criar/editar/excluir usuários
- [ ] Admin pode gerenciar departamentos e serviços
- [ ] Admin acessa histórico, lixeira e backup

### Gerente
- [ ] Gerente pode criar/editar/excluir empresas
- [ ] Gerente pode criar/editar/excluir usuários (exceto admin)
- [ ] Gerente pode gerenciar departamentos e serviços
- [ ] Gerente acessa histórico e lixeira
- [ ] Gerente pode importar dados (CSV)

### Usuário
- [ ] Usuário NÃO consegue criar empresas
- [ ] Usuário NÃO consegue excluir empresas
- [ ] Usuário NÃO consegue gerenciar departamentos
- [ ] Usuário NÃO consegue gerenciar serviços
- [ ] Usuário NÃO consegue acessar lixeira
- [ ] Usuário PODE editar empresas que é responsável
- [ ] Usuário PODE adicionar observações
- [ ] Usuário PODE visualizar documentos conforme visibilidade

---

## 3. VISIBILIDADE DE DOCUMENTOS

### Visibilidade "publico"
- [ ] Todos os usuários ativos veem o documento

### Visibilidade "departamento"
- [ ] Usuário do departamento vinculado vê o documento
- [ ] Usuário de OUTRO departamento NÃO vê o documento
- [ ] Admin vê independente do departamento

### Visibilidade "usuarios"
- [ ] Apenas usuários listados em "usuarios_permitidos" veem
- [ ] Usuário NÃO listado NÃO vê o documento
- [ ] Admin vê independente da lista

### Visibilidade "confidencial"
- [ ] Apenas o criador do documento vê
- [ ] Outro usuário do mesmo departamento NÃO vê
- [ ] Admin vê independente

### Testes cruzados
- [ ] Trocar visibilidade de publico para confidencial - acesso muda imediatamente
- [ ] Adicionar/remover usuário da lista de permitidos - acesso atualiza
- [ ] Alterar departamentosIds - visibilidade por departamento atualiza

---

## 4. TAGS DE VENCIMENTO

- [ ] Criar tag de vencimento em documento (campo livre)
- [ ] Criar tag de vencimento em RET
- [ ] Tag aparece na página de vencimentos
- [ ] Tag aparece no dashboard (alertas)
- [ ] Limpar tag (salvar vazio) remove corretamente
- [ ] Itens com tag têm prioridade maior na ordenação

---

## 5. HISTÓRICO DE VENCIMENTOS

### Documentos
- [ ] Alterar validade de documento cria entrada no histórico
- [ ] Entrada mostra data antiga e nova
- [ ] Entrada registra autor e data do evento
- [ ] Histórico exibido em modal ao clicar no item

### RETs
- [ ] Alterar vencimento de RET cria entrada no histórico
- [ ] Registrar renovação (ultimaRenovacao) cria entrada "Renovação registrada"
- [ ] Histórico do RET exibido corretamente

### Geral
- [ ] Histórico ordenado do mais recente para o mais antigo
- [ ] Histórico não perde entradas anteriores ao adicionar nova
- [ ] IDs são gerados para itens sem ID

---

## 6. VENCIMENTOS (Página /vencimentos)

### Status de vencimento
- [ ] Item vencido aparece como "vencido" (vermelho)
- [ ] Item com ≤15 dias aparece como "critico" (vermelho/laranja)
- [ ] Item com ≤60 dias aparece como "atencao" (amarelo)
- [ ] Item com ≤90 dias aparece como "proximo" (verde)
- [ ] Item com >90 dias aparece como "ok"
- [ ] Limiares personalizados (localStorage) funcionam

### Filtros
- [ ] Filtro por status (vencido, critico, atencao, proximo, ok)
- [ ] Filtro por departamento
- [ ] Filtro por responsável
- [ ] Filtro por tipo (Documento/RET)
- [ ] "Meus Vencimentos" filtra apenas itens do usuário logado
- [ ] Busca por texto (nome empresa/item)
- [ ] Ordenação por dias, empresa, tipo (asc/desc)

---

## 7. DASHBOARD (/dashboard)

- [ ] Cards mostram totais corretos (total, cadastradas, pendentes)
- [ ] Card de documentos vencidos mostra contagem correta
- [ ] Card de RETs a vencer mostra contagem correta
- [ ] Alertas destacam itens vencidos e críticos
- [ ] Busca por código, CNPJ, razão social, apelido funciona
- [ ] Filtro por departamento funciona
- [ ] Filtro por responsável funciona
- [ ] Filtro por tipo estabelecimento (matriz/filial) funciona
- [ ] Filtro por regime federal funciona
- [ ] Filtro por serviço funciona
- [ ] Filtro por estado funciona

---

## 8. EMPRESAS (/empresas)

### CRUD
- [ ] Criar empresa manualmente com todos os campos
- [ ] Editar empresa existente
- [ ] Excluir empresa (vai para lixeira)
- [ ] Busca por código (match exato)
- [ ] Busca por razão social, apelido, CNPJ

### Consulta CNPJ
- [ ] Busca CNPJ via BrasilAPI preenche campos automaticamente
- [ ] Fallback para cnpj.ws quando BrasilAPI falha
- [ ] CNPJ inválido mostra erro
- [ ] Rate limit (429) tratado com mensagem adequada

### Documentos
- [ ] Upload de documento (PDF, DOC, DOCX, XLS, XLSX, PNG, JPG, TXT)
- [ ] Arquivo >10MB é rejeitado
- [ ] Extensão não permitida é rejeitada
- [ ] Download de documento via URL assinada funciona
- [ ] Excluir documento vai para lixeira
- [ ] Definir visibilidade ao criar documento
- [ ] Alterar visibilidade de documento existente

### RETs
- [ ] Criar RET com número PTA, nome, vencimento
- [ ] Editar RET existente
- [ ] Excluir RET
- [ ] Registrar renovação de RET
- [ ] Campo "possui_ret" da empresa atualiza conforme RETs existem

### Observações
- [ ] Adicionar observação com texto
- [ ] Observação registra autor e data
- [ ] Excluir observação (vai para lixeira)

### Responsáveis
- [ ] Atribuir responsável por departamento
- [ ] Alterar responsável de departamento
- [ ] Remover responsável
- [ ] Constraint UNIQUE(empresa_id, departamento_id) impede duplicatas

### Importação
- [ ] Importar CSV formato Domínio Sistemas
- [ ] Importação de responsabilidades fiscais
- [ ] Importação não duplica empresas existentes (por código)
- [ ] Retry com backoff em falhas de batch

---

## 9. SERVIÇOS (/servicos)

- [ ] Criar serviço
- [ ] Editar nome do serviço
- [ ] Excluir serviço
- [ ] Vincular empresa a serviço
- [ ] Desvincular empresa de serviço
- [ ] Contador de empresas por serviço está correto
- [ ] Buscar empresa para vincular funciona

---

## 10. DEPARTAMENTOS (/departamentos)

- [ ] Criar departamento
- [ ] Editar nome do departamento
- [ ] Excluir departamento
- [ ] Departamento aparece nos selects de filtro
- [ ] Departamento aparece na atribuição de responsáveis

---

## 11. USUÁRIOS (/usuarios)

- [ ] Criar usuário com email, nome, role, departamento
- [ ] Editar dados do usuário
- [ ] Alterar role do usuário
- [ ] Alterar departamento do usuário
- [ ] Ativar/desativar usuário (toggle ativo)
- [ ] Alterar senha de usuário
- [ ] Rate limiting de alteração de senha (5 por hora)
- [ ] Usuário developer não pode ser editado por outros
- [ ] Usuário ghost não aparece na lista de usuários

---

## 12. HISTÓRICO (/historico)

- [ ] Logs de login/logout são registrados
- [ ] Logs de create/update/delete são registrados
- [ ] Diff campo-a-campo é exibido corretamente
- [ ] Filtro por ação (login, logout, create, update, delete, alert)
- [ ] Filtro por entidade (empresa, usuario, departamento, documento, ret, notificacao, servico)
- [ ] Filtro por usuário
- [ ] Filtro por intervalo de datas (de/até)
- [ ] Visualização de itens soft-deleted
- [ ] Busca textual funciona
- [ ] Visualização mobile (cards) funciona

---

## 13. LIXEIRA (/lixeira)

- [ ] Empresas excluídas aparecem na lixeira
- [ ] Documentos excluídos aparecem na lixeira
- [ ] Observações excluídas aparecem na lixeira
- [ ] Restaurar empresa funciona (volta ao estado original)
- [ ] Restaurar documento funciona
- [ ] Restaurar observação funciona
- [ ] Exclusão permanente com confirmação
- [ ] Auto-purge de itens >10 dias
- [ ] Busca na lixeira (código, CNPJ, razão social, quem excluiu)
- [ ] Filtro por tipo (empresa, documento, observacao)
- [ ] Metadados exibidos (quem excluiu, quando)

---

## 14. NOTIFICAÇÕES

- [ ] Notificações são criadas para eventos relevantes
- [ ] Notificação exibe título, mensagem e tipo (info/sucesso/aviso/erro)
- [ ] Marcar notificação como lida
- [ ] Notificação aparece apenas para destinatários corretos
- [ ] Notificações ordenadas por data (mais recente primeiro)

---

## 15. ANÁLISES (/analises)

- [ ] Gráficos donut por regime federal
- [ ] Gráficos donut por tipo inscrição
- [ ] Gráficos donut por tipo estabelecimento
- [ ] Mini cards com métricas corretas
- [ ] Filtros por regime e tipo inscrição funcionam
- [ ] Percentuais calculados corretamente

---

## 16. CALENDÁRIO (/calendario)

- [ ] Grade mensal exibe corretamente
- [ ] Indicadores de eventos com cores corretas
- [ ] Painel lateral mostra detalhes do dia
- [ ] Navegação mês anterior/próximo funciona
- [ ] Nomes de empresas e responsáveis exibidos

---

## 17. BACKUP (/backup)

- [ ] Backup automático para localStorage funciona
- [ ] Backup manual pode ser disparado
- [ ] Restauração de backup funciona
- [ ] Exportação de dados funciona

---

## 18. RESPONSIVIDADE (MOBILE)

- [ ] Sidebar é toggleável no mobile
- [ ] Tabelas viram cards no mobile
- [ ] Formulários são usáveis em tela pequena
- [ ] Filtros são acessíveis no mobile
- [ ] Calendário é navegável no mobile

---

## 19. EXPORTAÇÃO PDF

- [ ] Exportar relatório em PDF funciona
- [ ] PDF contém dados corretos e formatados
- [ ] Tabelas no PDF são legíveis

---

## 20. SEGURANÇA

- [ ] RLS do Supabase bloqueia acesso direto não autorizado
- [ ] API routes validam JWT antes de processar
- [ ] Usuário não consegue acessar rotas de admin via URL direta
- [ ] Service Role Key NÃO está exposta no client-side
- [ ] Arquivos só podem ser baixados com URL assinada
- [ ] Rate limiting funciona nos endpoints sensíveis

---

## RESUMO DE PROGRESSO

| Seção | Total | OK | Falha | Pendente |
|-------|-------|----|-------|----------|
| Autenticação | 8 | | | |
| RBAC | 16 | | | |
| Visibilidade Docs | 12 | | | |
| Tags Vencimento | 6 | | | |
| Histórico Vencimentos | 9 | | | |
| Vencimentos | 13 | | | |
| Dashboard | 11 | | | |
| Empresas | 28 | | | |
| Serviços | 7 | | | |
| Departamentos | 5 | | | |
| Usuários | 11 | | | |
| Histórico | 11 | | | |
| Lixeira | 11 | | | |
| Notificações | 5 | | | |
| Análises | 6 | | | |
| Calendário | 5 | | | |
| Backup | 4 | | | |
| Responsividade | 5 | | | |
| Exportação PDF | 3 | | | |
| Segurança | 6 | | | |
| **TOTAL** | **182** | | | |

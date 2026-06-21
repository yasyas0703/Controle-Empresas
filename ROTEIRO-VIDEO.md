# 🎬 Roteiro de Apresentação — Sistema "Controle de Empresas" (Triar)

> Duração estimada: 10 a 14 minutos.
> Dica: deixe o sistema já logado e com dados reais carregados antes de gravar.
> Cada bloco tem **[O QUE MOSTRAR NA TELA]** e a **fala sugerida** (em itálico).

---

## 0. Abertura (15–30s)

**[TELA: logo da Triar / tela inicial]**

> *"Olá! Hoje vou apresentar o Controle de Empresas, o sistema que a gente
> desenvolveu aqui na Triar para organizar toda a rotina do escritório de
> contabilidade — desde o cadastro das empresas, controle de vencimentos,
> envio de guias fiscais, até um portal próprio para o cliente acompanhar
> tudo pelo celular. Vou passar página por página explicando o objetivo de
> cada uma."*

**Pontos para citar na abertura:**
- É um sistema único, mas com **duas partes**: o **sistema interno** (uso da equipe) e o **portal do cliente** (PWA, instala no celular).
- O acesso interno é **fechado e protegido** — quem não tem permissão nem enxerga o sistema.

---

## 1. Login / Entrada no Sistema (`/sistema-triar`)

**[TELA: tela de login]**

> *"Esta é a única porta de entrada do sistema interno. Sem login válido,
> o sistema simplesmente não aparece — é uma camada de segurança. Aqui a
> equipe entra com email e senha, e quem esquece a senha consegue recuperar
> por um código enviado no email."*

**Mostrar:** campo de email/senha, botão "Esqueci minha senha", e os **3 níveis de acesso**: Admin, Gerente e Usuário.

---

## 2. Dashboard (`/dashboard`)

**[TELA: dashboard com a lista de empresas e os cards de risco]**

> *"Logo após o login a gente cai no Dashboard, que é o coração do sistema.
> Aqui ficam todas as empresas cadastradas. Cada usuário vê o que é relevante
> pro seu departamento."*

**Mostrar e explicar:**
- **Busca e filtros** de empresas (por nome, código, cidade, departamento, tags).
- **Cards/painel de risco**: documentos e vencimentos que estão **perto de vencer ou já vencidos**, ordenados por urgência.
- Abrir uma empresa (**Detalhes da Empresa**) e mostrar dados, documentos, RETs e responsáveis.
- **Exportações** em PDF e Excel.

> *"O objetivo é dar uma visão imediata do que precisa de atenção hoje, sem
> precisar abrir empresa por empresa."*

---

## 3. Vencimentos (`/vencimentos`)

**[TELA: lista de vencimentos]**

> *"Nesta aba a gente concentra os documentos e RETs vencidos ou a vencer.
> Repare no número vermelho no menu — ele mostra quantos itens estão
> vencidos, funcionando como um alerta constante para a equipe."*

**Mostrar:** o badge vermelho no menu lateral e como filtrar/priorizar os vencimentos.

---

## 4. Controle Fiscal — Checklist Mensal (`/vencimentos-fiscais/checklist`)

**[TELA: checklist mensal do fiscal]**

> *"Esta é uma das partes mais importantes para o departamento fiscal. Todo
> mês a equipe precisa apurar e enviar as guias de cada empresa — ICMS, SPED,
> Simples Nacional e por aí vai. Esse checklist mostra, empresa por empresa,
> o que já foi feito e o que falta."*

**Mostrar e destacar:**
- Navegação por **mês/competência**.
- Marcação de cada obrigação como concluída.
- **Envio de guia direto pro cliente** (anexa o PDF e dispara o email).
- Mencionar a **validação automática do PDF**: antes de enviar, o sistema confere se a guia é válida e da empresa certa — evita mandar guia trocada.
- Indicadores de **status no portal do cliente** (se já viu, baixou, marcou como paga).

> *"O grande ganho aqui é segurança e rastreabilidade: a guia é validada
> antes de sair, e a gente sabe exatamente o que o cliente já recebeu."*

---

## 5. Controle Contábil e Controle Cadastro

**[TELA: `/vencimentos-contabil/controle` e `/vencimentos-cadastro/controle`]**

> *"Cada departamento tem seu próprio painel de controle. O Contábil e o
> Cadastro têm checklists parecidos com o do Fiscal, mas com as obrigações
> específicas de cada área. Assim cada equipe enxerga só o que é dela."*

**Mostrar rapidamente** os dois, reforçando que a **visibilidade é por departamento**.

---

## 6. Calendário (`/calendario`)

**[TELA: calendário]**

> *"O calendário dá a visão temporal de tudo: vencimentos e obrigações
> distribuídos pelos dias do mês. Ótimo para planejar a semana e não deixar
> nada passar."*

---

## 7. Aplicativos (`/aplicativos`)

**[TELA: página de aplicativos]**

> *"Aqui a gente centraliza os links e downloads de aplicativos/ferramentas
> úteis para a equipe, num lugar só."*

---

## 8. Obrigações (`/obrigacoes`)

**[TELA: obrigações]**

> *"Nesta área a gente cadastra e gerencia as obrigações que alimentam os
> checklists — é a base de regras de quais impostos e entregas cada tipo de
> empresa precisa cumprir."*

---

## 9. Empresas (`/empresas`)

**[TELA: cadastro/importação de empresas]**

> *"Aqui é onde a empresa nasce no sistema. A gente cadastra os dados — CNPJ,
> regime, departamentos responsáveis — e dá pra importar empresas em massa
> por planilha, o que poupa muito trabalho manual."*

**Mostrar:** botão de cadastrar, importação por planilha e atribuição de responsáveis.

---

## 10. Serviços (`/servicos`) e Tags (`/tags`)

**[TELA: serviços e tags]**

> *"Serviços são o que o escritório oferece e que vinculamos às empresas. As
> Tags são etiquetas para organizar e filtrar as empresas do jeito que a
> gente quiser — por característica, grupo, situação, etc."*

---

## 11. Usuários (`/usuarios`)

**[TELA: usuários]**

> *"Área administrativa para gerenciar a equipe: criar usuários, definir o
> papel — Admin, Gerente ou Usuário — e a quais departamentos cada um
> pertence. É isso que controla o que cada pessoa enxerga no sistema."*

---

## 12. Clientes do Portal (`/clientes-portal`)

**[TELA: clientes do portal]**

> *"Aqui a gente gerencia os acessos dos clientes ao portal: quem tem login,
> quais empresas cada cliente acompanha. É a ponte entre o sistema interno e
> o app do cliente."*

---

## 13. Departamentos (`/departamentos`)

**[TELA: departamentos]**

> *"Definimos aqui os departamentos — Fiscal, Contábil, Pessoal, Cadastro — e
> é com base neles que toda a visibilidade do sistema é organizada."*

---

## 14. Análises (`/analises`)

**[TELA: análises / gráficos]**

> *"A parte de Análises traz indicadores e visões gerenciais: volume de
> empresas, vencimentos, produtividade. Ajuda a tomar decisão com dado, não
> no achismo."*

---

## 15. Histórico (`/historico`)

**[TELA: histórico/logs]**

> *"Todo movimento importante fica registrado aqui. Quem fez o quê e quando —
> ótimo para auditoria e para resolver dúvidas do tipo 'isso já foi enviado?'"*

---

## 16. Empresas Desligadas, Lixeira e Backup

**[TELA: as três páginas, rápido]**

> *"Pra fechar o sistema interno: Empresas Desligadas arquiva os clientes que
> saíram sem perder o histórico; a Lixeira guarda o que foi excluído, dando
> chance de recuperar; e o Backup garante que os dados estão seguros e podem
> ser restaurados."*

---

## 17. PORTAL DO CLIENTE (`/portal`) — destaque final

**[TELA: portal aberto no celular ou em janela estreita]**

> *"E agora a parte que o cliente vê. O Portal é um aplicativo que o cliente
> instala no celular. Quando a equipe envia uma guia, ela aparece aqui na
> hora."*

**Mostrar:**
- **Lista de documentos** com status: Pago, Vencido, Crítico, Atenção.
- Abrir um documento, **visualizar e baixar** o PDF.
- Marcar como **pago**.
- **Histórico** e **Perfil** do cliente.
- Mencionar que é **PWA**: instala como app e recebe **notificações**.

> *"O objetivo do portal é dar autonomia e transparência pro cliente — ele
> recebe a guia, vê o vencimento, baixa e marca como paga, tudo pelo celular.
> E a gente, do lado de cá, acompanha se ele já visualizou."*

---

## 18. Encerramento (20–30s)

**[TELA: voltar pro Dashboard]**

> *"Resumindo: o Controle de Empresas junta num lugar só o cadastro, o
> controle de vencimentos por departamento, o envio seguro de guias fiscais e
> um portal próprio para o cliente. Tudo pensado para reduzir erro, dar
> rastreabilidade e economizar tempo da equipe. Obrigada por assistir!"*

---

### ✅ Checklist antes de gravar
- [ ] Estar logado com um usuário **Admin** (vê todas as abas).
- [ ] Ter empresas e vencimentos reais carregados (para os números aparecerem).
- [ ] Abrir o **portal** num celular ou janela estreita para mostrar como app.
- [ ] **Cuidar dados sensíveis**: se for vídeo público, considere borrar CNPJs e razões sociais reais.
- [ ] Testar o envio de uma guia de exemplo antes (para a demo do checklist fluir).

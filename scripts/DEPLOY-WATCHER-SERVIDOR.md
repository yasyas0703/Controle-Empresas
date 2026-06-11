# Watcher de Guias — instalar no servidor (rodar 24/7 sem depender de PC pessoal)

Para o time de TI / quem administra o servidor. Objetivo: o "watcher" (programa
que observa a pasta de guias e dispara o envio automático) rodar **sempre**,
inclusive sem ninguém logado, num servidor que fica ligado o tempo todo.

Hoje ele roda no PC de uma pessoa, aberto na mão. Se esse PC desliga ou ninguém
loga, **nenhuma guia é processada**. Movendo pro servidor, isso acaba.

---

## O que o watcher faz (resumo)

1. Observa a pasta `...\Fiscal\1-GUIAS A ENVIAR` (PDFs de guias — irmã da pasta EMPRESA, não filha).
2. Para cada PDF novo, manda pro sistema na nuvem (HTTPS) que identifica empresa
   + obrigação + competência, valida e **envia o email pro cliente**.
3. Move o PDF processado pra pasta da empresa; o que não dá pra resolver vai pra
   `_PENDENTES` e aparece num painel pra equipe revisar.

O watcher é leve (Node.js) e só faz chamadas HTTPS de saída — **não abre porta
nem recebe conexão**. Não precisa do app instalado: ele fala com a nuvem.

---

## Pré-requisitos

- **Node.js LTS** (18+). Baixe em https://nodejs.org e instale (Next/Avançar).
- **Acesso de rede de saída** (HTTPS) para `controle-empresas.vercel.app` e
  `*.supabase.co`.
- **Acesso à pasta Fiscal** a partir do servidor. **Importante:** use o caminho
  **UNC** (`\\SERVIDOR\Compartilhamento\...`), **não** uma letra de drive (T:).
  Drive mapeado (T:) é por sessão de usuário — uma Tarefa/Serviço "sem login"
  **não enxerga T:**. UNC funciona sempre.

---

## Instalação (uma vez)

1. Copie a pasta do projeto pro servidor (ou faça `git clone` se tiver acesso ao
   repositório). O essencial é a pasta `scripts\` e o `package.json` na raiz.
2. No prompt, dentro da pasta do projeto:
   ```
   npm install
   ```
   (instala as dependências `chokidar` e `undici` que o watcher usa.)

---

## Configuração (variáveis de ambiente)

O watcher precisa de 3 variáveis. **Recomendado:** definir como variáveis de
ambiente **do sistema** (assim a Tarefa Agendada as enxerga, sem arquivo).

| Variável | Valor | Pra quê |
|----------|-------|---------|
| `AUTO_ENVIO_TOKEN` | (o mesmo token que está no Vercel) | autentica o watcher na API. **Tem que ser idêntico** ao configurado no projeto na Vercel. Peça pra quem cuida do sistema. |
| `NEXT_PUBLIC_APP_URL` | `https://controle-empresas.vercel.app` | endereço do sistema na nuvem. |
| `FISCAL_ROOT` | `\\SERVIDOR\Compartilhamento\Fiscal\EMPRESA` | caminho **UNC** da pasta raiz das empresas (ajuste pro real). |

Como definir variável de ambiente do sistema no Windows:
`Painel de Controle → Sistema → Configurações avançadas → Variáveis de Ambiente
→ Variáveis do sistema → Novo`. (Ou `setx NOME "valor" /M` num prompt como admin.)

> Alternativa de dev: criar um arquivo `.env.local` na raiz com essas 3 linhas.
> No servidor, prefira variáveis do sistema.

---

## Rodar como Tarefa Agendada (sempre ligado, mesmo sem login)

1. Abra o **Agendador de Tarefas** (Task Scheduler) → **Criar Tarefa** (não
   "tarefa básica").
2. **Geral:**
   - Marque **"Executar estando o usuário conectado ou não"**.
   - Marque **"Executar com privilégios mais altos"**.
   - Use uma **conta de serviço/usuário que tenha acesso ao compartilhamento**
     da pasta Fiscal (a conta precisa enxergar o caminho UNC).
3. **Disparadores (Triggers):** Novo → **"Ao iniciar o computador"**.
   (opcional: marcar "Repetir a cada 5 minutos por tempo indeterminado" como
   rede de segurança — o próprio `.bat` já reinicia sozinho se cair.)
4. **Ações (Actions):** Novo → Iniciar um programa:
   - Programa/script: o caminho do **`scripts\watcher-3-prod.bat`**.
   - "Iniciar em": a pasta raiz do projeto.
5. **Condições:** desmarque "Iniciar a tarefa somente se o computador estiver
   na energia" (pra não parar em notebook na bateria).
6. Salve (vai pedir a senha da conta de serviço).

O `watcher-3-prod.bat` roda em **loop com reinício automático**: se o processo
cair, ele sobe de novo em 10s. Junto com o gatilho "ao iniciar", o watcher
sobrevive a reboot e a quedas.

---

## Como saber se está funcionando

- **Heartbeat:** o watcher "bate ponto" no sistema a cada 5 min. Se ele parar
  (servidor desligado, pasta inacessível, token errado), o sistema **avisa por
  email e no sino** ("Watcher parado") em horário comercial. Ou seja: se algo
  parar, alguém é avisado — não fica em silêncio.
- **Log local:** `scripts\.watcher.log` (uma linha JSON por evento) e
  `scripts\.watcher-state.json` (controle de já-processados).
- **Teste rápido:** solte um PDF de guia na pasta de entrada e veja no painel
  do sistema (Vencimentos Fiscais) o resultado em até ~1 min.

---

## Problemas comuns

- **"Pasta ... não existe ou não está mapeada":** `FISCAL_ROOT` está errado ou a
  conta da Tarefa não tem acesso ao share. Confirme o caminho UNC e as permissões.
- **Tudo vira erro de rede / 401:** `AUTO_ENVIO_TOKEN` diferente do que está na
  Vercel, ou sem acesso de saída à internet.
- **Watcher não sobe sem login:** confirme "Executar estando o usuário conectado
  ou não" e que a conta tem o direito "Logon as a batch job".

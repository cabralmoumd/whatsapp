# EncantaKids WhatsApp Backend

Motor de envio e recebimento de mensagens WhatsApp para o sistema de marketing EncantaKids.

---

## Estrutura de arquivos

```
src/
  server.js              ← Entry point — inicia o servidor
  lib/
    supabase.js          ← Cliente do banco de dados
    evolution.js         ← Cliente da Evolution API
  routes/
    webhook.js           ← Recebe respostas dos clientes
    campanhas.js         ← Dispara e gerencia campanhas
  services/
    parser.js            ← Interpreta SIM/NÃO/SAIR
    rateLimiter.js       ← Controla limites por perfil
    queue.js             ← Motor principal da fila
  jobs/
    perfilAvancar.js     ← Avança perfil automaticamente
```

---

## Deploy no Railway (passo a passo)

### 1. Prepare o repositório

```bash
# Crie um repositório no GitHub e suba este código
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/SEU_USUARIO/encantakids-backend
git push -u origin main
```

### 2. Crie o projeto no Railway

1. Acesse [railway.app](https://railway.app)
2. Clique em **New Project**
3. Selecione **Deploy from GitHub repo**
4. Selecione o repositório `encantakids-backend`
5. Railway detecta automaticamente e faz o build

### 3. Configure as variáveis de ambiente

No Railway, vá em **Settings > Variables** e adicione:

| Variável | Valor |
|---|---|
| `SUPABASE_URL` | https://SEU_PROJETO.supabase.co |
| `SUPABASE_SERVICE_ROLE_KEY` | sua_service_role_key |
| `EVOLUTION_API_URL` | https://sua-evolution-api.com |
| `EVOLUTION_API_KEY` | sua_api_key |
| `EVOLUTION_INSTANCE_NAME` | encantakids |
| `WEBHOOK_SECRET` | qualquer_senha_forte |
| `NODE_ENV` | production |

### 4. Obtenha a URL pública

Após o deploy, Railway gera uma URL como:
`https://encantakids-backend-production.up.railway.app`

### 5. Configure o Webhook na Evolution API

Na Evolution API, configure o webhook para:
```
URL: https://SUA_URL.up.railway.app/webhook
Eventos: messages.upsert
```

### 6. Execute as funções SQL no Supabase

Abra o **SQL Editor** no Supabase e execute o conteúdo do arquivo `supabase_functions.sql`.

### 7. Conecte ao frontend Lovable

No Lovable, configure a variável de ambiente:
```
VITE_BACKEND_URL=https://SUA_URL.up.railway.app
```

---

## Endpoints disponíveis

| Método | Endpoint | Descrição |
|---|---|---|
| GET | `/` | Info do servidor |
| GET | `/health` | Health check |
| POST | `/webhook` | Recebe mensagens da Evolution API |
| GET | `/webhook` | Verifica se webhook está online |
| POST | `/campanhas/:id/disparar` | Inicia envio de campanha |
| POST | `/campanhas/:id/pausar` | Pausa campanha em andamento |
| POST | `/campanhas/:id/cancelar` | Cancela campanha e limpa fila |
| GET | `/campanhas/:id/progresso` | Progresso em tempo real |

---

## Custo estimado no Railway

- Plano Hobby: ~$5/mês
- Inclui: 512MB RAM, sempre online, deploys automáticos via Git

---

## Suporte

Sistema desenvolvido especificamente para EncantaKids.
Qualquer dúvida, consulte a documentação do sistema no painel Lovable.

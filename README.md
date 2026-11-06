# Portal EB do Fake

Projeto inicial full-stack para o portal de inscrições do EB do Fake.

## O que já está implementado

- Página inicial responsiva em preto, verde-oliva e dourado.
- Login pelo Roblox OAuth 2.0 com Authorization Code + PKCE, `state` e sessão protegida.
- Verificação de participação no grupo `376496824` no servidor.
- Formulários de alistamento, seleção de oficiais e tropas especiais.
- Banco PostgreSQL para inscrições e sessões.
- Área do candidato para acompanhar o status.
- Painel administrativo restrito ao ID numérico configurado em `ADMIN_ROBLOX_USER_ID`.
- Aprovação/reprovação no servidor, validação de dados, consultas SQL parametrizadas, rate limit, Helmet, CSP e token CSRF.
- Não solicita nem armazena senha Roblox.

## Importante antes de publicar

Este projeto ainda **não está publicado na internet**. Para ativar o login real, o proprietário precisa criar as credenciais OAuth no Roblox e configurar o banco e as variáveis de ambiente no serviço de hospedagem.

O endereço `portal-eb-do-fake.onrender.com` é apenas uma sugestão e só existirá se estiver disponível e for criado no Render.

## 1. Pré-requisitos

- Node.js 20 ou superior
- PostgreSQL
- Aplicação OAuth criada no Roblox Creator Dashboard
- Conta de hospedagem (Render, por exemplo) e repositório Git

## 2. Configurar Roblox OAuth

1. Acesse https://create.roblox.com/dashboard/credentials
2. Crie uma aplicação OAuth para o portal.
3. Configure o redirect URI exatamente igual a `ROBLOX_REDIRECT_URI`.
4. Habilite os escopos de identidade `openid` e `profile`.
5. Copie Client ID e Client Secret para as variáveis do servidor. Nunca coloque o segredo no frontend ou no GitHub.

Documentação oficial:
- https://create.roblox.com/docs/cloud/auth/oauth2-overview
- https://create.roblox.com/docs/cloud/auth/oauth2-reference

## 3. Configurar administrador

O painel não confia apenas no nome de usuário. Configure `ADMIN_ROBLOX_USER_ID` com o ID numérico imutável da conta `yImperador`. O nome pode mudar; o ID não.

## 4. Rodar localmente

```bash
npm install
cp .env.example .env
# Edite .env com as credenciais e URL do PostgreSQL
npm start
```

Abra `http://localhost:3000`.

Para produção, defina `NODE_ENV=production`, use HTTPS e gere um `SESSION_SECRET` longo e aleatório.

## 5. Publicar no Render

1. Envie este projeto para um repositório Git privado.
2. No Render, crie um PostgreSQL e um Web Service conectado ao repositório.
3. Build Command: `npm install`
4. Start Command: `npm start`
5. Adicione as variáveis do `.env.example` no painel do Render.
6. Use o endereço real fornecido pelo Render em `BASE_URL` e no redirect URI do Roblox.
7. Atualize `ROBLOX_REDIRECT_URI` para `https://SEU-DOMINIO/auth/roblox/callback` no Render e na aplicação OAuth do Roblox.

O Render fornece URL `onrender.com`; o nome pretendido pode já estar ocupado. Não anuncie o site como ativo até concluir o deploy e testar o login, o grupo e o painel.

## Observações de segurança

- O banco guarda apenas os dados necessários para análise da inscrição e o ID público do usuário Roblox.
- O token OAuth é usado durante o callback para obter o perfil e não é persistido.
- A checagem de grupo ocorre no backend, nunca apenas no navegador.
- Configure backups e política de retenção do PostgreSQL antes de abrir inscrições ao público.
- Antes de um lançamento amplo, revise privacidade, termos e regras aplicáveis aos dados coletados.

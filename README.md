# Projeto Serviços

Plataforma web para contratação e agendamento de serviços locais, conectando **Clientes** e **Prestadores de Serviço (Trabalhadores)** com geolocalização, filtros por proximidade e controle de horários disponíveis.

## Funcionalidades

- **Cadastro e Login (JWT + bcrypt):** Perfis separados para `cliente` e `trabalhador`.
- **Localização no Cadastro e Feed:** Busca automática de endereço por CEP (ViaCEP) ou GPS (Nominatim/OpenStreetMap) com cálculo de distância (Haversine) e filtros por cidade, estado, raio (km), preço e avaliação.
- **Horários de Trabalho do Prestador:** Trabalhadores configuram no cadastro (e em `Meus Horários`) os dias da semana e períodos de atendimento (ao menos 1 período obrigatório; períodos extras opcionais).
- **Calendário e Agendamento Integrado:** Clientes só podem agendar serviços nos dias e horários em que o prestador atende.
- **Gestão de Serviços e Avaliações:** Acompanhamento de pedidos, alteração de status (sincronizada com o calendário) e avaliações com notas e comentários.

## Pré-requisitos

- [Node.js](https://nodejs.org/) (v18+ recomendado)
- [MySQL Server](https://dev.mysql.com/downloads/mysql/)

## Como Instalar e Ativar

### 1. Instalar dependências

Na pasta raiz do projeto, execute:

```bash
npm install
```

### 2. Importar o banco de dados

O arquivo [`database.sql`](./database.sql) contém toda a estrutura atualizada do banco `projetoservicos`.

Importe-o no MySQL:

```bash
mysql -u root -p < database.sql
```

> **Atenção:** Verifique as credenciais de conexão com o MySQL no início do arquivo `server.js` (`host`, `user`, `password`, `database`). Por padrão está configurado para `localhost`, usuário `root`, banco `projetoservicos`.

### 2.1. Verificação por código de 6 dígitos (E-mail e Telefone)

No cadastro, o sistema valida se o e-mail possui domínio MX real e se o telefone tem formato/DDD brasileiro válido. Ao clicar em **Enviar Código**, o servidor gera e armazena um código aleatório de 6 dígitos (válido por 10 minutos) e o retorna na resposta/console para envio externo (fora do Node.js) e confirmação no formulário.

### 3. Iniciar o servidor

Para rodar em produção:

```bash
npm start
```

Ou em modo de desenvolvimento (reinicia automaticamente ao editar arquivos):

```bash
npm run dev
```

Após iniciar, acesse no navegador:

```text
http://localhost:3000
```

## Estrutura Principal

- `server.js` — API Express, autenticação JWT, regras de agendamento, localização e horários
- `database.sql` — Script SQL com todas as tabelas atualizadas (`clientes`, `trabalhadores`, `servicos`, `servicos_oferecidos`, `agendamentos`, `avaliacoes_servicos`, `notificacoes`, `horarios_trabalhador`)
- `public/index.html` — Login e cadastro (com localização e horários do trabalhador)
- `public/home.html` — Painel inicial, feed com filtros por proximidade e contratação
- `public/meus-servicos.html` — Lista de serviços contratados/recebidos
- `public/calendario.html` — Calendário mensal de agendamentos
- `public/cadastrar-servico.html` — Cadastro de novos serviços oferecidos (trabalhador)
- `public/meu-horario.html` — Configuração de dias e períodos de trabalho (trabalhador)

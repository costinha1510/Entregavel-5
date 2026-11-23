# 🚗 DriveGo — Sistema de Gestão de Locadora de Veículos

O **DriveGo** é uma aplicação web desenvolvida para facilitar o gerenciamento de uma locadora de veículos. O sistema permite organizar veículos, clientes e locações em uma interface intuitiva, moderna e de fácil utilização.

A aplicação está publicada na nuvem por meio do **Microsoft Azure**, permitindo seu acesso pela internet.

<p align="center">
  <a href="https://drivego-locadora-seunome-bxdsdqbqdadgcuay.brazilsouth-01.azurewebsites.net/">
    <strong>🌐 ACESSAR DRIVEGO ONLINE</strong>
  </a>
</p>

---

## 📌 Demonstração

**Aplicação em produção:**  
https://drivego-locadora-seunome-bxdsdqbqdadgcuay.brazilsouth-01.azurewebsites.net/

**Repositório GitHub:**  
https://github.com/costinha1510/Entregavel-5

---

## ✨ Funcionalidades

O DriveGo oferece funcionalidades para o gerenciamento das principais operações de uma locadora:

- 🚘 **Gerenciamento de veículos:** cadastro e organização dos veículos disponíveis.
- 👥 **Gerenciamento de clientes:** registro e consulta de informações dos clientes.
- 📋 **Gerenciamento de locações:** controle dos registros de locação.
- 📊 **Painel de controle:** interface para acompanhar e administrar as informações do sistema.
- 💾 **Armazenamento de dados:** utilização do banco de dados SQLite.
- ☁️ **Hospedagem em nuvem:** aplicação disponível publicamente por meio do Microsoft Azure.

---

## 🛠️ Tecnologias utilizadas

| Tecnologia | Finalidade |
|---|---|
| HTML5 | Estrutura da aplicação |
| CSS3 | Estilização e layout |
| JavaScript | Interatividade e funcionalidades |
| Node.js | Ambiente de execução do servidor |
| Express.js | Desenvolvimento do backend e rotas |
| SQLite | Banco de dados relacional |
| Git e GitHub | Versionamento e armazenamento do código |
| GitHub Actions | Automação da implantação |
| Microsoft Azure | Hospedagem da aplicação |

---

## ☁️ Hospedagem e implantação

O projeto foi publicado utilizando o **Microsoft Azure App Service**, com ambiente Linux e runtime Node.js 22 LTS.

A implantação foi configurada por meio do **GitHub Actions**, permitindo automatizar o processo de publicação.

### Fluxo de implantação

1. O código-fonte é enviado para o repositório GitHub.
2. O GitHub Actions identifica as alterações na branch `main`.
3. O fluxo de trabalho instala as dependências e prepara a aplicação.
4. O projeto é enviado automaticamente para o Azure App Service.
5. A aplicação fica disponível por meio de seu endereço público.

---

## 💻 Como executar o projeto localmente

### Pré-requisitos

- [Node.js 22 LTS](https://nodejs.org/)
- [Git](https://git-scm.com/)
- Editor de código de sua preferência (recomendado: Visual Studio Code).

### 1. Clonar o repositório

```bash
git clone https://github.com/costinha1510/Entregavel-5.git
```

### 2. Acessar a pasta do projeto

```bash
cd Entregavel-5
```

### 3. Instalar as dependências

```bash
npm install
```

### 4. Iniciar a aplicação

```bash
npm start
```

### 5. Acessar no navegador

```text
http://localhost:3000
```

---

## 📁 Estrutura do projeto

A organização principal do projeto contempla:

```text
Entregavel-5/
│
├── public/             # Arquivos da interface web
├── data/               # Banco de dados local
├── scripts/            # Scripts auxiliares
├── backups/            # Cópias de segurança locais
├── server.js           # Servidor principal
├── package.json        # Dependências e scripts
├── README.md           # Documentação do projeto
└── .gitignore          # Arquivos ignorados pelo Git
```

---

## 🎯 Objetivo do projeto

O objetivo do DriveGo é desenvolver uma solução web para auxiliar na administração de uma locadora de veículos, aplicando conhecimentos de desenvolvimento web, integração entre frontend e backend, persistência de dados, versionamento de código e computação em nuvem.

O projeto também demonstra a utilização de serviços de nuvem para disponibilização de aplicações web acessíveis pela internet.

---

## 👨‍💻 Desenvolvedor

**Guilherme Costa**

Projeto acadêmico desenvolvido com foco em desenvolvimento de sistemas e computação em nuvem.

---

<p align="center">
  Desenvolvido com dedicação para o projeto DriveGo 🚗
</p>

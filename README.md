# DriveGo

Sistema web administrativo para locadora de veículos, feito com HTML, CSS, JavaScript, Node.js, Express e SQLite. O painel oferece cadastros de veículos e clientes, gestão de locações, busca e indicadores. Não são carregados registros de demonstração: o banco começa vazio.

## Requisitos

- Node.js 22.13 ou superior (usa o módulo SQLite nativo `node:sqlite`).
- npm.

## Executar localmente

Na pasta do projeto:

```bash
npm install
npm run dev
```

Acesse http://localhost:3000. `npm start` inicia o servidor sem reinicialização automática. O endpoint `GET /health` informa se o processo está respondendo.

Os registros ficam em `data/drivego.sqlite`. Esse arquivo é criado automaticamente no primeiro início do servidor. Para apontar para outro arquivo, defina `DRIVEGO_DB_PATH` com o caminho completo antes de iniciar.

## Funcionalidades

- **Veículos:** criar, consultar, editar e remover; placa única; situação disponível ou manutenção.
- **Clientes:** criar, consultar, editar e remover; documento único e validação básica de e-mail.
- **Locações:** criar, consultar, editar status/datas e excluir; cálculo do total pelo valor diário; bloqueio de conflito de datas para um mesmo veículo; proteção contra exclusão de veículos e clientes vinculados.
- **Painel:** totais do banco e últimas locações registradas.

## Publicar no Azure App Service

Crie um App Service **Linux** com runtime Node.js compatível com `engines` no `package.json` (Node.js 22.13 ou superior). Publique a raiz do projeto e habilite a automação de build da implantação para instalar as dependências com `npm install`. O script `npm start` inicia o servidor. O Express usa a porta fornecida em `PORT` e escuta em `0.0.0.0`, como o App Service espera.

No Linux App Service, `HOME` aponta para `/home` e é armazenamento persistente. Como o App Service define `WEBSITE_SITE_NAME`, o banco é salvo em `/home/data/drivego.sqlite`; a pasta `data` é criada automaticamente. Também é possível configurar `DRIVEGO_DB_PATH=/home/data/drivego.sqlite` nas configurações da aplicação para deixar o caminho explícito. Mantenha o armazenamento do App Service habilitado para que `/home` persista entre reinicializações.

### Preservar os dados locais

O banco local está em `data/drivego.sqlite` e não é incluído no controle de versão. O backup deve ser feito pelo script abaixo; não copie apenas o arquivo `.sqlite` enquanto a aplicação estiver em uso. O mecanismo de backup do SQLite incorpora uma visão consistente do banco, inclusive transações confirmadas que ainda estejam no `drivego.sqlite-wal`, e produz um arquivo independente sem precisar transportar os arquivos `-wal` e `-shm`.

Execute com Node.js 22.16 ou superior (a API `node:sqlite` usada pelo script foi adicionada nessa versão):

```bash
node scripts/backup-sqlite.js
```

O script lê o banco em modo somente leitura e cria um arquivo novo em `backups/`. Pode-se informar outro destino, que não pode existir previamente:

```bash
node scripts/backup-sqlite.js /caminho/seguro/drivego-migracao.sqlite
```

Se `DRIVEGO_DB_PATH` estiver definido, o script o usa como origem; caso contrário, usa `data/drivego.sqlite`. Ao final, imprime a contagem de registros por tabela, o resultado `integrity_check` e o SHA-256. Guarde o backup em local seguro: ele contém dados pessoais e a pasta `backups/` é ignorada pelo Git.

### Restaurar no Azure e validar

1. Envie o arquivo `.sqlite` gerado para uma pasta temporária sob `/home/data` no App Service. Compare o SHA-256 enviado com o valor impresso pelo script (em Linux, `sha256sum arquivo.sqlite`). Não envie arquivos `drivego.sqlite-wal` nem `drivego.sqlite-shm` junto com esse backup independente.
2. Pare o App Service antes da restauração. Se `/home/data/drivego.sqlite` já existir, preserve o arquivo e quaisquer `drivego.sqlite-wal`/`drivego.sqlite-shm` existentes com nomes de backup/quarentena; não os sobrescreva nem remova sem confirmar que a cópia está íntegra.
3. Copie o backup validado para `/home/data/drivego.sqlite`, garantindo que o diretório exista. Inicie a aplicação depois da cópia. O código cria as tabelas ausentes sem apagar tabelas ou registros existentes.
4. Confirme no log do script que `integrity_check` foi `ok` e anote as contagens. Após iniciar a aplicação, compare `veículos`, `clientes` e `locações` nas respectivas telas ou confira `GET /api/vehicles`, `GET /api/clients` e `GET /api/rentals`; os totais devem corresponder às contagens do backup. Confira também o painel e `GET /health`.

Não direcione tráfego para a aplicação até validar as contagens. Mantenha o backup e a cópia anterior do banco Azure até concluir a validação funcional.

SQLite com WAL é apropriado para esta aplicação em uma instância. Não habilite escala horizontal com várias instâncias gravando no mesmo arquivo SQLite. Para instruções atualizadas de runtime e implantação, consulte [Configurar aplicativos Node.js no App Service](https://learn.microsoft.com/azure/app-service/configure-language-nodejs) e [referência de configurações do App Service](https://learn.microsoft.com/azure/app-service/reference-app-settings).


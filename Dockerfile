# Usa uma imagem oficial do Node.js
FROM node:18-alpine

# Define o diretório de trabalho dentro do container
WORKDIR /app

# Copia o package.json e instala as dependências
COPY package*.json ./
RUN npm install

# Copia todo o código do seu repositório para dentro do container
COPY . .

# Comando para iniciar o servidor
CMD ["npx", "tsx", "server.ts"]

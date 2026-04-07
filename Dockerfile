FROM node:20-alpine

WORKDIR /app

# Copiar arquivos de dependências
COPY package*.json ./

# Instalar dependências (incluindo devDependencies para build)
RUN npm install

# Copiar código fonte
COPY . .

# Expor porta
EXPOSE 3000

# Iniciar aplicação com tsx (executa TypeScript diretamente)
CMD ["npm", "start"]

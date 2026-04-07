import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

// Carrega variáveis de ambiente primeiro
dotenv.config();

// Função para inicializar o Firebase Admin
function initializeFirebaseAdmin() {
  // Verifica se já foi inicializado para evitar duplicação
  if (admin.apps.length > 0) {
    return admin.apps[0];
  }

  // Opção 1: Usar arquivo service-account.json se existir
  const serviceAccountFile = path.join(process.cwd(), 'service-account.json');
  
  if (fs.existsSync(serviceAccountFile)) {
    console.log('Usando arquivo service-account.json');
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountFile, 'utf8'));
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  
  // Opção 2: Usar variáveis de ambiente
  if (process.env.FIREBASE_PROJECT_ID && 
      process.env.FIREBASE_CLIENT_EMAIL && 
      process.env.FIREBASE_PRIVATE_KEY) {
    console.log('Usando variáveis de ambiente');
    const serviceAccount = {
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
    };
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  
  // Opção 3: Usar Base64 (se disponível)
  if (process.env.SERVICE_ACCOUNT_BASE64) {
    console.log('Usando SERVICE_ACCOUNT_BASE64');
    const serviceAccountJson = Buffer.from(process.env.SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
    const serviceAccount = JSON.parse(serviceAccountJson);
    return admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  
  throw new Error('Nenhuma credencial do Firebase encontrada!');
}

// Inicializa o Firebase
try {
  initializeFirebaseAdmin();
  console.log('Firebase Admin inicializado com sucesso!');
} catch (error) {
  console.error('Erro ao inicializar Firebase:', error);
  process.exit(1);
}

const db = admin.firestore();
const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = mysql.createPool(process.env.DATABASE_URL || '');

// Rota de Migração de Usuários
app.post('/api/migrate-users-from-firebase', async (req, res) => {
  const { secret } = req.body;
  if (secret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  try {
    console.log('Iniciando migração de usuários...');
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    
    console.log(`Encontrados ${users.length} usuários no Firebase`);

    const connection = await pool.getConnection();
    let migratedCount = 0;
    
    for (const user of users) {
      try {
        await connection.query(
          'INSERT INTO users (id, name, email, role, company_id) VALUES (?, ?, ?, ?, ?)',
          [user.id, user.displayName || user.name || 'Sem nome', user.email || '', user.role || 'caregiver', user.companyId || 'default']
        );
        migratedCount++;
      } catch (dbError: any) {
        if (dbError.code === 'ER_DUP_ENTRY') {
          console.log(`Usuário ${user.id} já existe, pulando...`);
        } else {
          console.error(`Erro ao migrar usuário ${user.id}:`, dbError);
        }
      }
    }
    
    connection.release();
    console.log(`Migração concluída: ${migratedCount} de ${users.length} usuários migrados`);
    res.json({ 
      status: 'Migração concluída', 
      total: users.length,
      migrated: migratedCount,
      skipped: users.length - migratedCount
    });
  } catch (error) {
    console.error('Erro na migração:', error);
    res.status(500).json({ error: 'Erro na migração', details: String(error) });
  }
});

// Rota de saúde para verificar se a API está funcionando
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', firebase: admin.apps.length > 0 ? 'conectado' : 'erro' });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT}`);
  console.log(`Firebase Apps inicializados: ${admin.apps.length}`);
});

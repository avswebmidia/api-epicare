import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

// Inicializa o Firebase Admin
function initializeFirebase() {
  // Verifica se já foi inicializado
  if (admin.apps.length > 0) {
    console.log('Firebase já inicializado');
    return;
  }

  // Tenta inicializar com SERVICE_ACCOUNT_BASE64
  if (process.env.SERVICE_ACCOUNT_BASE64) {
    try {
      console.log('Inicializando Firebase com SERVICE_ACCOUNT_BASE64...');
      const serviceAccountJson = Buffer.from(process.env.SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
      const serviceAccount = JSON.parse(serviceAccountJson);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase inicializado com sucesso!');
      console.log(`Projeto: ${serviceAccount.project_id}`);
      return;
    } catch (error) {
      console.error('Erro ao inicializar com Base64:', error);
    }
  }

  // Tenta com variáveis individuais
  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    try {
      console.log('Inicializando Firebase com variáveis de ambiente...');
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
      });
      console.log('✅ Firebase inicializado com sucesso!');
      return;
    } catch (error) {
      console.error('Erro ao inicializar com variáveis:', error);
    }
  }

  throw new Error('Nenhuma credencial do Firebase encontrada!');
}

// Executa a inicialização
try {
  initializeFirebase();
} catch (error) {
  console.error('❌ Falha ao inicializar Firebase:', error);
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
        console.log(`✅ Usuário ${user.id} migrado`);
      } catch (dbError: any) {
        if (dbError.code === 'ER_DUP_ENTRY') {
          console.log(`⚠️ Usuário ${user.id} já existe, pulando...`);
        } else {
          console.error(`❌ Erro ao migrar usuário ${user.id}:`, dbError.message);
        }
      }
    }
    
    connection.release();
    console.log(`🎉 Migração concluída: ${migratedCount} de ${users.length} usuários migrados`);
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

// Rota de saúde
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    firebase: admin.apps.length > 0 ? 'conectado' : 'erro',
    timestamp: new Date().toISOString()
  });
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 API rodando na porta ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

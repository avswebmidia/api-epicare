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

  // PRIORIDADE 1: SERVICE_ACCOUNT_BASE64
  if (process.env.SERVICE_ACCOUNT_BASE64) {
    try {
      console.log('Inicializando Firebase com SERVICE_ACCOUNT_BASE64...');
      const serviceAccountJson = Buffer.from(process.env.SERVICE_ACCOUNT_BASE64, 'base64').toString('utf-8');
      const serviceAccount = JSON.parse(serviceAccountJson);
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase inicializado com sucesso via Base64!');
      console.log(`📁 Projeto: ${serviceAccount.project_id}`);
      console.log(`📧 Email: ${serviceAccount.client_email}`);
      return;
    } catch (error) {
      console.error('❌ Erro ao inicializar com Base64:', error);
    }
  } else {
    console.log('⚠️ SERVICE_ACCOUNT_BASE64 não encontrada');
  }

  // PRIORIDADE 2: Tentar ler arquivo service-account.json
  try {
    const fs = require('fs');
    const path = require('path');
    const filePath = path.join(process.cwd(), 'service-account.json');
    
    if (fs.existsSync(filePath)) {
      console.log('Inicializando Firebase com arquivo service-account.json...');
      const serviceAccount = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log('✅ Firebase inicializado com sucesso via arquivo!');
      return;
    }
  } catch (error) {
    console.error('Erro ao ler arquivo:', error);
  }

  throw new Error('❌ Nenhuma credencial do Firebase encontrada! Certifique-se de configurar SERVICE_ACCOUNT_BASE64');
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

// ROTA 1: Listar todas as coleções do Firestore
app.get('/api/list-collections', async (req, res) => {
  try {
    console.log('Listando coleções do Firestore...');
    const collections = await db.listCollections();
    const collectionNames = collections.map(col => col.id);
    
    console.log(`Coleções encontradas: ${collectionNames.join(', ') || 'nenhuma'}`);
    res.json({ 
      success: true,
      collections: collectionNames,
      count: collectionNames.length,
      message: collectionNames.length === 0 ? 'Nenhuma coleção encontrada no Firestore' : `${collectionNames.length} coleção(ões) encontrada(s)`
    });
  } catch (error) {
    console.error('Erro ao listar coleções:', error);
    res.status(500).json({ 
      success: false,
      error: String(error),
      message: 'Erro ao listar coleções do Firestore'
    });
  }
});

// ROTA 2: Testar se uma coleção específica existe
app.post('/api/test-collection', async (req, res) => {
  const { collectionName } = req.body;
  
  if (!collectionName) {
    return res.status(400).json({ 
      success: false,
      error: 'Informe collectionName no body da requisição' 
    });
  }
  
  try {
    console.log(`Testando coleção: ${collectionName}`);
    const snapshot = await db.collection(collectionName).limit(1).get();
    const count = snapshot.size;
    const hasData = count > 0;
    
    // Pega um documento exemplo se existir
    let sampleDoc = null;
    if (hasData) {
      const doc = snapshot.docs[0];
      sampleDoc = {
        id: doc.id,
        data: doc.data()
      };
    }
    
    console.log(`Coleção '${collectionName}': ${hasData ? 'existe com dados' : 'existe mas está vazia'}`);
    res.json({ 
      success: true,
      exists: true,
      collectionName,
      hasData,
      documentCount: hasData ? 'pelo menos 1' : 0,
      sampleDocument: sampleDoc,
      message: hasData ? `Coleção '${collectionName}' encontrada com dados` : `Coleção '${collectionName}' encontrada mas está vazia`
    });
  } catch (error: any) {
    console.error(`Erro ao testar coleção '${collectionName}':`, error.message);
    res.json({ 
      success: false,
      exists: false,
      collectionName,
      error: error.message,
      message: `Coleção '${collectionName}' não encontrada ou não pode ser acessada`
    });
  }
});

// ROTA 3: Criar um usuário de teste no Firestore
app.post('/api/create-test-user', async (req, res) => {
  const { secret, collectionName = 'users' } = req.body;
  
  if (secret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  try {
    console.log(`Criando usuário de teste na coleção: ${collectionName}`);
    
    const testUser = {
      displayName: "Usuário Teste",
      name: "Usuário Teste",
      email: "teste@exemplo.com",
      role: "admin",
      companyId: "test-company",
      createdAt: new Date().toISOString(),
      active: true
    };
    
    const docRef = await db.collection(collectionName).add(testUser);
    
    console.log(`✅ Usuário de teste criado com ID: ${docRef.id}`);
    res.json({ 
      success: true,
      message: "Usuário de teste criado com sucesso",
      id: docRef.id,
      collection: collectionName,
      data: testUser
    });
  } catch (error) {
    console.error('Erro ao criar usuário de teste:', error);
    res.status(500).json({ 
      success: false,
      error: String(error),
      message: 'Erro ao criar usuário de teste'
    });
  }
});

// ROTA 4: Migração de Usuários (melhorada - permite especificar coleção)
app.post('/api/migrate-users-from-firebase', async (req, res) => {
  const { secret, collectionName = 'users' } = req.body;
  
  if (secret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  try {
    console.log(`Iniciando migração da coleção: ${collectionName}`);
    
    // Verifica se a coleção existe
    const collections = await db.listCollections();
    const collectionNames = collections.map(col => col.id);
    
    if (!collectionNames.includes(collectionName)) {
      return res.status(404).json({ 
        success: false,
        error: `Coleção '${collectionName}' não encontrada`,
        availableCollections: collectionNames,
        message: `Coleção não encontrada. Coleções disponíveis: ${collectionNames.join(', ') || 'nenhuma'}`
      });
    }
    
    const snapshot = await db.collection(collectionName).get();
    const users = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));
    
    console.log(`Encontrados ${users.length} documentos na coleção '${collectionName}'`);

    if (users.length === 0) {
      return res.json({ 
        success: true,
        status: 'Nenhum documento encontrado', 
        collection: collectionName,
        count: 0,
        message: `A coleção '${collectionName}' está vazia`
      });
    }

    const connection = await pool.getConnection();
    let migratedCount = 0;
    let errorCount = 0;
    
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
          errorCount++;
          console.error(`❌ Erro ao migrar usuário ${user.id}:`, dbError.message);
        }
      }
    }
    
    connection.release();
    console.log(`🎉 Migração concluída: ${migratedCount} migrados, ${errorCount} erros, ${users.length - migratedCount - errorCount} pulados`);
    
    res.json({ 
      success: true,
      status: 'Migração concluída', 
      collection: collectionName,
      total: users.length,
      migrated: migratedCount,
      skipped: users.length - migratedCount - errorCount,
      errors: errorCount
    });
  } catch (error) {
    console.error('Erro na migração:', error);
    res.status(500).json({ 
      success: false,
      error: 'Erro na migração', 
      details: String(error) 
    });
  }
});

// ROTA 5: Saúde da API
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
  console.log(`📋 Listar coleções: http://localhost:${PORT}/api/list-collections`);
});

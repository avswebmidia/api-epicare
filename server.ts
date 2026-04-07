import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Inicializar Firebase Admin usando a variável SERVICE_ACCOUNT_BASE64
if (!process.env.SERVICE_ACCOUNT_BASE64) {
  console.error('❌ SERVICE_ACCOUNT_BASE64 não encontrada no .env');
  process.exit(1);
}

// Decodificar o Base64 e fazer parse do JSON
const serviceAccount = JSON.parse(
  Buffer.from(process.env.SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

console.log('✅ Firebase Admin inicializado com sucesso');

const pool = mysql.createPool('mysql://avsinfortec:%40avs22562@whats_sqlepicore:3306/bdepicore');

// Rota para criar usuários admin e superadmin
app.post('/api/create-users', async (req, res) => {
  const { secret } = req.body;
  
  if (secret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    const users = [
      {
        uid: 'admin_001',
        company_id: 'epicare',
        email: 'admin@epicare.com',
        role: 'super-admin',
        display_name: 'Administrador Principal',
        cpf: null,
        phone: null,
        password_hash: 'admin123'
      },
      {
        uid: 'superadmin_001',
        company_id: 'epicare',
        email: 'superadmin@epicare.com',
        role: 'super-admin',
        display_name: 'Super Administrador',
        cpf: null,
        phone: null,
        password_hash: 'superadmin123'
      },
      {
        uid: 'admin_comum_001',
        company_id: 'epicare',
        email: 'admin@epicare.com.br',
        role: 'admin',
        display_name: 'Administrador Comum',
        cpf: null,
        phone: null,
        password_hash: 'admin123'
      }
    ];
    
    let created = 0;
    let errors = 0;
    const errorDetails = [];
    
    for (const user of users) {
      try {
        const [existing] = await connection.query(
          'SELECT uid FROM users WHERE email = ?',
          [user.email]
        );
        
        if (Array.isArray(existing) && existing.length > 0) {
          await connection.query(
            `UPDATE users SET 
              role = ?, 
              display_name = ?, 
              password_hash = ?
             WHERE email = ?`,
            [user.role, user.display_name, user.password_hash, user.email]
          );
          console.log(`✅ Usuário ${user.email} atualizado`);
          created++;
        } else {
          await connection.query(
            `INSERT INTO users (
              uid, company_id, email, role, display_name, cpf, phone, password_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.uid, user.company_id, user.email, user.role, user.display_name, user.cpf, user.phone, user.password_hash]
          );
          console.log(`✅ Usuário ${user.email} criado`);
          created++;
        }
      } catch (error: any) {
        errors++;
        errorDetails.push({
          email: user.email,
          error: error.message,
          code: error.code
        });
        console.error(`❌ Erro ao processar ${user.email}:`, error.message);
      }
    }
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Usuários processados',
      created: created,
      errors: errors,
      errorDetails: errorDetails,
      users: users.map(u => ({ 
        email: u.email, 
        role: u.role,
        uid: u.uid
      }))
    });
    
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar usuários', details: String(error) });
  }
});

// Rota de login COM Firebase Token
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    const [rows] = await connection.query(
      `SELECT uid, company_id, email, role, display_name, cpf, phone 
       FROM users 
       WHERE email = ? AND password_hash = ?`,
      [email, password]
    );
    
    connection.release();
    
    if (Array.isArray(rows) && rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }
    
    const user = rows[0];
    
    // Gerar token customizado do Firebase
    const customToken = await admin.auth().createCustomToken(user.uid);
    
    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      user: user,
      firebaseToken: customToken
    });
    
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
});

// Rota para listar todos os usuários
app.get('/api/users', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT uid, company_id, email, role, display_name, cpf, phone FROM users ORDER BY uid'
    );
    connection.release();
    
    res.json({
      success: true,
      users: rows,
      count: Array.isArray(rows) ? rows.length : 0
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar usuários' });
  }
});

// Rota para deletar um usuário
app.delete('/api/users/:uid', async (req, res) => {
  const { secret } = req.body;
  const { uid } = req.params;
  
  if (secret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query('DELETE FROM users WHERE uid = ?', [uid]);
    connection.release();
    
    res.json({
      success: true,
      message: 'Usuário deletado com sucesso',
      affectedRows: (result as any).affectedRows
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao deletar usuário' });
  }
});

// Rota de saúde
app.get('/api/health', async (req, res) => {
  let mysqlStatus = 'disconnected';
  try {
    const connection = await pool.getConnection();
    mysqlStatus = 'connected';
    connection.release();
  } catch (error) {
    mysqlStatus = 'error';
  }
  
  res.json({ 
    status: 'OK',
    mysql: mysqlStatus,
    timestamp: new Date().toISOString()
  });
});

// Rota raiz com documentação
app.get('/', (req, res) => {
  res.json({
    message: 'API da Epicare está funcionando!',
    endpoints: {
      health: '/api/health',
      users: '/api/users',
      login: '/api/login',
      createUsers: '/api/create-users',
      patients: '/api/patients',
      companies: '/api/companies',
      plans: '/api/plans'
    },
    documentation: 'https://whats-epicare-api.y7nagi.easypanel.host/api/health'
  });
});

// Rota para listar pacientes
app.get('/api/patients', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM patients ORDER BY created_at DESC'
    );
    connection.release();
    
    res.json({
      success: true,
      patients: rows,
      count: Array.isArray(rows) ? rows.length : 0
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar pacientes' });
  }
});

// Rota para criar paciente
app.post('/api/patients', async (req, res) => {
  const { name, phone, email, cpf, birth_date, notes } = req.body;
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO patients (name, phone, email, cpf, birth_date, notes) 
       VALUES (?, ?, ?, ?, ?, ?)`,
      [name, phone, email, cpf, birth_date, notes]
    );
    connection.release();
    
    res.json({
      success: true,
      message: 'Paciente criado com sucesso',
      patientId: (result as any).insertId
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar paciente' });
  }
});

// ============================================
// ENDPOINTS CORRIGIDOS COM DADOS MOCKADOS
// ============================================

// Rota para empresas - Dados mockados
app.get('/api/companies', async (req, res) => {
  try {
    // Dados mockados para teste
    const mockCompanies = [
      { 
        id: 1, 
        name: 'Tech Solutions Ltda', 
        document: '12.345.678/0001-90',
        email: 'contato@techsolutions.com',
        phone: '(11) 3456-7890',
        plan_id: 1,
        status: 'active',
        created_at: new Date().toISOString()
      },
      { 
        id: 2, 
        name: 'Saúde Total Ltda', 
        document: '98.765.432/0001-10',
        email: 'contato@saudetotal.com',
        phone: '(11) 98765-4321',
        plan_id: 2,
        status: 'active',
        created_at: new Date().toISOString()
      },
      { 
        id: 3, 
        name: 'Educação Avançada', 
        document: '45.678.912/0001-34',
        email: 'contato@educacaoavancada.com',
        phone: '(11) 4567-8901',
        plan_id: 3,
        status: 'inactive',
        created_at: new Date().toISOString()
      }
    ];
    
    res.json(mockCompanies);
  } catch (error) {
    console.error('Erro ao buscar empresas:', error);
    res.status(500).json([]);
  }
});

// Rota para planos - Dados mockados
app.get('/api/plans', async (req, res) => {
  try {
    // Dados mockados para teste
    const mockPlans = [
      { 
        id: 1, 
        name: 'Plano Básico', 
        price: 99.90,
        description: 'Ideal para pequenas empresas',
        features: ['Até 10 usuários', '100 clientes', 'Suporte por email'],
        status: 'active'
      },
      { 
        id: 2, 
        name: 'Plano Profissional', 
        price: 199.90,
        description: 'Para empresas em crescimento',
        features: ['Até 50 usuários', '500 clientes', 'Suporte prioritário', 'Relatórios avançados'],
        status: 'active'
      },
      { 
        id: 3, 
        name: 'Plano Enterprise', 
        price: 399.90,
        description: 'Solução completa',
        features: ['Usuários ilimitados', 'Clientes ilimitados', 'Suporte 24/7', 'API personalizada', 'Treinamento incluso'],
        status: 'active'
      },
      { 
        id: 4, 
        name: 'Plano Free', 
        price: 0,
        description: 'Para testes',
        features: ['Até 3 usuários', '10 clientes', 'Suporte comunidade'],
        status: 'inactive'
      }
    ];
    
    res.json(mockPlans);
  } catch (error) {
    console.error('Erro ao buscar planos:', error);
    res.status(500).json([]);
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 API rodando na porta ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`\n📝 Endpoints:`);
  console.log(`  POST /api/create-users - Criar usuários`);
  console.log(`  POST /api/login - Login (retorna firebaseToken)`);
  console.log(`  GET  /api/users - Listar usuários`);
  console.log(`  DELETE /api/users/:uid - Deletar usuário`);
  console.log(`  GET  /api/patients - Listar pacientes`);
  console.log(`  POST /api/patients - Criar paciente`);
  console.log(`  GET  /api/companies - Listar empresas (mock)`);
  console.log(`  GET  /api/plans - Listar planos (mock)`);
  console.log(`\n🔑 Credenciais:`);
  console.log(`  Admin: admin@epicare.com / admin123`);
  console.log(`  Super Admin: superadmin@epicare.com / superadmin123`);
});

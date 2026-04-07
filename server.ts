import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcrypt'; // Para criptografar senhas

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = mysql.createPool(process.env.DATABASE_URL || '');

// Rota para criar usuários (admin e superadmin)
app.post('/api/create-users', async (req, res) => {
  const { secret } = req.body;
  
  // Segurança: só quem sabe o segredo pode criar usuários
  if (secret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    // Criptografa as senhas
    const saltRounds = 10;
    const adminPassword = await bcrypt.hash('admin123', saltRounds);
    const superAdminPassword = await bcrypt.hash('superadmin123', saltRounds);
    
    // Lista de usuários para criar
    const users = [
      {
        id: 'admin_001',
        name: 'Administrador',
        email: 'admin@epicare.com',
        role: 'admin',
        company_id: 'epicare',
        password: adminPassword,
        active: true,
        created_at: new Date()
      },
      {
        id: 'superadmin_001',
        name: 'Super Administrador',
        email: 'avsinfortec@gmail.com',
        role: '@avs22562',
        company_id: 'epicare',
        password: superAdminPassword,
        active: true,
        created_at: new Date()
      }
    ];
    
    let created = 0;
    let errors = 0;
    
    for (const user of users) {
      try {
        await connection.query(
          `INSERT INTO users (id, name, email, role, company_id, password, active, created_at) 
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [user.id, user.name, user.email, user.role, user.company_id, user.password, user.active, user.created_at]
        );
        created++;
        console.log(`✅ Usuário ${user.email} (${user.role}) criado com sucesso`);
      } catch (dbError: any) {
        if (dbError.code === 'ER_DUP_ENTRY') {
          console.log(`⚠️ Usuário ${user.email} já existe, atualizando...`);
          // Se já existe, atualiza
          await connection.query(
            `UPDATE users SET name = ?, role = ?, company_id = ?, password = ?, active = ? WHERE email = ?`,
            [user.name, user.role, user.company_id, user.password, user.active, user.email]
          );
          created++;
        } else {
          errors++;
          console.error(`❌ Erro ao criar ${user.email}:`, dbError.message);
        }
      }
    }
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Usuários criados/atualizados com sucesso',
      created: created,
      errors: errors,
      users: users.map(u => ({ email: u.email, role: u.role }))
    });
    
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar usuários', details: String(error) });
  }
});

// Rota de login (para testar)
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    const [rows] = await connection.query(
      'SELECT id, name, email, role, company_id, password, active FROM users WHERE email = ?',
      [email]
    );
    
    connection.release();
    
    if (Array.isArray(rows) && rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }
    
    const user = rows[0];
    
    // Verifica se o usuário está ativo
    if (!user.active) {
      return res.status(401).json({ error: 'Usuário desativado' });
    }
    
    // Verifica a senha
    const isValidPassword = await bcrypt.compare(password, user.password);
    
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }
    
    // Não enviar a senha na resposta
    delete user.password;
    
    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      user: user
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
      'SELECT id, name, email, role, company_id, active, created_at FROM users ORDER BY created_at DESC'
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

// Rota para criar um novo usuário (via API)
app.post('/api/register', async (req, res) => {
  const { name, email, password, role, company_id, adminSecret } = req.body;
  
  // Verifica se é admin criando (opcional)
  if (adminSecret && adminSecret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Nome, email e senha são obrigatórios' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    // Verifica se email já existe
    const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [email]);
    
    if (Array.isArray(existing) && existing.length > 0) {
      connection.release();
      return res.status(400).json({ error: 'Email já cadastrado' });
    }
    
    // Criptografa a senha
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);
    
    // Gera um ID único
    const id = `user_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    // Insere o novo usuário
    await connection.query(
      `INSERT INTO users (id, name, email, password, role, company_id, active, created_at) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, hashedPassword, role || 'caregiver', company_id || 'default', true, new Date()]
    );
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Usuário criado com sucesso',
      user: { id, name, email, role: role || 'caregiver' }
    });
    
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar usuário' });
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

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 API rodando na porta ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`\n📝 Comandos úteis:`);
  console.log(`  - Criar usuários admin: curl -X POST http://localhost:${PORT}/api/create-users -H "Content-Type: application/json" -d '{"secret":"MIGRACAO_SECRETA_2026"}'`);
  console.log(`  - Listar usuários: curl http://localhost:${PORT}/api/users`);
  console.log(`  - Login: curl -X POST http://localhost:${PORT}/api/login -H "Content-Type: application/json" -d '{"email":"admin@epicare.com","password":"admin123"}'`);
});

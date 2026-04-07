import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = mysql.createPool(process.env.DATABASE_URL || '');

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
        password_hash: 'admin123'
      },
      {
        uid: 'superadmin_001',
        company_id: 'epicare',
        email: 'superadmin@epicare.com',
        role: 'super-admin',
        display_name: 'Super Administrador',
        password_hash: 'superadmin123'
      },
      {
        uid: 'admin_comum_001',
        company_id: 'epicare',
        email: 'admin@epicare.com.br',
        role: 'admin',
        display_name: 'Administrador Comum',
        password_hash: 'admin123'
      }
    ];
    
    let created = 0;
    let errors = 0;
    
    for (const user of users) {
      try {
        // Verificar se já existe
        const [existing] = await connection.query(
          'SELECT uid FROM users WHERE email = ?',
          [user.email]
        );
        
        if (Array.isArray(existing) && existing.length > 0) {
          // Atualizar existente
          await connection.query(
            `UPDATE users SET 
              role = ?, 
              display_name = ?, 
              password_hash = ?,
              updated_at = NOW()
             WHERE email = ?`,
            [user.role, user.display_name, user.password_hash, user.email]
          );
          console.log(`✅ Usuário ${user.email} atualizado`);
        } else {
          // Inserir novo
          await connection.query(
            `INSERT INTO users (
              uid, company_id, email, role, display_name, 
              password_hash, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [user.uid, user.company_id, user.email, user.role, user.display_name, user.password_hash]
          );
          console.log(`✅ Usuário ${user.email} criado`);
        }
        created++;
      } catch (error) {
        errors++;
        console.error(`❌ Erro ao processar ${user.email}:`, error);
      }
    }
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Usuários processados com sucesso',
      created: created,
      errors: errors,
      users: users.map(u => ({ email: u.email, role: u.role, password: u.password_hash }))
    });
    
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar usuários', details: String(error) });
  }
});

// Rota de login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    const [rows] = await connection.query(
      'SELECT uid, email, role, display_name, company_id, password_hash FROM users WHERE email = ?',
      [email]
    );
    
    connection.release();
    
    if (Array.isArray(rows) && rows.length === 0) {
      return res.status(401).json({ error: 'Usuário não encontrado' });
    }
    
    const user = rows[0];
    
    // Comparação direta sem criptografia
    if (password !== user.password_hash) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }
    
    delete user.password_hash;
    
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
      'SELECT uid, email, role, display_name, company_id, created_at FROM users ORDER BY created_at DESC'
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
  console.log(`\n📝 Endpoints:`);
  console.log(`  POST /api/create-users - Criar usuários`);
  console.log(`  POST /api/login - Login`);
  console.log(`  GET  /api/users - Listar usuários`);
  console.log(`\n🔑 Credenciais:`);
  console.log(`  Admin: admin@epicare.com / admin123`);
  console.log(`  Super Admin: superadmin@epicare.com / superadmin123`);
});

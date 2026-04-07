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
        // Verificar se já existe pelo email
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
              password_hash = ?
             WHERE email = ?`,
            [user.role, user.display_name, user.password_hash, user.email]
          );
          console.log(`✅ Usuário ${user.email} atualizado`);
          created++;
        } else {
          // Inserir novo usuário
          await connection.query(
            `INSERT INTO users (
              uid, 
              company_id, 
              email, 
              role, 
              display_name, 
              cpf, 
              phone, 
              password_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              user.uid, 
              user.company_id, 
              user.email, 
              user.role, 
              user.display_name, 
              user.cpf, 
              user.phone, 
              user.password_hash
            ]
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

// Rota de login
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

// Rota para deletar um usuário (opcional)
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

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n🚀 API rodando na porta ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
  console.log(`\n📝 Endpoints:`);
  console.log(`  POST /api/create-users - Criar usuários`);
  console.log(`  POST /api/login - Login`);
  console.log(`  GET  /api/users - Listar usuários`);
  console.log(`  DELETE /api/users/:uid - Deletar usuário`);
  console.log(`\n🔑 Credenciais:`);
  console.log(`  Admin: admin@epicare.com / admin123`);
  console.log(`  Super Admin: superadmin@epicare.com / superadmin123`);
});

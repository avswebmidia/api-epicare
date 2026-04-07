import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const pool = mysql.createPool(process.env.DATABASE_URL || '');
const JWT_SECRET = process.env.JWT_SECRET || 'super-segredo-epicare';

// --- Rotas de Autenticação ---

// Registro de Usuário
app.post('/api/register', async (req, res) => {
  const { uid, email, password, role, company_id, display_name } = req.body;
  
  try {
    const password_hash = await bcrypt.hash(password, 10);
    await pool.query(
      'INSERT INTO users (uid, email, password_hash, role, company_id, display_name) VALUES (?, ?, ?, ?, ?, ?)',
      [uid, email, password_hash, role, company_id, display_name]
    );
    res.status(201).json({ success: true });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao registrar usuário' });
  }
});

// Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  
  try {
    const [rows]: any = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
    if (rows.length === 0) return res.status(401).json({ error: 'Usuário não encontrado' });
    
    const user = rows[0];
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Senha incorreta' });
    
    const token = jwt.sign({ uid: user.uid, role: user.role, companyId: user.company_id }, JWT_SECRET, { expiresIn: '24h' });
    res.json({ token, user: { uid: user.uid, email: user.email, role: user.role, display_name: user.display_name } });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro no login' });
  }
});

// --- Rotas de Dados (MySQL) ---

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'API Online', database: 'conectado' });
  } catch (e) {
    res.status(500).json({ status: 'API Online', database: 'erro' });
  }
});

app.get('/api/patients', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar pacientes' });
  }
});

app.get('/api/medications', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM medications');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar medicações' });
  }
});

app.get('/api/administrations', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM administrations');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar administrações' });
  }
});

app.get('/api/seizures', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM seizures');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar crises' });
  }
});

app.get('/api/monitoring_logs', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM monitoring_logs');
    res.json(rows);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro ao buscar logs' });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT}`);
});

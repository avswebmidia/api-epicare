import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Verifica se DATABASE_URL existe
if (!process.env.DATABASE_URL) {
  console.error('ERRO: DATABASE_URL não configurada!');
  process.exit(1);
}

// Conexão com o MySQL
const pool = mysql.createPool(process.env.DATABASE_URL);

// Teste de conexão com o banco
app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'API Online', database: 'conectado' });
  } catch (error) {
    res.status(500).json({ status: 'API Online', database: 'erro', error: error.message });
  }
});

// Rota para buscar pacientes
app.get('/api/patients', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients');
    res.json(rows);
  } catch (error) {
    console.error('Erro em /api/patients:', error);
    res.status(500).json({ error: 'Erro ao buscar pacientes', details: error.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ API rodando na porta ${PORT}`);
  console.log(`📊 DATABASE_URL configurada: ${process.env.DATABASE_URL ? 'sim' : 'não'}`);
});

import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

// Conexão com o MySQL
const pool = mysql.createPool(process.env.DATABASE_URL || '');

app.get('/api/health', (req, res) => {
  res.json({ status: 'API Online' });
});

// Exemplo de rota para buscar pacientes
app.get('/api/patients', async (req, res) => {
  try {
    const [rows] = await pool.query('SELECT * FROM patients');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: 'Erro ao buscar pacientes' });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT}`);
});

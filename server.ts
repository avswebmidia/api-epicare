import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Aumentei o limite para dados grandes

const pool = mysql.createPool(process.env.DATABASE_URL || '');

app.get('/api/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'API Online', database: 'conectado' });
  } catch (e) {
    res.status(500).json({ status: 'API Online', database: 'erro' });
  }
});

// Rotas de Leitura
app.get('/api/patients', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM patients');
  res.json(rows);
});

// Rota de Migração (Para mover dados do Firebase para o MySQL)
app.post('/api/migrate', async (req, res) => {
  const { table, data } = req.body;
  
  try {
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    for (const item of data) {
      if (table === 'patients') {
        await connection.query(
          'INSERT INTO patients (id, company_id, name, owner_uid, created_at) VALUES (?, ?, ?, ?, ?)',
          [item.id, item.companyId || 'default', item.name, item.ownerUid, item.createdAt]
        );
      }
      // Podemos adicionar outras tabelas aqui conforme necessário
    }

    await connection.commit();
    connection.release();
    res.json({ status: 'Migração concluída' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro na migração' });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT}`);
});

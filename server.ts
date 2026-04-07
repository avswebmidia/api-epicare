import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin'; // Precisamos disso para ler do Firebase

dotenv.config();

// Inicialize o Firebase Admin aqui (certifique-se de ter o service-account.json)
// admin.initializeApp({ ... }); 
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
    const snapshot = await db.collection('users').get();
    const users = snapshot.docs.map((d: any) => ({ id: d.id, ...d.data() }));

    const connection = await pool.getConnection();
    for (const user of users) {
      await connection.query(
        'INSERT INTO users (id, name, email, role, company_id) VALUES (?, ?, ?, ?, ?)',
        [user.id, user.displayName || user.name || 'Sem nome', user.email || '', user.role || 'caregiver', user.companyId || 'default']
      );
    }
    connection.release();
    res.json({ status: 'Migração concluída', count: users.length });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro na migração' });
  }
});

const PORT = 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API rodando na porta ${PORT}`);
});

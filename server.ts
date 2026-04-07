import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';

const serviceAccount = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'service-account.json'), 'utf8'));

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});
dotenv.config();

// Cria o arquivo service-account.json na memória/disco temporário
const serviceAccountPath = path.join(process.cwd(), 'service-account.json');
const serviceAccount = {
  projectId: process.env.FIREBASE_PROJECT_ID,
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
};

fs.writeFileSync(serviceAccountPath, JSON.stringify(serviceAccount));

// Inicializa usando o arquivo criado
admin.initializeApp({
  credential: admin.credential.cert(serviceAccountPath)
});

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

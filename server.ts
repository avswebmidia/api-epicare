import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

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

// ============================================
// FUNÇÃO PARA CRIAR/VERIFICAR TODAS AS TABELAS
// ============================================

async function ensureTables() {
  const connection = await pool.getConnection();
  try {
    // 1. Tabela users
    await connection.query(`
      CREATE TABLE IF NOT EXISTS users (
        uid VARCHAR(255) PRIMARY KEY,
        company_id VARCHAR(255),
        email VARCHAR(255) UNIQUE NOT NULL,
        role VARCHAR(50),
        display_name VARCHAR(255),
        cpf VARCHAR(14),
        phone VARCHAR(20),
        password_hash VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabela users verificada/criada');

    // 2. Tabela plans
    await connection.query(`
      CREATE TABLE IF NOT EXISTS plans (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        price DECIMAL(10, 2) NOT NULL,
        duration_days INT DEFAULT 30,
        features JSON,
        max_users INT DEFAULT 0,
        max_patients INT DEFAULT 0,
        status VARCHAR(50) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    console.log('✅ Tabela plans verificada/criada');

    // 3. Tabela companies
    await connection.query(`
      CREATE TABLE IF NOT EXISTS companies (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        document VARCHAR(18),
        email VARCHAR(255),
        phone VARCHAR(20),
        plan_id INT,
        status VARCHAR(50) DEFAULT 'active',
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(2),
        zip_code VARCHAR(10),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL
      )
    `);
    console.log('✅ Tabela companies verificada/criada');

    // 4. Tabela patients
    await connection.query(`
      CREATE TABLE IF NOT EXISTS patients (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        email VARCHAR(255),
        cpf VARCHAR(14),
        birth_date DATE,
        blood_type VARCHAR(3),
        allergies TEXT,
        emergency_contact VARCHAR(255),
        emergency_phone VARCHAR(20),
        notes TEXT,
        status VARCHAR(50) DEFAULT 'active',
        company_id INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL
      )
    `);
    console.log('✅ Tabela patients verificada/criada');

    // 5. Tabela medications
    await connection.query(`
      CREATE TABLE IF NOT EXISTS medications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        dosage VARCHAR(100),
        unit VARCHAR(50),
        manufacturer VARCHAR(255),
        stock_quantity INT DEFAULT 0,
        requires_prescription BOOLEAN DEFAULT FALSE,
        patient_id INT,
        prescribed_date DATE,
        end_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
      )
    `);
    console.log('✅ Tabela medications verificada/criada');

    // 6. Tabela seizures
    await connection.query(`
      CREATE TABLE IF NOT EXISTS seizures (
        id INT AUTO_INCREMENT PRIMARY KEY,
        patient_id INT NOT NULL,
        occurred_at DATETIME NOT NULL,
        duration_seconds INT,
        seizure_type VARCHAR(100),
        intensity INT CHECK (intensity BETWEEN 1 AND 10),
        triggers TEXT,
        symptoms TEXT,
        medication_taken TEXT,
        notes TEXT,
        reported_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Tabela seizures verificada/criada');

    // 7. Tabela administrations
    await connection.query(`
      CREATE TABLE IF NOT EXISTS administrations (
        id INT AUTO_INCREMENT PRIMARY KEY,
        medication_id INT NOT NULL,
        patient_id INT NOT NULL,
        scheduled_time DATETIME NOT NULL,
        administered_time DATETIME,
        status VARCHAR(50) DEFAULT 'pending',
        administered_by VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Tabela administrations verificada/criada');

    // 8. Tabela monitoring_logs
    await connection.query(`
      CREATE TABLE IF NOT EXISTS monitoring_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        patient_id INT NOT NULL,
        heart_rate INT,
        blood_pressure_systolic INT,
        blood_pressure_diastolic INT,
        oxygen_saturation INT,
        temperature DECIMAL(4,1),
        glucose_level INT,
        symptoms TEXT,
        notes TEXT,
        device_id VARCHAR(255),
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE
      )
    `);
    console.log('✅ Tabela monitoring_logs verificada/criada');

    // 9. Tabela reports
    await connection.query(`
      CREATE TABLE IF NOT EXISTS reports (
        id INT AUTO_INCREMENT PRIMARY KEY,
        patient_id INT,
        report_type VARCHAR(100),
        start_date DATE,
        end_date DATE,
        data JSON,
        generated_by VARCHAR(255),
        notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL
      )
    `);
    console.log('✅ Tabela reports verificada/criada');

    // 10. Tabela appointments
    await connection.query(`
      CREATE TABLE IF NOT EXISTS appointments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        patient_id INT NOT NULL,
        doctor_id VARCHAR(255),
        appointment_date DATETIME NOT NULL,
        duration_minutes INT DEFAULT 30,
        type VARCHAR(100) DEFAULT 'consultation',
        status VARCHAR(50) DEFAULT 'scheduled',
        notes TEXT,
        location VARCHAR(255),
        payment_status VARCHAR(50) DEFAULT 'pending',
        value DECIMAL(10,2),
        medical_report TEXT,
        prescription_notes TEXT,
        cancel_reason TEXT,
        cancelled_at DATETIME,
        completed_at DATETIME,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (doctor_id) REFERENCES users(uid) ON DELETE SET NULL
      )
    `);
    console.log('✅ Tabela appointments verificada/criada');

    // Inserir planos padrão se não existirem
    const [existingPlans] = await connection.query('SELECT COUNT(*) as count FROM plans');
    if (existingPlans[0].count === 0) {
      await connection.query(`
        INSERT INTO plans (name, description, price, duration_days, features, max_users, max_patients, status) VALUES
        ('Plano Básico', 'Ideal para pequenas empresas', 99.90, 30, '["Até 10 usuários", "100 pacientes", "Suporte email"]', 10, 100, 'active'),
        ('Plano Profissional', 'Para empresas em crescimento', 199.90, 30, '["Até 50 usuários", "500 pacientes", "Suporte prioritário", "Relatórios avançados"]', 50, 500, 'active'),
        ('Plano Enterprise', 'Solução completa', 399.90, 30, '["Usuários ilimitados", "Pacientes ilimitados", "Suporte 24/7", "API personalizada"]', 999999, 999999, 'active'),
        ('Plano Free', 'Para testes', 0, 30, '["Até 3 usuários", "10 pacientes", "Suporte comunidade"]', 3, 10, 'inactive')
      `);
      console.log('✅ Planos padrão inseridos');
    }

    // Inserir empresa padrão se não existir
    const [existingCompanies] = await connection.query('SELECT COUNT(*) as count FROM companies');
    if (existingCompanies[0].count === 0) {
      await connection.query(`
        INSERT INTO companies (name, document, email, phone, plan_id, status) VALUES
        ('Epicare Sistemas', '00.000.000/0001-00', 'contato@epicare.com', '(11) 99999-9999', 1, 'active')
      `);
      console.log('✅ Empresa padrão inserida');
    }

    console.log('🎉 Todas as tabelas foram verificadas/criadas com sucesso!');
  } catch (error) {
    console.error('❌ Erro ao criar tabelas:', error);
    throw error;
  } finally {
    connection.release();
  }
}

// ============================================
// ROTA PARA CRIAR USUÁRIOS COM UID TOKEN
// ============================================

app.post('/api/create-users', async (req, res) => {
  const { secret } = req.body;
  
  if (secret !== 'MIGRACAO_SECRETA_2026') {
    return res.status(403).json({ error: 'Acesso negado' });
  }
  
  try {
    const connection = await pool.getConnection();
    
    // Gerar UIDs como tokens Firebase
    const users = [
      {
        uid: uuidv4(),
        company_id: '1',
        email: 'admin@epicare.com',
        role: 'super-admin',
        display_name: 'Administrador Principal',
        cpf: null,
        phone: null,
        password_hash: 'admin123'
      },
      {
        uid: uuidv4(),
        company_id: '1',
        email: 'superadmin@epicare.com',
        role: 'super-admin',
        display_name: 'Super Administrador',
        cpf: null,
        phone: null,
        password_hash: 'superadmin123'
      },
      {
        uid: uuidv4(),
        company_id: '1',
        email: 'admin@epicare.com.br',
        role: 'admin',
        display_name: 'Administrador Comum',
        cpf: null,
        phone: null,
        password_hash: 'admin123'
      },
      {
        uid: uuidv4(),
        company_id: '1',
        email: 'avsinfortec@gmail.com',
        role: 'super-admin',
        display_name: 'AVS Informática',
        cpf: null,
        phone: null,
        password_hash: '@avs22562'
      }
    ];
    
    let created = 0;
    let errors = 0;
    const errorDetails = [];
    
    for (const user of users) {
      try {
        // Verificar se o email já existe
        const [existing] = await connection.query(
          'SELECT uid FROM users WHERE email = ?',
          [user.email]
        );
        
        if (Array.isArray(existing) && existing.length > 0) {
          // Atualizar usuário existente
          await connection.query(
            `UPDATE users SET 
              role = ?, 
              display_name = ?, 
              password_hash = ?,
              uid = ?
             WHERE email = ?`,
            [user.role, user.display_name, user.password_hash, user.uid, user.email]
          );
          console.log(`✅ Usuário ${user.email} atualizado com novo UID: ${user.uid}`);
          created++;
        } else {
          // Criar novo usuário
          await connection.query(
            `INSERT INTO users (
              uid, company_id, email, role, display_name, cpf, phone, password_hash
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.uid, user.company_id, user.email, user.role, user.display_name, user.cpf, user.phone, user.password_hash]
          );
          console.log(`✅ Usuário ${user.email} criado com UID: ${user.uid}`);
          created++;
        }
        
        // Criar usuário no Firebase Authentication
        try {
          const firebaseUser = await admin.auth().getUserByEmail(user.email);
          console.log(`✅ Usuário ${user.email} já existe no Firebase`);
        } catch (firebaseError) {
          // Usuário não existe no Firebase, criar
          await admin.auth().createUser({
            uid: user.uid,
            email: user.email,
            password: user.password_hash,
            displayName: user.display_name
          });
          console.log(`✅ Usuário ${user.email} criado no Firebase com UID: ${user.uid}`);
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
      message: 'Usuários processados com UIDs Firebase',
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

// ============================================
// ROTA DE LOGIN COM FIREBASE TOKEN
// ============================================

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
    
    // Gerar token customizado do Firebase usando o UID do banco
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

// ============================================
// ROTA PARA LISTAR USUÁRIOS
// ============================================

app.get('/api/users', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
  'SELECT uid, company_id, email, role, display_name, cpf, phone FROM users ORDER BY uid DESC'
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

// ============================================
// ROTA PARA DELETAR USUÁRIO
// ============================================

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
    
    // Deletar também do Firebase Authentication
    try {
      await admin.auth().deleteUser(uid);
      console.log(`✅ Usuário ${uid} deletado do Firebase`);
    } catch (firebaseError) {
      console.log(`⚠️ Usuário ${uid} não encontrado no Firebase`);
    }
    
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

// ============================================
// ENDPOINTS - PATIENTS
// ============================================

app.get('/api/patients', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT p.*, 
             COUNT(DISTINCT s.id) as seizures_count,
             COUNT(DISTINCT m.id) as medications_count
      FROM patients p
      LEFT JOIN seizures s ON p.id = s.patient_id
      LEFT JOIN medications m ON p.id = m.patient_id
      GROUP BY p.id
      ORDER BY p.created_at DESC
    `);
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

app.get('/api/patients/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const connection = await pool.getConnection();
    const [patientRows] = await connection.query('SELECT * FROM patients WHERE id = ?', [id]);
    
    if (Array.isArray(patientRows) && patientRows.length === 0) {
      connection.release();
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    
    const [seizures] = await connection.query('SELECT * FROM seizures WHERE patient_id = ? ORDER BY occurred_at DESC', [id]);
    const [medications] = await connection.query('SELECT * FROM medications WHERE patient_id = ? ORDER BY prescribed_date DESC', [id]);
    const [monitoringLogs] = await connection.query('SELECT * FROM monitoring_logs WHERE patient_id = ? ORDER BY timestamp DESC LIMIT 10', [id]);
    
    connection.release();
    
    res.json({
      success: true,
      patient: patientRows[0],
      seizures,
      medications,
      monitoring_logs: monitoringLogs
    });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar paciente' });
  }
});

app.post('/api/patients', async (req, res) => {
  const { name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, company_id } = req.body;
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO patients (name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, company_id]
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

app.put('/api/patients/:id', async (req, res) => {
  const { id } = req.params;
  const { name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, status } = req.body;
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `UPDATE patients SET name=?, phone=?, email=?, cpf=?, birth_date=?, blood_type=?, allergies=?, emergency_contact=?, emergency_phone=?, notes=?, status=?
       WHERE id = ?`,
      [name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, status, id]
    );
    connection.release();
    
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    
    res.json({ success: true, message: 'Paciente atualizado com sucesso' });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao atualizar paciente' });
  }
});

app.delete('/api/patients/:id', async (req, res) => {
  const { id } = req.params;
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query('DELETE FROM patients WHERE id = ?', [id]);
    connection.release();
    
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Paciente não encontrado' });
    }
    
    res.json({ success: true, message: 'Paciente deletado com sucesso' });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao deletar paciente' });
  }
});

// ============================================
// ENDPOINTS - COMPANIES
// ============================================

app.get('/api/companies', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT c.*, p.name as plan_name 
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      ORDER BY c.created_at DESC
    `);
    connection.release();
    res.json({ success: true, companies: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar empresas' });
  }
});

app.get('/api/companies/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT c.*, p.name as plan_name 
      FROM companies c
      LEFT JOIN plans p ON c.plan_id = p.id
      WHERE c.id = ?
    `, [id]);
    connection.release();
    
    if (Array.isArray(rows) && rows.length === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }
    res.json({ success: true, company: rows[0] });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar empresa' });
  }
});

app.post('/api/companies', async (req, res) => {
  const { name, document, email, phone, plan_id, status, address, city, state, zip_code } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO companies (name, document, email, phone, plan_id, status, address, city, state, zip_code)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, document, email, phone, plan_id, status || 'active', address, city, state, zip_code]
    );
    connection.release();
    res.json({ success: true, message: 'Empresa criada com sucesso', companyId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar empresa' });
  }
});

app.put('/api/companies/:id', async (req, res) => {
  const { id } = req.params;
  const { name, document, email, phone, plan_id, status, address, city, state, zip_code } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `UPDATE companies SET name=?, document=?, email=?, phone=?, plan_id=?, status=?, address=?, city=?, state=?, zip_code=?
       WHERE id = ?`,
      [name, document, email, phone, plan_id, status, address, city, state, zip_code, id]
    );
    connection.release();
    
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }
    res.json({ success: true, message: 'Empresa atualizada com sucesso' });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao atualizar empresa' });
  }
});

app.delete('/api/companies/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query('DELETE FROM companies WHERE id = ?', [id]);
    connection.release();
    
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Empresa não encontrada' });
    }
    res.json({ success: true, message: 'Empresa deletada com sucesso' });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao deletar empresa' });
  }
});

// ============================================
// ENDPOINTS - PLANS
// ============================================

app.get('/api/plans', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM plans ORDER BY price ASC');
    connection.release();
    res.json({ success: true, plans: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar planos' });
  }
});

app.get('/api/plans/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query('SELECT * FROM plans WHERE id = ?', [id]);
    connection.release();
    
    if (Array.isArray(rows) && rows.length === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }
    res.json({ success: true, plan: rows[0] });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar plano' });
  }
});

app.post('/api/plans', async (req, res) => {
  const { name, description, price, duration_days, features, max_users, max_patients, status } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO plans (name, description, price, duration_days, features, max_users, max_patients, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, price, duration_days || 30, JSON.stringify(features || []), max_users || 0, max_patients || 0, status || 'active']
    );
    connection.release();
    res.json({ success: true, message: 'Plano criado com sucesso', planId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar plano' });
  }
});

app.put('/api/plans/:id', async (req, res) => {
  const { id } = req.params;
  const { name, description, price, duration_days, features, max_users, max_patients, status } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `UPDATE plans SET name=?, description=?, price=?, duration_days=?, features=?, max_users=?, max_patients=?, status=?
       WHERE id = ?`,
      [name, description, price, duration_days, JSON.stringify(features || []), max_users, max_patients, status, id]
    );
    connection.release();
    
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }
    res.json({ success: true, message: 'Plano atualizado com sucesso' });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao atualizar plano' });
  }
});

app.delete('/api/plans/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query('DELETE FROM plans WHERE id = ?', [id]);
    connection.release();
    
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Plano não encontrado' });
    }
    res.json({ success: true, message: 'Plano deletado com sucesso' });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao deletar plano' });
  }
});

// ============================================
// ENDPOINTS - SEIZURES
// ============================================

app.get('/api/seizures', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT s.*, p.name as patient_name 
      FROM seizures s
      LEFT JOIN patients p ON s.patient_id = p.id
      ORDER BY s.occurred_at DESC
    `);
    connection.release();
    res.json({ success: true, seizures: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar convulsões' });
  }
});

app.get('/api/seizures/patient/:patientId', async (req, res) => {
  const { patientId } = req.params;
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      'SELECT * FROM seizures WHERE patient_id = ? ORDER BY occurred_at DESC',
      [patientId]
    );
    connection.release();
    res.json({ success: true, seizures: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar convulsões' });
  }
});

app.post('/api/seizures', async (req, res) => {
  const { patient_id, occurred_at, duration_seconds, seizure_type, intensity, triggers, symptoms, medication_taken, notes, reported_by } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO seizures (patient_id, occurred_at, duration_seconds, seizure_type, intensity, triggers, symptoms, medication_taken, notes, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patient_id, occurred_at, duration_seconds, seizure_type, intensity, triggers, symptoms, medication_taken, notes, reported_by]
    );
    connection.release();
    res.json({ success: true, message: 'Convulsão registrada com sucesso', seizureId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao registrar convulsão' });
  }
});

// ============================================
// ENDPOINTS - MEDICATIONS
// ============================================

app.get('/api/medications', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT m.*, p.name as patient_name 
      FROM medications m
      LEFT JOIN patients p ON m.patient_id = p.id
      ORDER BY m.name ASC
    `);
    connection.release();
    res.json({ success: true, medications: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar medicamentos' });
  }
});

app.post('/api/medications', async (req, res) => {
  const { name, description, dosage, unit, manufacturer, stock_quantity, requires_prescription, patient_id, prescribed_date, end_date } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO medications (name, description, dosage, unit, manufacturer, stock_quantity, requires_prescription, patient_id, prescribed_date, end_date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, description, dosage, unit, manufacturer, stock_quantity, requires_prescription || false, patient_id, prescribed_date, end_date]
    );
    connection.release();
    res.json({ success: true, message: 'Medicamento criado com sucesso', medicationId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar medicamento' });
  }
});

// ============================================
// ENDPOINTS - ADMINISTRATIONS
// ============================================

app.get('/api/administrations', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT a.*, m.name as medication_name, p.name as patient_name
      FROM administrations a
      LEFT JOIN medications m ON a.medication_id = m.id
      LEFT JOIN patients p ON a.patient_id = p.id
      ORDER BY a.scheduled_time DESC
    `);
    connection.release();
    res.json({ success: true, administrations: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar administrações' });
  }
});

app.post('/api/administrations', async (req, res) => {
  const { medication_id, patient_id, scheduled_time, administered_time, status, administered_by, notes } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO administrations (medication_id, patient_id, scheduled_time, administered_time, status, administered_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [medication_id, patient_id, scheduled_time, administered_time, status || 'pending', administered_by, notes]
    );
    connection.release();
    res.json({ success: true, message: 'Administração registrada com sucesso', administrationId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar administração' });
  }
});

// ============================================
// ENDPOINTS - MONITORING LOGS
// ============================================

app.get('/api/monitoring-logs', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT m.*, p.name as patient_name
      FROM monitoring_logs m
      LEFT JOIN patients p ON m.patient_id = p.id
      ORDER BY m.timestamp DESC
    `);
    connection.release();
    res.json({ success: true, monitoring_logs: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar logs' });
  }
});

app.post('/api/monitoring-logs', async (req, res) => {
  const { patient_id, heart_rate, blood_pressure_systolic, blood_pressure_diastolic, oxygen_saturation, temperature, glucose_level, symptoms, notes, device_id } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO monitoring_logs (patient_id, heart_rate, blood_pressure_systolic, blood_pressure_diastolic, oxygen_saturation, temperature, glucose_level, symptoms, notes, device_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patient_id, heart_rate, blood_pressure_systolic, blood_pressure_diastolic, oxygen_saturation, temperature, glucose_level, symptoms, notes, device_id]
    );
    connection.release();
    res.json({ success: true, message: 'Log criado com sucesso', monitoringLogId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar log' });
  }
});

// ============================================
// ENDPOINTS - REPORTS
// ============================================

app.get('/api/reports', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT r.*, p.name as patient_name
      FROM reports r
      LEFT JOIN patients p ON r.patient_id = p.id
      ORDER BY r.created_at DESC
    `);
    connection.release();
    res.json({ success: true, reports: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar relatórios' });
  }
});

app.post('/api/reports', async (req, res) => {
  const { patient_id, report_type, start_date, end_date, data, generated_by, notes } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO reports (patient_id, report_type, start_date, end_date, data, generated_by, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [patient_id, report_type, start_date, end_date, JSON.stringify(data || {}), generated_by, notes]
    );
    connection.release();
    res.json({ success: true, message: 'Relatório criado com sucesso', reportId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar relatório' });
  }
});

// ============================================
// ENDPOINTS - APPOINTMENTS
// ============================================

app.get('/api/appointments', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT a.*, p.name as patient_name, u.display_name as doctor_name
      FROM appointments a
      LEFT JOIN patients p ON a.patient_id = p.id
      LEFT JOIN users u ON a.doctor_id = u.uid
      ORDER BY a.appointment_date DESC
    `);
    connection.release();
    res.json({ success: true, appointments: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao listar atendimentos' });
  }
});

app.get('/api/appointments/patient/:patientId', async (req, res) => {
  const { patientId } = req.params;
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(
      `SELECT a.*, u.display_name as doctor_name
       FROM appointments a
       LEFT JOIN users u ON a.doctor_id = u.uid
       WHERE a.patient_id = ?
       ORDER BY a.appointment_date DESC`,
      [patientId]
    );
    connection.release();
    res.json({ success: true, appointments: rows, count: Array.isArray(rows) ? rows.length : 0 });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao buscar atendimentos' });
  }
});

app.post('/api/appointments', async (req, res) => {
  const { patient_id, doctor_id, appointment_date, duration_minutes, type, status, notes, location, payment_status, value } = req.body;
  try {
    const connection = await pool.getConnection();
    
    // Verificar conflito
    const [conflict] = await connection.query(
      `SELECT id FROM appointments 
       WHERE doctor_id = ? AND appointment_date BETWEEN DATE_SUB(?, INTERVAL 30 MINUTE) AND DATE_ADD(?, INTERVAL 30 MINUTE)
       AND status NOT IN ('cancelled', 'completed')`,
      [doctor_id, appointment_date, appointment_date]
    );
    
    if (Array.isArray(conflict) && conflict.length > 0) {
      connection.release();
      return res.status(409).json({ error: 'Conflito de horário' });
    }
    
    const [result] = await connection.query(
      `INSERT INTO appointments (patient_id, doctor_id, appointment_date, duration_minutes, type, status, notes, location, payment_status, value)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [patient_id, doctor_id, appointment_date, duration_minutes || 30, type || 'consultation', status || 'scheduled', notes, location, payment_status || 'pending', value]
    );
    connection.release();
    res.json({ success: true, message: 'Atendimento agendado com sucesso', appointmentId: (result as any).insertId });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar atendimento' });
  }
});

app.patch('/api/appointments/:id/complete', async (req, res) => {
  const { id } = req.params;
  const { medical_report, prescription_notes } = req.body;
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `UPDATE appointments SET status='completed', medical_report=?, prescription_notes=?, completed_at=NOW()
       WHERE id=? AND status='scheduled'`,
      [medical_report, prescription_notes, id]
    );
    connection.release();
    
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ error: 'Atendimento não encontrado' });
    }
    res.json({ success: true, message: 'Atendimento concluído com sucesso' });
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao concluir atendimento' });
  }
});

// ============================================
// ROTA DE SAÚDE
// ============================================

app.get('/api/health', async (req, res) => {
  let mysqlStatus = 'disconnected';
  try {
    const connection = await pool.getConnection();
    await ensureTables();
    mysqlStatus = 'connected';
    connection.release();
  } catch (error) {
    mysqlStatus = 'error';
    console.error('Erro na saúde:', error);
  }
  
  res.json({ 
    status: 'OK',
    mysql: mysqlStatus,
    timestamp: new Date().toISOString()
  });
});

// ============================================
// ROTA RAIZ COM DOCUMENTAÇÃO
// ============================================

app.get('/', (req, res) => {
  res.json({
    message: 'API da Epicare está funcionando!',
    version: '2.0.0',
    endpoints: {
      auth: { 
        login: 'POST /api/login', 
        createUsers: 'POST /api/create-users (requer secret: MIGRACAO_SECRETA_2026)' 
      },
      users: { list: 'GET /api/users', delete: 'DELETE /api/users/:uid' },
      patients: { list: 'GET /api/patients', create: 'POST /api/patients', get: 'GET /api/patients/:id', update: 'PUT /api/patients/:id', delete: 'DELETE /api/patients/:id' },
      companies: { list: 'GET /api/companies', crud: 'CRUD completo' },
      plans: { list: 'GET /api/plans', crud: 'CRUD completo' },
      seizures: { list: 'GET /api/seizures', create: 'POST /api/seizures', getByPatient: 'GET /api/seizures/patient/:patientId' },
      medications: { list: 'GET /api/medications', create: 'POST /api/medications' },
      administrations: { list: 'GET /api/administrations', create: 'POST /api/administrations' },
      monitoringLogs: { list: 'GET /api/monitoring-logs', create: 'POST /api/monitoring-logs' },
      reports: { list: 'GET /api/reports', create: 'POST /api/reports' },
      appointments: { list: 'GET /api/appointments', create: 'POST /api/appointments', complete: 'PATCH /api/appointments/:id/complete' }
    },
    documentation: 'https://whats-epicare-api.y7nagi.easypanel.host/api/health'
  });
});

// ============================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================

const PORT = 3000;
app.listen(PORT, '0.0.0.0', async () => {
  console.log(`\n🚀 API rodando na porta ${PORT}`);
  
  // Verificar/criar tabelas ao iniciar
  try {
    await ensureTables();
    console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
    console.log(`\n📝 Endpoints disponíveis:`);
    console.log(`  🔐 Autenticação:`);
    console.log(`    POST /api/login - Login (retorna firebaseToken)`);
    console.log(`    POST /api/create-users - Criar usuários (requer secret)`);
    console.log(`  👥 Usuários:`);
    console.log(`    GET  /api/users - Listar usuários`);
    console.log(`    DELETE /api/users/:uid - Deletar usuário`);
    console.log(`  👤 Pacientes:`);
    console.log(`    GET    /api/patients - Listar pacientes`);
    console.log(`    GET    /api/patients/:id - Buscar paciente`);
    console.log(`    POST   /api/patients - Criar paciente`);
    console.log(`    PUT    /api/patients/:id - Atualizar paciente`);
    console.log(`    DELETE /api/patients/:id - Deletar paciente`);
    console.log(`  🏢 Empresas:`);
    console.log(`    GET    /api/companies - Listar empresas`);
    console.log(`    POST   /api/companies - Criar empresa`);
    console.log(`    PUT    /api/companies/:id - Atualizar empresa`);
    console.log(`    DELETE /api/companies/:id - Deletar empresa`);
    console.log(`  💳 Planos:`);
    console.log(`    GET    /api/plans - Listar planos`);
    console.log(`    POST   /api/plans - Criar plano`);
    console.log(`    PUT    /api/plans/:id - Atualizar plano`);
    console.log(`    DELETE /api/plans/:id - Deletar plano`);
    console.log(`  ⚠️ Convulsões:`);
    console.log(`    GET    /api/seizures - Listar convulsões`);
    console.log(`    GET    /api/seizures/patient/:patientId - Convulsões por paciente`);
    console.log(`    POST   /api/seizures - Registrar convulsão`);
    console.log(`  💊 Medicamentos:`);
    console.log(`    GET    /api/medications - Listar medicamentos`);
    console.log(`    POST   /api/medications - Criar medicamento`);
    console.log(`  💉 Administrações:`);
    console.log(`    GET    /api/administrations - Listar administrações`);
    console.log(`    POST   /api/administrations - Registrar administração`);
    console.log(`  📊 Monitoramento:`);
    console.log(`    GET    /api/monitoring-logs - Listar logs`);
    console.log(`    POST   /api/monitoring-logs - Criar log`);
    console.log(`  📄 Relatórios:`);
    console.log(`    GET    /api/reports - Listar relatórios`);
    console.log(`    POST   /api/reports - Criar relatório`);
    console.log(`  📅 Atendimentos:`);
    console.log(`    GET    /api/appointments - Listar atendimentos`);
    console.log(`    POST   /api/appointments - Agendar atendimento`);
    console.log(`    PATCH  /api/appointments/:id/complete - Concluir atendimento`);
    console.log(`\n🔑 Credenciais de teste:`);
    console.log(`  Admin: admin@epicare.com / admin123`);
    console.log(`  Super Admin: superadmin@epicare.com / superadmin123`);
    console.log(`  AVS: avsinfortec@gmail.com / @avs22562`);
  } catch (error) {
    console.error('❌ Erro ao inicializar tabelas:', error);
  }
});

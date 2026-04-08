import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// ============================================
// INICIALIZAÇÃO DO FIREBASE (COM TRATAMENTO DE ERRO)
// ============================================
if (!process.env.SERVICE_ACCOUNT_BASE64) {
  console.error('❌ SERVICE_ACCOUNT_BASE64 não encontrada no .env');
  process.exit(1);
}

try {
  const serviceAccount = JSON.parse(
    Buffer.from(process.env.SERVICE_ACCOUNT_BASE64, 'base64').toString('utf8')
  );
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin inicializado com sucesso');
} catch (error) {
  console.error('❌ Erro ao inicializar Firebase:', error);
  process.exit(1);
}

// ============================================
// CONFIGURAÇÃO DO POOL MYSQL (MELHORADA)
// ============================================
const pool = mysql.createPool({
  host: process.env.DB_HOST || 'whats_sqlepicore',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'avsinfortec',
  password: process.env.DB_PASSWORD || '@avs22562',
  database: process.env.DB_NAME || 'bdepicore',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

// ============================================
// FUNÇÃO PARA CRIAR/VERIFICAR TODAS AS TABELAS (CORRIGIDA)
// ============================================
async function ensureTables() {
  const connection = await pool.getConnection();
  try {
    console.log('🔧 Verificando/criando tabelas...');

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
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_email (email),
        INDEX idx_role (role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE SET NULL,
        INDEX idx_plan (plan_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
        INDEX idx_company (company_id),
        INDEX idx_status (status),
        INDEX idx_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
        INDEX idx_patient (patient_id),
        INDEX idx_name (name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        INDEX idx_patient (patient_id),
        INDEX idx_occurred (occurred_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        INDEX idx_patient (patient_id),
        INDEX idx_scheduled (scheduled_time),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        INDEX idx_patient (patient_id),
        INDEX idx_timestamp (timestamp)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
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
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE SET NULL,
        INDEX idx_patient (patient_id),
        INDEX idx_type (report_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Tabela reports verificada/criada');

    // 10. Tabela appointments (CORRIGIDA - AMBOS INT)
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
        FOREIGN KEY (doctor_id) REFERENCES users(uid) ON DELETE SET NULL,
        INDEX idx_patient (patient_id),
        INDEX idx_doctor (doctor_id),
        INDEX idx_date (appointment_date),
        INDEX idx_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Tabela appointments verificada/criada');

    // Inserir planos padrão
    const [existingPlans] = await connection.query('SELECT COUNT(*) as count FROM plans');
    if (existingPlans[0].count === 0) {
      await connection.query(`
        INSERT INTO plans (name, description, price, duration_days, features, max_users, max_patients, status) VALUES
        ('Plano Básico', 'Ideal para pequenas empresas', 99.90, 30, '["Até 10 usuários", "100 pacientes", "Suporte email"]', 10, 100, 'active'),
        ('Plano Profissional', 'Para empresas em crescimento', 199.90, 30, '["Até 50 usuários", "500 pacientes", "Suporte prioritário", "Relatórios avançados"]', 50, 500, 'active'),
        ('Plano Enterprise', 'Solução completa', 399.90, 30, '["Usuários ilimitados", "Pacientes ilimitados", "Suporte 24/7", "API personalizada"]', 999999, 999999, 'active')
      `);
      console.log('✅ Planos padrão inseridos');
    }

    // Inserir empresa padrão
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
        email: 'avsinfortec@gmail.com',
        role: 'super-admin',
        display_name: 'AVS Informática',
        cpf: null,
        phone: null,
        password_hash: '@avs22562'
      }
    ];
    
    let created = 0;
    const errorDetails: any[] = [];
    
    for (const user of users) {
      try {
        const [existing] = await connection.query(
          'SELECT uid FROM users WHERE email = ?',
          [user.email]
        );
        
        if (Array.isArray(existing) && existing.length > 0) {
          await connection.query(
            `UPDATE users SET role = ?, display_name = ?, password_hash = ?, uid = ? WHERE email = ?`,
            [user.role, user.display_name, user.password_hash, user.uid, user.email]
          );
          console.log(`✅ Usuário ${user.email} atualizado com UID: ${user.uid}`);
          created++;
        } else {
          await connection.query(
            `INSERT INTO users (uid, company_id, email, role, display_name, cpf, phone, password_hash)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.uid, user.company_id, user.email, user.role, user.display_name, user.cpf, user.phone, user.password_hash]
          );
          console.log(`✅ Usuário ${user.email} criado com UID: ${user.uid}`);
          created++;
        }
        
        try {
          await admin.auth().getUserByEmail(user.email);
          console.log(`✅ Usuário ${user.email} já existe no Firebase`);
        } catch (firebaseError) {
          await admin.auth().createUser({
            uid: user.uid,
            email: user.email,
            password: user.password_hash,
            displayName: user.display_name
          });
          console.log(`✅ Usuário ${user.email} criado no Firebase`);
        }
        
      } catch (error: any) {
        errorDetails.push({ email: user.email, error: error.message });
        console.error(`❌ Erro ao processar ${user.email}:`, error.message);
      }
    }
    
    connection.release();
    
    res.json({
      success: true,
      message: 'Usuários processados com UIDs Firebase',
      created,
      errors: errorDetails.length,
      errorDetails,
      users: users.map(u => ({ email: u.email, role: u.role, uid: u.uid }))
    });
    
  } catch (error) {
    console.error('Erro:', error);
    res.status(500).json({ error: 'Erro ao criar usuários', details: String(error) });
  }
});

// ============================================
// ROTA DE LOGIN
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
       FROM users WHERE email = ? AND password_hash = ?`,
      [email, password]
    );
    
    connection.release();
    
    if (Array.isArray(rows) && rows.length === 0) {
      return res.status(401).json({ error: 'Email ou senha incorretos' });
    }
    
    const user = rows[0];
    const customToken = await admin.auth().createCustomToken(user.uid);
    
    res.json({
      success: true,
      message: 'Login realizado com sucesso',
      user,
      firebaseToken: customToken
    });
    
  } catch (error) {
    console.error('Erro no login:', error);
    res.status(500).json({ error: 'Erro ao fazer login' });
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
      ORDER BY p.name ASC
    `);
    connection.release();
    
    res.json(Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error('Erro ao listar pacientes:', error);
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
    
    const [seizures] = await connection.query(
      'SELECT * FROM seizures WHERE patient_id = ? ORDER BY occurred_at DESC', 
      [id]
    );
    const [medications] = await connection.query(
      'SELECT * FROM medications WHERE patient_id = ? ORDER BY prescribed_date DESC', 
      [id]
    );
    
    connection.release();
    
    res.json({
      patient: patientRows[0],
      seizures: seizures || [],
      medications: medications || []
    });
  } catch (error) {
    console.error('Erro ao buscar paciente:', error);
    res.status(500).json({ error: 'Erro ao buscar paciente' });
  }
});

app.post('/api/patients', async (req, res) => {
  const { name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, company_id } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO patients (name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, company_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [name, phone, email, cpf, birth_date, blood_type, allergies, emergency_contact, emergency_phone, notes, company_id]
    );
    connection.release();
    
    res.status(201).json({
      success: true,
      message: 'Paciente criado com sucesso',
      patientId: (result as any).insertId
    });
  } catch (error) {
    console.error('Erro ao criar paciente:', error);
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
    console.error('Erro ao atualizar paciente:', error);
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
    console.error('Erro ao deletar paciente:', error);
    res.status(500).json({ error: 'Erro ao deletar paciente' });
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
    res.json(Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error('Erro ao listar medicamentos:', error);
    res.status(500).json({ error: 'Erro ao listar medicamentos' });
  }
});

app.post('/api/medications', async (req, res) => {
  const { name, description, dosage, unit, manufacturer, patient_id, prescribed_date } = req.body;
  
  if (!name) {
    return res.status(400).json({ error: 'Nome é obrigatório' });
  }
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO medications (name, description, dosage, unit, manufacturer, patient_id, prescribed_date)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [name, description, dosage, unit, manufacturer, patient_id, prescribed_date]
    );
    connection.release();
    
    res.status(201).json({
      success: true,
      message: 'Medicamento criado com sucesso',
      medicationId: (result as any).insertId
    });
  } catch (error) {
    console.error('Erro ao criar medicamento:', error);
    res.status(500).json({ error: 'Erro ao criar medicamento' });
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
    res.json(Array.isArray(rows) ? rows : []);
  } catch (error) {
    console.error('Erro ao listar convulsões:', error);
    res.status(500).json({ error: 'Erro ao listar convulsões' });
  }
});

app.post('/api/seizures', async (req, res) => {
  const { patient_id, occurred_at, duration_seconds, seizure_type, intensity, triggers, symptoms, notes } = req.body;
  
  if (!patient_id || !occurred_at) {
    return res.status(400).json({ error: 'Paciente e data são obrigatórios' });
  }
  
  try {
    const connection = await pool.getConnection();
    const [result] = await connection.query(
      `INSERT INTO seizures (patient_id, occurred_at, duration_seconds, seizure_type, intensity, triggers, symptoms, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [patient_id, occurred_at, duration_seconds, seizure_type, intensity, triggers, symptoms, notes]
    );
    connection.release();
    
    res.status(201).json({
      success: true,
      message: 'Convulsão registrada com sucesso',
      seizureId: (result as any).insertId
    });
  } catch (error) {
    console.error('Erro ao registrar convulsão:', error);
    res.status(500).json({ error: 'Erro ao registrar convulsão' });
  }
});

// ============================================
// ROTA DE SAÚDE
// ============================================
app.get('/api/health', async (req, res) => {
  let mysqlStatus = 'disconnected';
  try {
    const connection = await pool.getConnection();
    await connection.query('SELECT 1');
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

// ============================================
// ROTA RAIZ
// ============================================
app.get('/', (req, res) => {
  res.json({
    message: 'API da Epicare está funcionando!',
    version: '2.0.0',
    endpoints: {
      auth: { login: 'POST /api/login', createUsers: 'POST /api/create-users' },
      patients: { list: 'GET /api/patients', create: 'POST /api/patients', get: 'GET /api/patients/:id', update: 'PUT /api/patients/:id', delete: 'DELETE /api/patients/:id' },
      medications: { list: 'GET /api/medications', create: 'POST /api/medications' },
      seizures: { list: 'GET /api/seizures', create: 'POST /api/seizures' }
    }
  });
});

// ============================================
// INICIALIZAÇÃO DO SERVIDOR
// ============================================
const PORT = parseInt(process.env.PORT || '3000');

async function startServer() {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Conexão com MySQL estabelecida');
    connection.release();
    
    await ensureTables();
    
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`\n🚀 API rodando na porta ${PORT}`);
      console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
      console.log(`\n🔑 Credenciais de teste:`);
      console.log(`  Admin: admin@epicare.com / admin123`);
      console.log(`  AVS: avsinfortec@gmail.com / @avs22562`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();

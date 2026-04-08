import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import dotenv from 'dotenv';
import admin from 'firebase-admin';
import { v4 as uuidv4 } from 'uuid';
import axios from 'axios'; // Adicionar esta dependência

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
// CONFIGURAÇÃO DA EVOLUTION API
// ============================================
class EvolutionAPI {
  constructor() {
    this.baseURL = process.env.EVOLUTION_API_URL || 'http://localhost:8080';
    this.apiKey = process.env.EVOLUTION_API_KEY || 'SUA_CHAVE_AQUI';
    this.instanceName = process.env.EVOLUTION_INSTANCE || 'medicamentos';
  }

  async sendMessage(to, message) {
    try {
      // Remove caracteres não numéricos e adiciona @c.us
      let cleaned = to.toString().replace(/\D/g, '');
      if (!cleaned.startsWith('55')) cleaned = '55' + cleaned;
      const number = cleaned + '@c.us';

      const response = await axios.post(
        `${this.baseURL}/instance/sendText/${this.instanceName}`,
        {
          number: number,
          text: message,
          options: {
            delay: 1200,
            presence: "composing"
          }
        },
        {
          headers: {
            'apikey': this.apiKey,
            'Content-Type': 'application/json'
          }
        }
      );
      
      console.log(`✅ WhatsApp enviado para ${to}`);
      return response.data;
    } catch (error) {
      console.error(`❌ Erro ao enviar WhatsApp: ${error.message}`);
      return null;
    }
  }

  async formatMedicationAlert(medication, patient) {
    let message = `🔔 *LEMBRETE DE MEDICAÇÃO* 🔔\n\n`;
    message += `👤 *Paciente:* ${patient.name}\n`;
    message += `💊 *Medicamento:* ${medication.name}\n`;
    message += `📋 *Descrição:* ${medication.description || 'Não informada'}\n`;
    message += `💉 *Dosagem:* ${medication.dosage || 'Conforme prescrição'}\n`;
    
    if (medication.unit) {
      message += `📦 *Unidade:* ${medication.unit}\n`;
    }
    
    if (medication.manufacturer) {
      message += `🏭 *Fabricante:* ${medication.manufacturer}\n`;
    }
    
    message += `\n⏰ *Horário programado:* ${new Date().toLocaleTimeString('pt-BR')}\n`;
    message += `\n✅ Para confirmar que tomou, responda: *CONFIRMAR ${medication.id}*`;
    message += `\n⏸️ Para adiar 30min, responda: *ADIAR ${medication.id}*`;
    message += `\n❌ Para cancelar este alerta, responda: *CANCELAR ${medication.id}*`;
    
    return message;
  }
}

const evolutionAPI = new EvolutionAPI();

// ============================================
// SISTEMA DE MONITORAMENTO DE ALARMES
// ============================================
class MedicationAlertMonitor {
  constructor() {
    this.checkInterval = null;
    this.isRunning = false;
    this.activeAlerts = new Map(); // Para evitar alertas duplicados
  }

  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    // Verifica a cada minuto
    this.checkInterval = setInterval(() => this.checkScheduledMedications(), 60000);
    console.log('🟢 Monitor de medicações iniciado (verifica a cada 1 minuto)');
    
    // Primeira verificação imediata
    this.checkScheduledMedications();
  }

  stop() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.isRunning = false;
      console.log('🔴 Monitor de medicações parado');
    }
  }

  async checkScheduledMedications() {
    try {
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      const currentTime = `${currentHour.toString().padStart(2, '0')}:${currentMinute.toString().padStart(2, '0')}`;
      
      // Busca administrações agendadas para este horário
      const connection = await pool.getConnection();
      
      const [schedules] = await connection.query(`
        SELECT 
          a.*,
          m.name as medication_name,
          m.description as medication_description,
          m.dosage as medication_dosage,
          m.unit as medication_unit,
          m.manufacturer as medication_manufacturer,
          p.name as patient_name,
          p.phone as patient_phone,
          p.id as patient_id
        FROM administrations a
        JOIN medications m ON a.medication_id = m.id
        JOIN patients p ON a.patient_id = p.id
        WHERE a.status = 'pending'
          AND TIME(a.scheduled_time) = ?
          AND DATE(a.scheduled_time) = CURDATE()
          AND a.alert_sent = 0
      `, [currentTime]);
      
      connection.release();
      
      if (Array.isArray(schedules) && schedules.length > 0) {
        console.log(`🔔 Encontrados ${schedules.length} alertas para ${currentTime}`);
        
        for (const schedule of schedules) {
          await this.sendAlert(schedule);
        }
      }
      
    } catch (error) {
      console.error('❌ Erro ao verificar medicações:', error);
    }
  }

  async sendAlert(schedule) {
    const alertKey = `${schedule.id}_${new Date().toISOString().slice(0, 16)}`;
    
    // Evita enviar o mesmo alerta múltiplas vezes
    if (this.activeAlerts.has(alertKey)) {
      return;
    }
    
    this.activeAlerts.set(alertKey, true);
    setTimeout(() => this.activeAlerts.delete(alertKey), 60000);
    
    try {
      // Prepara os dados do medicamento e paciente
      const medication = {
        id: schedule.medication_id,
        name: schedule.medication_name,
        description: schedule.medication_description,
        dosage: schedule.medication_dosage,
        unit: schedule.medication_unit,
        manufacturer: schedule.medication_manufacturer
      };
      
      const patient = {
        id: schedule.patient_id,
        name: schedule.patient_name,
        phone: schedule.patient_phone
      };
      
      // Formata e envia a mensagem
      const message = await evolutionAPI.formatMedicationAlert(medication, patient);
      const sent = await evolutionAPI.sendMessage(patient.phone, message);
      
      // Atualiza o status no banco
      const connection = await pool.getConnection();
      await connection.query(
        `UPDATE administrations 
         SET alert_sent = 1, 
             alert_sent_at = NOW(),
             alert_status = ?,
             alert_response = ?
         WHERE id = ?`,
        [sent ? 'sent' : 'failed', sent ? JSON.stringify(sent) : null, schedule.id]
      );
      connection.release();
      
      // Registra log de envio
      await this.logAlert(schedule.id, patient.id, medication.id, 'sent', null);
      
      console.log(`✅ Alerta enviado para ${patient.name} (${patient.phone}) - ${medication.name}`);
      
    } catch (error) {
      console.error(`❌ Falha ao enviar alerta para ${schedule.patient_name}:`, error);
      await this.logAlert(schedule.id, schedule.patient_id, schedule.medication_id, 'failed', error.message);
    }
  }

  async logAlert(administrationId, patientId, medicationId, status, error) {
    try {
      const connection = await pool.getConnection();
      await connection.query(
        `INSERT INTO alert_logs (administration_id, patient_id, medication_id, status, error_message, created_at)
         VALUES (?, ?, ?, ?, ?, NOW())`,
        [administrationId, patientId, medicationId, status, error]
      );
      connection.release();
    } catch (error) {
      console.error('Erro ao registrar log:', error);
    }
  }
}

// Inicializa o monitor
const medicationMonitor = new MedicationAlertMonitor();
medicationMonitor.start();

// ============================================
// FUNÇÃO PARA CRIAR/VERIFICAR TABELAS (ADICIONAR NOVA TABELA)
// ============================================
async function ensureTables() {
  const connection = await pool.getConnection();
  try {
    console.log('🔧 Verificando/criando tabelas...');

    // ... (suas tabelas existentes) ...
    
    // ⭐ ADICIONAR ESTA NOVA TABELA PARA LOGS DE ALERTA
    await connection.query(`
      CREATE TABLE IF NOT EXISTS alert_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        administration_id INT NOT NULL,
        patient_id INT NOT NULL,
        medication_id INT NOT NULL,
        status VARCHAR(50) DEFAULT 'pending',
        error_message TEXT,
        sent_at TIMESTAMP NULL,
        confirmed_at TIMESTAMP NULL,
        confirmed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (administration_id) REFERENCES administrations(id) ON DELETE CASCADE,
        FOREIGN KEY (patient_id) REFERENCES patients(id) ON DELETE CASCADE,
        FOREIGN KEY (medication_id) REFERENCES medications(id) ON DELETE CASCADE,
        INDEX idx_status (status),
        INDEX idx_created (created_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ Tabela alert_logs verificada/criada');

    // ⭐ ADICIONAR CAMPOS NA TABELA administrations (se não existirem)
    try {
      await connection.query(`
        ALTER TABLE administrations 
        ADD COLUMN IF NOT EXISTS alert_sent BOOLEAN DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS alert_sent_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS alert_status VARCHAR(50) DEFAULT 'pending',
        ADD COLUMN IF NOT EXISTS alert_response JSON,
        ADD COLUMN IF NOT EXISTS confirmed_at TIMESTAMP NULL,
        ADD COLUMN IF NOT EXISTS confirmed_by VARCHAR(255)
      `);
      console.log('✅ Campos de alerta adicionados à tabela administrations');
    } catch (alterError) {
      console.log('⚠️ Campos já existem ou erro ao adicionar:', alterError.message);
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
// ⭐ NOVOS ENDPOINTS PARA ALERTAS DE MEDICAÇÃO
// ============================================

// Endpoint para agendar uma administração com alerta
app.post('/api/schedule-medication', async (req, res) => {
  const { 
    medication_id, 
    patient_id, 
    scheduled_time, 
    notes 
  } = req.body;

  if (!medication_id || !patient_id || !scheduled_time) {
    return res.status(400).json({ 
      error: 'medication_id, patient_id e scheduled_time são obrigatórios' 
    });
  }

  try {
    const connection = await pool.getConnection();
    
    // Verifica se paciente tem telefone
    const [patient] = await connection.query(
      'SELECT phone, name FROM patients WHERE id = ?',
      [patient_id]
    );
    
    if (!patient[0]?.phone) {
      connection.release();
      return res.status(400).json({ 
        error: 'Paciente não possui telefone cadastrado para receber alertas' 
      });
    }

    const [result] = await connection.query(
      `INSERT INTO administrations 
       (medication_id, patient_id, scheduled_time, status, notes)
       VALUES (?, ?, ?, 'pending', ?)`,
      [medication_id, patient_id, scheduled_time, notes]
    );

    connection.release();

    res.status(201).json({
      success: true,
      message: 'Medicação agendada com sucesso',
      administrationId: (result as any).insertId,
      alerta: `WhatsApp será enviado para ${patient[0].phone} no horário agendado`
    });

  } catch (error) {
    console.error('Erro ao agendar medicação:', error);
    res.status(500).json({ error: 'Erro ao agendar medicação' });
  }
});

// Endpoint para listar administrações pendentes
app.get('/api/pending-administrations', async (req, res) => {
  try {
    const connection = await pool.getConnection();
    const [rows] = await connection.query(`
      SELECT 
        a.*,
        m.name as medication_name,
        p.name as patient_name,
        p.phone as patient_phone
      FROM administrations a
      JOIN medications m ON a.medication_id = m.id
      JOIN patients p ON a.patient_id = p.id
      WHERE a.status = 'pending'
        AND a.scheduled_time >= NOW()
      ORDER BY a.scheduled_time ASC
    `);
    connection.release();
    
    res.json(rows || []);
  } catch (error) {
    console.error('Erro ao listar administrações:', error);
    res.status(500).json({ error: 'Erro ao listar administrações' });
  }
});

// Webhook para receber respostas do WhatsApp (Evolution API)
app.post('/api/whatsapp-webhook', async (req, res) => {
  const { message, from } = req.body;
  
  if (!message || !message.text) {
    return res.sendStatus(200);
  }

  const text = message.text.body;
  const phone = from.replace('@c.us', '');
  
  console.log(`📱 Mensagem recebida de ${phone}: ${text}`);

  // Processa comandos
  const confirmMatch = text.match(/CONFIRMAR (\d+)/i);
  const adiarMatch = text.match(/ADIAR (\d+)/i);
  const cancelarMatch = text.match(/CANCELAR (\d+)/i);

  try {
    const connection = await pool.getConnection();

    if (confirmMatch) {
      const administrationId = confirmMatch[1];
      
      await connection.query(
        `UPDATE administrations 
         SET status = 'completed', 
             administered_time = NOW(),
             confirmed_at = NOW(),
             confirmed_by = ?
         WHERE id = ?`,
        [phone, administrationId]
      );
      
      await evolutionAPI.sendMessage(phone, 
        '✅ *Medicação confirmada!*\n\nObrigado por confirmar. Continue cuidando da sua saúde! 💪'
      );
      
    } else if (adiarMatch) {
      const administrationId = adiarMatch[1];
      
      await connection.query(
        `UPDATE administrations 
         SET scheduled_time = DATE_ADD(scheduled_time, INTERVAL 30 MINUTE),
             alert_sent = 0
         WHERE id = ?`,
        [administrationId]
      );
      
      await evolutionAPI.sendMessage(phone,
        '⏰ *Medicação adiada por 30 minutos*\n\nVocê receberá um novo lembrete no novo horário.'
      );
      
    } else if (cancelarMatch) {
      const administrationId = cancelarMatch[1];
      
      await connection.query(
        `UPDATE administrations 
         SET status = 'cancelled',
             notes = CONCAT(IFNULL(notes, ''), ' [Cancelado por WhatsApp em ', NOW(), ']')
         WHERE id = ?`,
        [administrationId]
      );
      
      await evolutionAPI.sendMessage(phone,
        '❌ *Alerta cancelado*\n\nEste lembrete foi cancelado. Para novos agendamentos, entre em contato com a clínica.'
      );
    }
    
    connection.release();
    
  } catch (error) {
    console.error('Erro ao processar webhook:', error);
  }
  
  res.sendStatus(200);
});

// Endpoint para testar envio de WhatsApp
app.post('/api/test-whatsapp', async (req, res) => {
  const { phone, message } = req.body;
  
  if (!phone || !message) {
    return res.status(400).json({ error: 'phone e message são obrigatórios' });
  }
  
  const result = await evolutionAPI.sendMessage(phone, message);
  
  if (result) {
    res.json({ success: true, message: 'Mensagem enviada com sucesso' });
  } else {
    res.status(500).json({ error: 'Falha ao enviar mensagem' });
  }
});

// Endpoint para verificar status da Evolution API
app.get('/api/evolution-status', async (req, res) => {
  try {
    const response = await axios.get(
      `${process.env.EVOLUTION_API_URL}/instance/connectionState/${process.env.EVOLUTION_INSTANCE}`,
      {
        headers: { 'apikey': process.env.EVOLUTION_API_KEY }
      }
    );
    res.json({ connected: true, status: response.data });
  } catch (error) {
    res.json({ connected: false, error: error.message });
  }
});

// ... (restante do seu código existente: login, patients, medications, seizures, etc.)

// ============================================
// INICIALIZAÇÃO DO SERVIDOR (MODIFICADA)
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
      console.log(`📱 Evolution API Status: http://localhost:${PORT}/api/evolution-status`);
      console.log(`\n🔑 Credenciais de teste:`);
      console.log(`  Admin: admin@epicare.com / admin123`);
      console.log(`  AVS: avsinfortec@gmail.com / @avs22562`);
      console.log(`\n🟢 Monitor de medicamentos ATIVO - Verificando a cada minuto`);
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar servidor:', error);
    process.exit(1);
  }
}

startServer();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Recebido SIGTERM, encerrando...');
  medicationMonitor.stop();
  process.exit(0);
});

import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import sql, { isDatabaseConnected, reconnectDatabase, dbEvents } from './db.js';

const app = express();
app.use(cors());
app.use((req, res, next) => {
  res.setHeader('Content-Security-Policy', 'frame-ancestors https://admin.shopify.com https://*.myshopify.com');
  next();
});

app.use(express.json());

// __dirname para ESModules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Servir arquivos estáticos da pasta "dist"
app.use(express.static(path.join(__dirname, 'dist')));

// ==========================
// Rotas da API
// ==========================

// Health check endpoint to verify database connection
app.get('/api/health', async (req, res) => {
  try {
    // Check current connection status
    const dbConnected = isDatabaseConnected();
    
    if (!dbConnected) {
      // If database is disconnected, try to reconnect if requested
      if (req.query.reconnect === 'true') {
        try {
          await reconnectDatabase();
          if (isDatabaseConnected()) {
            return res.json({ 
              status: 'recovered',
              database: 'reconnected',
              timestamp: new Date().toISOString()
            });
          }
        } catch (reconnectError) {
          console.error('Health check - Failed to reconnect:', reconnectError);
        }
      }
      
      // Return unhealthy status if still disconnected
      return res.status(503).json({ 
        status: 'unhealthy',
        database: 'disconnected',
        message: 'Database connection is down',
        canReconnect: true,
        timestamp: new Date().toISOString()
      });
    }
    
    // Test database connection with a simple query
    await sql`SELECT 1 as health_check`;
    res.json({ 
      status: 'healthy',
      database: 'connected',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Health check failed - Database connection error:', error);
    res.status(503).json({ 
      status: 'unhealthy',
      database: 'error',
      error: error.message,
      canReconnect: true,
      timestamp: new Date().toISOString()
    });
  }
});

app.get('/api/settings', async (req, res) => {
  try {
    const [config] = await sql`SELECT * FROM settings LIMIT 1`;
    res.json(config || { max_devices: 2, block_message: 'Você está logado em muitos dispositivos.' });
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: 'Erro ao buscar configurações' });
  }
});

app.post('/api/settings', async (req, res) => {
  try {
    const { max_devices, block_message } = req.body;
    
    if (max_devices === undefined || !block_message) {
      return res.status(400).json({ error: 'max_devices e block_message são obrigatórios' });
    }
    
    await sql`
      INSERT INTO settings (id, max_devices, block_message)
      VALUES (TRUE, ${max_devices}, ${block_message})
      ON CONFLICT (id)
      DO UPDATE SET max_devices = EXCLUDED.max_devices,
                    block_message = EXCLUDED.block_message
    `;
    res.json({ ok: true });
  } catch (error) {
    console.error('Error updating settings:', error);
    res.status(500).json({ error: 'Erro ao atualizar configurações' });
  }
});

app.post('/api/device-check', async (req, res) => {
  try {
    const { customer_id, device_id } = req.body;
    if (!customer_id || !device_id) {
      return res.status(400).json({ error: 'Faltando customer_id ou device_id' });
    }

    let config, dispositivos;
    
    try {
      [config] = await sql`SELECT * FROM settings LIMIT 1`;
    } catch (dbError) {
      console.error('Error fetching settings:', dbError);
      // Fall back to defaults if settings can't be fetched
      config = null;
    }
    
    const maxDevices = config?.max_devices || 2;
    const blockMessage = config?.block_message || 'Limite de dispositivos atingido.';

    try {
      dispositivos = await sql`
        SELECT * FROM devices WHERE customer_id = ${customer_id}
      `;
    } catch (dbError) {
      console.error('Error fetching devices:', dbError);
      return res.status(500).json({ error: 'Erro ao verificar dispositivos' });
    }

    const jaRegistrado = dispositivos.find(d => d.device_id === device_id);

    if (jaRegistrado) {
      try {
        await sql`
          UPDATE devices SET last_seen = NOW() WHERE customer_id = ${customer_id} AND device_id = ${device_id}
        `;
        return res.json({ status: 'ok', message: 'Dispositivo já registrado' });
      } catch (dbError) {
        console.error('Error updating device last_seen:', dbError);
        // Still return success as the device is already registered
        return res.json({ status: 'ok', message: 'Dispositivo já registrado' });
      }
    }

    if (dispositivos.length >= maxDevices) {
      return res.status(403).json({ error: blockMessage });
    }

    try {
      await sql`
        INSERT INTO devices (customer_id, device_id, last_seen)
        VALUES (${customer_id}, ${device_id}, NOW())
      `;
      res.json({ status: 'ok', message: 'Dispositivo registrado' });
    } catch (dbError) {
      console.error('Error registering device:', dbError);
      res.status(500).json({ error: 'Erro ao registrar dispositivo' });
    }
  } catch (error) {
    console.error('Unexpected error in device-check:', error);
    res.status(500).json({ error: 'Erro interno do servidor' });
  }
});

// ==========================
// Fallback SPA para index.html
// ==========================
app.get(/^\/(?!api).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// ==========================
// Start do servidor
// ==========================
const port = process.env.PORT || 3000;

// Add proper error handling for server startup
const server = app.listen(port, () => console.log(`Backend rodando na porta ${port}`));

// Handle server errors
server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Porta ${port} já está em uso. Por favor, escolha outra porta.`);
  } else {
    console.error('Erro ao iniciar o servidor:', error);
  }
  process.exit(1);
});

// Set up database event listeners
dbEvents.on('connected', () => {
  console.log('Database connection event: Connected');
});

dbEvents.on('disconnected', (error) => {
  console.error('Database connection event: Disconnected', error?.message || '');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  // Don't exit the process, just log the error
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  // Exit the process with error
  process.exit(1);
});

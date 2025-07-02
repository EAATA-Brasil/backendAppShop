import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import sql from './db.js';

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

app.get('/api/settings', async (req, res) => {
  const [config] = await sql`SELECT * FROM settings LIMIT 1`;
  res.json(config || { max_devices: 2, block_message: 'Você está logado em muitos dispositivos.' });
});

app.post('/api/settings', async (req, res) => {
  const { max_devices, block_message } = req.body;
  await sql`
    INSERT INTO settings (id, max_devices, block_message)
    VALUES (TRUE, ${max_devices}, ${block_message})
    ON CONFLICT (id)
    DO UPDATE SET max_devices = EXCLUDED.max_devices,
                  block_message = EXCLUDED.block_message
  `;
  res.json({ ok: true });
});

app.post('/api/device-check', async (req, res) => {
  const { customer_id, device_id } = req.body;
  if (!customer_id || !device_id) {
    return res.status(400).json({ error: 'Faltando customer_id ou device_id' });
  }

  const [config] = await sql`SELECT * FROM settings LIMIT 1`;
  const maxDevices = config?.max_devices || 2;
  const blockMessage = config?.block_message || 'Limite de dispositivos atingido.';

  const dispositivos = await sql`
    SELECT * FROM devices WHERE customer_id = ${customer_id}
  `;

  const jaRegistrado = dispositivos.find(d => d.device_id === device_id);

  if (jaRegistrado) {
    await sql`
      UPDATE devices SET last_seen = NOW() WHERE customer_id = ${customer_id} AND device_id = ${device_id}
    `;
    return res.json({ status: 'ok', message: 'Dispositivo já registrado' });
  }

  if (dispositivos.length >= maxDevices) {
    return res.status(403).json({ error: blockMessage });
  }

  await sql`
    INSERT INTO devices (customer_id, device_id, last_seen)
    VALUES (${customer_id}, ${device_id}, NOW())
  `;

  res.json({ status: 'ok', message: 'Dispositivo registrado' });
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
app.listen(port, () => console.log(`Backend rodando na porta ${port}`));

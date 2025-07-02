import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
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

// CSS optimization functions
const cssCache = {};

// Function to extract critical CSS (first X bytes)
function extractCriticalCSS() {
  const cssPath = path.join(__dirname, 'dist', 'assets', 'index-Cst8-6Q9.css');
  if (cssCache.critical) return cssCache.critical;
  
  try {
    // Read first 15KB as critical CSS
    const critical = fs.readFileSync(cssPath, { encoding: 'utf8', flag: 'r' }).substring(0, 15000);
    cssCache.critical = critical;
    return critical;
  } catch (err) {
    console.error('Error reading critical CSS:', err);
    return '';
  }
}

// Function to extract CSS by selectors (for dynamic CSS splitting)
function extractCSSBySelectors(selectors) {
  if (!selectors || !selectors.length) return '';
  
  const cssPath = path.join(__dirname, 'dist', 'assets', 'index-Cst8-6Q9.css');
  const cacheKey = selectors.sort().join(',');
  
  if (cssCache[cacheKey]) return cssCache[cacheKey];
  
  try {
    const fullCss = fs.readFileSync(cssPath, { encoding: 'utf8', flag: 'r' });
    let result = '';
    
    // Very basic CSS extraction - in production, use a proper CSS parser
    selectors.forEach(selector => {
      const regex = new RegExp(`${selector}[^{]*{[^}]*}`, 'g');
      const matches = fullCss.match(regex) || [];
      result += matches.join('\n');
    });
    
    cssCache[cacheKey] = result;
    return result;
  } catch (err) {
    console.error('Error extracting CSS by selectors:', err);
    return '';
  }
}

// Cache middleware for static assets
const staticCacheMiddleware = (req, res, next) => {
  // Don't cache HTML files
  if (req.path.endsWith('.html')) return next();
  
  // Set cache headers for all other static assets
  res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
  next();
};

// Servir arquivos estáticos da pasta "dist" with caching
app.use(staticCacheMiddleware);
app.use(express.static(path.join(__dirname, 'dist')));
app.use(express.static(path.join(__dirname, 'public')));

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
// Split CSS routes - serves CSS in chunks
// ==========================
app.get('/css/non-critical.css', (req, res) => {
  const cssPath = path.join(__dirname, 'dist', 'assets', 'index-Cst8-6Q9.css');
  try {
    const fullCss = fs.readFileSync(cssPath, { encoding: 'utf8', flag: 'r' });
    // Add cache headers for better performance
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    // Return everything after the critical CSS
    res.type('text/css').send(fullCss.substring(15000));
  } catch (err) {
    console.error('Error serving non-critical CSS:', err);
    res.status(500).send('Error loading CSS');
  }
});

// Dynamic CSS bundle endpoint - allows frontend to request specific CSS selectors
app.get('/css/dynamic-bundle', (req, res) => {
  try {
    const selectors = req.query.selectors ? req.query.selectors.split(',') : [];
    
    if (selectors.length === 0) {
      return res.status(400).send('No selectors provided');
    }
    
    // Extract CSS for requested selectors
    const css = extractCSSBySelectors(selectors);
    
    // Set cache headers
    res.setHeader('Cache-Control', 'public, max-age=31536000');
    res.type('text/css').send(css);
  } catch (err) {
    console.error('Error serving dynamic CSS bundle:', err);
    res.status(500).send('Error creating CSS bundle');
  }
});

// ==========================
// Fallback SPA para index.html with optimized CSS loading
// ==========================
app.get(/^\/(?!api).*/, (req, res) => {
  try {
    // Read the optimized HTML template
    const htmlPath = path.join(__dirname, 'public', 'index.html');
    let html = fs.readFileSync(htmlPath, 'utf8');
    
    // Extract and inline critical CSS
    const criticalCSS = extractCriticalCSS();
    html = html.replace('/* Critical CSS will be inlined here at runtime */', criticalCSS);
    
    res.send(html);
  } catch (err) {
    console.error('Error serving optimized HTML:', err);
    // Fallback to original HTML if something goes wrong
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  }
});

// ==========================
// Start do servidor
// ==========================
const port = process.env.PORT || 3000;
app.listen(port, () => console.log(`Backend rodando na porta ${port}`));

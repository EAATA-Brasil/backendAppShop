// =============================================================================
// ||               SERVIDOR BACKEND - LIMITADOR DE DISPOSITIVOS              ||
// =============================================================================

// --- Importações dos Módulos ---
const express = require("express"); // Framework para criar o servidor
const cors = require("cors"); // Middleware para permitir requisições de outros domínios
require("dotenv").config(); // Carrega variáveis de ambiente do arquivo .env
const { Pool } = require("pg"); // Driver do PostgreSQL para conectar ao Supabase
const nodemailer = require("nodemailer")
// --- Configuração do Banco de Dados ---
// Cria um "pool" de conexões com o banco de dados.
// O pool é mais eficiente do que criar uma conexão para cada requisição.
// A string de conexão é pega da variável de ambiente DATABASE_URL.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // A configuração SSL é frequentemente necessária para conexões com bancos de dados
  // na nuvem como o Supabase ou Heroku, para evitar erros de conexão.
  ssl: {
    rejectUnauthorized: false,
  },
});


const transporter = nodemailer.createTransport({
  host: "smtp.mailersend.net",
  port: 587,
  auth: {
    user: process.env.MAILERSEND_USER,   // seu usuário SMTP
    pass: process.env.MAILERSEND_PASS,   // sua senha SMTP ou token
  },
});

// --- Inicialização do Aplicativo Express ---
const app = express();
const PORT = process.env.PORT || 3000; // Usa a porta definida no ambiente ou a 3000

// --- Middlewares Globais ---
// Habilita o CORS para que o frontend da sua loja Shopify possa fazer chamadas para este servidor.
app.use(cors());

// Habilita o Express a interpretar o corpo (body) das requisições que chegam em formato JSON.
app.use(express.json());

// =============================================================================
// ||                                  ROTAS                                  ||
// =============================================================================

/**
 * Rota de "saúde" (Health Check)
 * Usada para verificar rapidamente se o servidor está online e respondendo.
 */
app.get("/", (req, res) => {
  res.status(200).send("Servidor do Limitador de Dispositivos está funcionando!");
});

/**
 * Rota Principal: /api/v1/check-device
 * Recebe o ID do cliente e o ID do dispositivo, verifica contra as regras de negócio
 * e retorna se o login é permitido ou negado.
 */
app.post("/api/v1/check-device", async (req, res) => {
  // 1. Extrai os dados do corpo da requisição.
  const { customerId, deviceIdentifier } = req.body;

  // 2. Valida se os dados necessários foram enviados.
  if (!customerId || !deviceIdentifier) {
    return res.status(400).json({
      status: "error",
      message: "As informações customerId e deviceIdentifier são obrigatórias.",
    });
  }

  console.log(`[REQUISIÇÃO] Cliente: ${customerId}, Dispositivo: ${deviceIdentifier}`);

  try {
    // 3. Verifica se o cliente existe na tabela 'customers'. Se não, cria com limite padrão.
    let customerDeviceLimit = 2; // Limite padrão

    const { rows: existingCustomer } = await pool.query(
      "SELECT device_limit FROM customers WHERE customer_id = $1",
      [customerId]
    );

    if (existingCustomer.length === 0) {
      // Cliente não existe, cria um novo registro com o limite padrão
      await pool.query(
        "INSERT INTO customers (customer_id, device_limit) VALUES ($1, $2)",
        [customerId, customerDeviceLimit]
      );
      console.log(`[REGISTRO] Novo cliente '${customerId}' criado com limite padrão de ${customerDeviceLimit} dispositivos.`);
    } else {
      // Cliente existe, usa o limite configurado para ele
      customerDeviceLimit = existingCustomer[0].device_limit;
    }

    // 4. Consulta o banco de dados para buscar os dispositivos já registrados para o cliente.
    const { rows: devices } = await pool.query(
      "SELECT device_identifier FROM customer_devices WHERE customer_id = $1",
      [customerId]
    );

    // 5. Verifica se o dispositivo atual já existe na lista de dispositivos registrados.
    const deviceExists = devices.some((d) => d.device_identifier === deviceIdentifier);

    // 6. Aplica a lógica de negócio com base no limite dinâmico.
    if (devices.length < customerDeviceLimit) {
      // CASO 1: O cliente tem menos dispositivos registrados que o limite.
      // O acesso é permitido. Se o dispositivo for novo, ele é registrado.
      if (!deviceExists) {
        await pool.query(
          "INSERT INTO customer_devices (customer_id, device_identifier) VALUES ($1, $2)",
          [customerId, deviceIdentifier]
        );
        console.log(
          `[REGISTRO] Novo dispositivo '${deviceIdentifier}' registrado para o cliente '${customerId}'.`
        );
      }
      console.log(
        `[PERMITIDO] Cliente '${customerId}' tem ${devices.length} dispositivo(s) (limite: ${customerDeviceLimit}). Acesso permitido.`
      );
      return res.status(200).json({ status: "allowed" });
    } else {
      // CASO 2: O cliente já atingiu ou excedeu o limite de dispositivos.
      if (deviceExists) {
        // O dispositivo atual já é um dos registrados, então o acesso é permitido.
        console.log(
          `[PERMITIDO] Dispositivo conhecido '${deviceIdentifier}' para o cliente '${customerId}'. Acesso permitido.`
        );
        return res.status(200).json({ status: "allowed" });
      } else {
        // O dispositivo é novo e o limite foi atingido, então o acesso é negado.
        console.log(
          `[NEGADO] Cliente '${customerId}' atingiu o limite de ${customerDeviceLimit} dispositivos. Tentativa com novo dispositivo '${deviceIdentifier}' bloqueada.`
        );
        return res.status(403).json({
          status: "denied",
          message: `Você atingiu o limite de ${customerDeviceLimit} dispositivos.`, // Mensagem dinâmica
        });
      }
    }
  } catch (error) {
    // Em caso de qualquer erro com o banco de dados ou outra falha interna.
    console.error("[ERRO NO SERVIDOR]", error);
    return res.status(500).json({
      status: "error",
      message: "Ocorreu um erro interno no servidor.",
    });
  }
});

app.post("/email/send", async (req, res)=>{
  const { customerId, customerEmail } = req.body
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + 10 * 60 * 1000); // expira em 10 minutos

  // await pool.query(
  //   `INSERT INTO codigos_temp (user_id, code, expires_at)
  //   VALUES ($1, $2, $3)
  //   ON CONFLICT (user_id) 
  //   DO UPDATE SET code = $2, expires_at = $3`,
  //   [customerId, code, expiresAt]
  // );

  // console.log(
  //   `[REGISTRO] Novo código '${code}' registrado para o cliente '${customerId}'.`
  // );
  console.log(customerEmail)
  await transporter.sendMail({
    from: `"Minha Loja" MS_KlYAuN@test-eqvygm0k9ejl0p7w.mlsender.net`,
    to: customerEmail,
    subject: "Código de verificação",
    text: `Seu código é: ${code}`,
    html: `<p>Seu código é: <b>${code}</b></p>`,
  });

  return res.status(200).json({ status: "allowed" });
})
app.post("/email/verify", async (req,res)=>{
  return res.status(200).json({ status: "allowed" }); 
})

// =============================================================================
// ||                         INICIALIZAÇÃO DO SERVIDOR                         ||
// =============================================================================
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando na porta http://localhost:${PORT}`);
});



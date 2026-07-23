const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
const pino = require('pino');
require('dotenv').config();

const app = express();
app.use(express.json());

// ==================== CONFIG ====================
const PORT = process.env.PORT || 3000;
const NODE_ENV = process.env.NODE_ENV || 'development';
const IS_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT_ID;

// Session storage - /tmp for Railway, local for development
const SESSION_DIR = NODE_ENV === 'production' 
  ? '/tmp/whatsapp-session'
  : path.join(__dirname, 'session');

const WHATSAPP_API_KEY = process.env.WHATSAPP_API_KEY || 'Password123';
const MAX_RECONNECT_ATTEMPTS = 5;

// Logger setup
const logger = pino({ level: 'info' });

// Create session directory if not exists
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
  logger.info(`✅ Created session directory: ${SESSION_DIR}`);
}

logger.info(`🔧 Environment: ${NODE_ENV}`);
logger.info(`🌐 Platform: ${IS_RAILWAY ? '🚂 Railway' : '💻 Local'}`);
logger.info(`📁 Session Dir: ${SESSION_DIR}`);

// ==================== STATE VARIABLES ====================
let qrCodeUrl = null;
let sock = null;
let isConnected = false;
let reconnectAttempts = 0;
let lastQRTime = null;

// ==================== ENDPOINTS ====================

// 🌐 QR Code Page
app.get('/qr', async (req, res) => {
  try {
    logger.info(`[/qr] Request received - QR Status: ${qrCodeUrl ? 'Generated' : 'Not Yet'}, Connected: ${isConnected}`);
    
    if (qrCodeUrl) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>IACMCON WhatsApp Bot - QR Code</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex; 
              justify-content: center; 
              align-items: center; 
              min-height: 100vh; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container { 
              text-align: center; 
              background: white; 
              padding: 40px; 
              border-radius: 15px; 
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              max-width: 450px;
              width: 90%;
            }
            h1 { 
              color: #0F5A7A; 
              margin-bottom: 10px; 
              font-size: 28px;
            }
            .subheading { 
              color: #666; 
              margin-bottom: 30px; 
              font-size: 14px;
            }
            img { 
              max-width: 100%; 
              width: 300px;
              height: 300px;
              margin: 20px 0; 
              border: 3px solid #667eea; 
              border-radius: 10px;
              padding: 5px;
            }
            .status { 
              color: #FFA500; 
              font-weight: bold; 
              font-size: 16px;
              animation: pulse 2s infinite;
            }
            .footer { 
              color: #999; 
              font-size: 12px; 
              margin-top: 20px;
            }
            @keyframes pulse {
              0%, 100% { opacity: 1; }
              50% { opacity: 0.7; }
            }
            .timer { font-size: 12px; color: #999; margin-top: 10px; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🤖 IACMCON Bot</h1>
            <p class="subheading">Scan with WhatsApp to connect</p>
            <img src="${qrCodeUrl}" alt="QR Code" />
            <p class="status">⏳ Scanning...</p>
            <p class="timer">QR expires in <span id="timer">60</span>s</p>
            <p class="footer">Make sure WhatsApp is open on your phone</p>
          </div>
          <script>
            let seconds = 60;
            setInterval(() => {
              seconds--;
              document.getElementById('timer').textContent = seconds;
              if (seconds <= 0) {
                location.reload();
              }
            }, 1000);
            
            // Refresh page every 30 seconds to get fresh QR
            setTimeout(() => location.reload(), 30000);
          </script>
        </body>
        </html>
      `);
    } else if (isConnected) {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>IACMCON WhatsApp Bot - Connected</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex; 
              justify-content: center; 
              align-items: center; 
              min-height: 100vh; 
              background: linear-gradient(135deg, #56ab2f 0%, #a8e063 100%);
            }
            .container { 
              text-align: center; 
              background: white; 
              padding: 40px; 
              border-radius: 15px; 
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              max-width: 450px;
              width: 90%;
            }
            h1 { 
              color: #0F5A7A; 
              margin-bottom: 20px; 
              font-size: 28px;
            }
            .success { 
              color: #28a745; 
              font-weight: bold; 
              font-size: 60px; 
              margin: 20px 0;
            }
            .message { 
              color: #666; 
              font-size: 16px;
              margin: 15px 0;
            }
            .details {
              background: #f8f9fa;
              border-left: 4px solid #28a745;
              padding: 15px;
              text-align: left;
              margin-top: 20px;
              border-radius: 5px;
              font-size: 12px;
              color: #666;
            }
            .details p { margin: 5px 0; }
            .label { font-weight: bold; color: #0F5A7A; }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>✅ IACMCON Bot</h1>
            <p class="success">✓</p>
            <p class="message">WhatsApp Connected & Ready!</p>
            <div class="details">
              <p><span class="label">Status:</span> Active</p>
              <p><span class="label">Time:</span> ${new Date().toLocaleString('en-IN')}</p>
              <p><span class="label">Ready to send:</span> Messages & Documents</p>
            </div>
          </div>
        </body>
        </html>
      `);
    } else {
      return res.send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>IACMCON WhatsApp Bot - Initializing</title>
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { 
              font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
              display: flex; 
              justify-content: center; 
              align-items: center; 
              min-height: 100vh; 
              background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            }
            .container { 
              text-align: center; 
              background: white; 
              padding: 40px; 
              border-radius: 15px; 
              box-shadow: 0 10px 40px rgba(0,0,0,0.3);
              max-width: 450px;
              width: 90%;
            }
            h1 { 
              color: #0F5A7A; 
              margin-bottom: 20px; 
              font-size: 28px;
            }
            .spinner { 
              border: 4px solid #f3f3f3; 
              border-top: 4px solid #667eea; 
              border-radius: 50%; 
              width: 50px; 
              height: 50px; 
              animation: spin 1s linear infinite; 
              margin: 30px auto;
            }
            @keyframes spin { 
              0% { transform: rotate(0deg); } 
              100% { transform: rotate(360deg); } 
            }
            .message { 
              color: #666; 
              font-size: 14px;
              margin: 15px 0;
            }
            .hint { 
              color: #999; 
              font-size: 12px;
              margin-top: 20px;
            }
          </style>
        </head>
        <body>
          <div class="container">
            <h1>🤖 IACMCON Bot</h1>
            <div class="spinner"></div>
            <p class="message">Initializing WhatsApp connection...</p>
            <p class="hint">Refresh after 5 seconds or wait for auto-refresh</p>
          </div>
          <script>
            setTimeout(() => location.reload(), 5000);
          </script>
        </body>
        </html>
      `);
    }
  } catch (error) {
    res.status(500).send(`<h2>Error: ${error.message}</h2>`);
  }
});

// 🏥 Health Check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsappConnected: isConnected,
    reconnectAttempts: reconnectAttempts,
    qrGenerated: !!qrCodeUrl,
    timestamp: new Date().toISOString()
  });
});

// 📊 Status Endpoint
app.get('/status', (req, res) => {
  res.json({
    bot: {
      version: '1.0.0',
      name: 'IACMCON WhatsApp Bot',
      environment: process.env.NODE_ENV || 'production'
    },
    connection: {
      connected: isConnected,
      reconnectAttempts: reconnectAttempts,
      maxAttempts: MAX_RECONNECT_ATTEMPTS
    },
    qr: {
      generated: !!qrCodeUrl,
      generatedAt: lastQRTime
    },
    server: {
      port: PORT,
      uptime: process.uptime(),
      timestamp: new Date().toISOString()
    }
  });
});

// 📱 Send WhatsApp Message
app.post('/send-whatsapp', async (req, res) => {
  try {
    const { apiKey, phone, message, pdfUrl, fileName } = req.body;

    // Validate API Key
    if (apiKey !== WHATSAPP_API_KEY) {
      return res.status(401).json({ 
        success: false, 
        error: 'Unauthorized: Invalid API Key' 
      });
    }

    // Check connection
    if (!sock || !isConnected) {
      return res.status(400).json({ 
        success: false, 
        error: 'WhatsApp not connected. Scan QR code first.',
        qrUrl: `${req.protocol}://${req.get('host')}/qr`
      });
    }

    // Validate phone
    if (!phone) {
      return res.status(400).json({ 
        success: false, 
        error: 'Phone number is required' 
      });
    }

    // Clean phone number
    let cleanNumber = phone.toString().replace(/\D/g, '');
    if (cleanNumber.length === 10) {
      cleanNumber = '91' + cleanNumber;
    }

    const jid = `${cleanNumber}@s.whatsapp.net`;

    try {
      let messageId;

      // Send PDF if provided
      if (pdfUrl) {
        messageId = await sock.sendMessage(jid, {
          document: { url: pdfUrl },
          mimetype: 'application/pdf',
          fileName: fileName || 'Document.pdf',
          caption: message || ''
        });
        logger.info(`✅ PDF sent to ${cleanNumber} (ID: ${messageId})`);
      } 
      // Send Text message
      else if (message) {
        messageId = await sock.sendMessage(jid, { text: message });
        logger.info(`✅ Text sent to ${cleanNumber} (ID: ${messageId})`);
      } 
      else {
        return res.status(400).json({ 
          success: false, 
          error: 'Either message or pdfUrl is required' 
        });
      }

      return res.json({ 
        success: true, 
        sentTo: cleanNumber,
        messageId: messageId,
        timestamp: new Date().toISOString()
      });

    } catch (sendError) {
      logger.error(`❌ Send failed to ${cleanNumber}: ${sendError.message}`);
      return res.status(500).json({ 
        success: false, 
        error: sendError.message,
        phone: cleanNumber
      });
    }

  } catch (error) {
    logger.error(`Error in /send-whatsapp: ${error.message}`);
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== WHATSAPP CONNECTION ====================

async function connectToWhatsApp() {
  try {
    logger.info(`🔄 Connecting to WhatsApp (Attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
    logger.info(`   Session Directory: ${SESSION_DIR}`);
    
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);
    
    // Check if credentials exist
    if (state.creds.me) {
      logger.info(`✅ Existing credentials found for: ${state.creds.me.id}`);
    } else {
      logger.info(`📱 No existing credentials - QR code will be generated`);
    }

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: pino({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 100,
      defaultQueryTimeoutMs: 0,
      emitOwnEvents: true,
      getMessage: async () => undefined
    });

    // Connection updates
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;

      // QR Code generated
      if (qr) {
        lastQRTime = new Date().toISOString();
        try {
          qrCodeUrl = await qrcode.toDataURL(qr);
          logger.info('📱 New QR Code generated! Open /qr in browser');
          logger.info(`   URL: http://localhost:${PORT}/qr (local) or Railway URL/qr (production)`);
          logger.info(`   QR Generated at: ${lastQRTime}`);
        } catch (qrError) {
          logger.error(`❌ Failed to generate QR code: ${qrError.message}`);
        }
      }

      // Connected successfully
      if (connection === 'open') {
        isConnected = true;
        reconnectAttempts = 0;
        qrCodeUrl = null;
        logger.info('✅ WhatsApp Connected Successfully!');
        logger.info('📊 Bot ready to send messages');
      }

      // Connection closed
      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMsg = lastDisconnect?.error?.message || 'Unknown error';
        
        logger.error(`❌ Connection closed - Status: ${statusCode}, Error: ${errorMsg}`);

        // Determine if should reconnect
        const shouldReconnect = 
          statusCode !== DisconnectReason.loggedOut && 
          statusCode !== DisconnectReason.forbidden;

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delayMs = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000);
          logger.info(`🔄 Reconnecting in ${delayMs / 1000}s (Attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);
          setTimeout(connectToWhatsApp, delayMs);
        } else if (statusCode === DisconnectReason.loggedOut) {
          logger.error('🔐 Logged out. Clear session/ and restart');
        } else {
          logger.error('❌ Max reconnect attempts reached');
        }
      }

      if (connection === 'connecting') {
        logger.info('🔗 Connecting...');
      }
    });

    // Save credentials
    sock.ev.on('creds.update', saveCreds);

    // Connection error handler
    sock.ev.on('connection.error', (error) => {
      logger.error(`🚨 Connection error: ${error?.message || error}`);
    });

  } catch (error) {
    logger.error(`❌ Connection error: ${error?.message || error}`);
    reconnectAttempts++;
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      setTimeout(connectToWhatsApp, 5000);
    } else {
      logger.error('❌ Failed after max attempts');
    }
  }
}

// ==================== GRACEFUL SHUTDOWN ====================

process.on('SIGINT', async () => {
  logger.info('🛑 Shutting down...');
  if (sock) {
    await sock.end();
  }
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('🛑 Terminating...');
  if (sock) {
    await sock.end();
  }
  process.exit(0);
});

// ==================== START SERVER ====================

app.listen(PORT, () => {
  logger.info(`🚀 Server running on port ${PORT}`);
  logger.info(`📱 QR Code: http://localhost:${PORT}/qr`);
  logger.info(`🏥 Health: http://localhost:${PORT}/health`);
  logger.info(`📊 Status: http://localhost:${PORT}/status`);
  
  connectToWhatsApp();
});

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.error(`⚠️ Uncaught Exception: ${error.message}`);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error(`⚠️ Unhandled Rejection: ${reason}`);
});

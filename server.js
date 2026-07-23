const express = require('express');
const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } = require('@whiskeysockets/baileys');
const qrcode = require('qrcode');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Session Directory
const SESSION_DIR = path.join(__dirname, 'session');
if (!fs.existsSync(SESSION_DIR)) {
  fs.mkdirSync(SESSION_DIR, { recursive: true });
}

let qrCodeUrl = null;
let sock = null;
let isConnected = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;

// 🌐 1. QR Code Page Endpoint
app.get('/qr', async (req, res) => {
  if (qrCodeUrl) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>IACMCON WhatsApp Bot</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; }
          .container { text-align: center; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); max-width: 400px; }
          h1 { color: #0F5A7A; margin: 0 0 10px 0; font-size: 28px; }
          .subheading { color: #666; margin-bottom: 30px; font-size: 14px; }
          img { max-width: 300px; margin: 20px 0; border: 3px solid #667eea; border-radius: 10px; }
          .status { color: #FFA500; font-weight: bold; font-size: 16px; }
          .footer { color: #999; font-size: 12px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 IACMCON Bot</h1>
          <p class="subheading">Scan with WhatsApp to connect</p>
          <img src="${qrCodeUrl}" alt="QR Code" />
          <p class="status">⏳ Scanning...</p>
          <p class="footer">QR code expires in 60 seconds</p>
        </div>
        <script>
          setTimeout(() => location.reload(), 30000);
        </script>
      </body>
      </html>
    `);
  } else if (isConnected) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>IACMCON WhatsApp Bot</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; }
          .container { text-align: center; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); max-width: 400px; }
          h1 { color: #0F5A7A; margin: 0; font-size: 28px; }
          .success { color: #28a745; font-weight: bold; font-size: 48px; margin: 20px 0; }
          .message { color: #666; font-size: 16px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>✅ IACMCON Bot</h1>
          <p class="success">✓</p>
          <p class="message">WhatsApp Connected & Ready!</p>
          <p style="color: #999; font-size: 12px;">Status: Active</p>
        </div>
      </body>
      </html>
    `);
  } else {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>IACMCON WhatsApp Bot</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); margin: 0; }
          .container { text-align: center; background: white; padding: 40px; border-radius: 15px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); max-width: 400px; }
          h1 { color: #0F5A7A; margin: 0; font-size: 28px; }
          .loading { margin: 30px 0; }
          .spinner { border: 4px solid #f3f3f3; border-top: 4px solid #667eea; border-radius: 50%; width: 40px; height: 40px; animation: spin 1s linear infinite; margin: 0 auto; }
          @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
          .message { color: #666; font-size: 14px; margin-top: 20px; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🤖 IACMCON Bot</h1>
          <div class="loading">
            <div class="spinner"></div>
            <p class="message">Initializing... Please wait</p>
            <p style="color: #999; font-size: 12px;">Refresh after 5 seconds</p>
          </div>
        </div>
        <script>
          setTimeout(() => location.reload(), 5000);
        </script>
      </body>
      </html>
    `);
  }
});

// 🏥 2. Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsappConnected: isConnected,
    reconnectAttempts: reconnectAttempts,
    timestamp: new Date().toISOString()
  });
});

// 📱 3. Send WhatsApp Endpoint (Text + PDF Support)
app.post('/send-whatsapp', async (req, res) => {
  try {
    const { apiKey, phone, message, pdfUrl, fileName } = req.body;

    const validApiKey = process.env.WHATSAPP_API_KEY || "Password123";
    if (apiKey !== validApiKey) {
      return res.status(401).json({ success: false, error: 'Unauthorized: Invalid API Key' });
    }

    if (!sock || !isConnected) {
      return res.status(400).json({ 
        success: false, 
        error: 'WhatsApp not connected. Please scan QR code first.',
        connected: isConnected
      });
    }

    if (!phone) {
      return res.status(400).json({ success: false, error: 'phone is required' });
    }

    // Phone number cleaning
    let cleanNumber = phone.toString().replace(/\D/g, '');
    if (cleanNumber.length === 10) {
      cleanNumber = '91' + cleanNumber;
    }

    const jid = `${cleanNumber}@s.whatsapp.net`;

    try {
      // 📄 Agar PDF URL diya gaya hai toh Document bhejo
      if (pdfUrl) {
        const msgId = await sock.sendMessage(jid, {
          document: { url: pdfUrl },
          mimetype: 'application/pdf',
          fileName: fileName || 'Registration_Document.pdf',
          caption: message || ''
        });
        console.log(`✅ PDF document sent successfully to ${cleanNumber} (ID: ${msgId})`);
        res.json({ 
          success: true, 
          sentTo: cleanNumber,
          messageId: msgId,
          type: 'document'
        });
      } 
      // 💬 Agar sirf Text Message bhejna ho
      else if (message) {
        const msgId = await sock.sendMessage(jid, { text: message });
        console.log(`✅ Text message sent successfully to ${cleanNumber} (ID: ${msgId})`);
        res.json({ 
          success: true, 
          sentTo: cleanNumber,
          messageId: msgId,
          type: 'text'
        });
      } 
      else {
        return res.status(400).json({ success: false, error: 'Either message or pdfUrl is required' });
      }
    } catch (sendError) {
      console.error(`❌ Failed to send to ${cleanNumber}:`, sendError.message);
      return res.status(500).json({ 
        success: false, 
        error: `Failed to send message: ${sendError.message}`,
        sentTo: cleanNumber
      });
    }

  } catch (error) {
    console.error('❌ Error in /send-whatsapp:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔄 Connection Handler
async function connectToWhatsApp() {
  try {
    console.log(`🔄 Connecting to WhatsApp (Attempt ${reconnectAttempts + 1}/${MAX_RECONNECT_ATTEMPTS})...`);
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: require('pino')({ 
        level: 'error',
        transport: {
          target: 'pino-pretty',
          options: { translateTime: 'SYS:standard', ignore: 'pid,hostname' }
        }
      }),
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 30000,
      retryRequestDelayMs: 100,
      defaultQueryTimeoutMs: 0,
      emitOwnEvents: true,
      getMessage: async () => undefined
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr, isNewLogin } = update;

      if (qr) {
        qrCodeUrl = await qrcode.toDataURL(qr);
        console.log('📱 New QR Code generated! Open /qr page in browser.');
      }

      if (connection === 'open') {
        isConnected = true;
        reconnectAttempts = 0; // Reset on successful connection
        qrCodeUrl = null;
        console.log('✅ WhatsApp Successfully Connected!');
        console.log('📊 Bot ready to send messages');
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const errorMessage = lastDisconnect?.error?.message || 'Unknown error';
        
        console.log(`\n❌ Connection Closed`);
        console.log(`   Status Code: ${statusCode}`);
        console.log(`   Error: ${errorMessage}`);
        console.log(`   Time: ${new Date().toLocaleTimeString()}\n`);

        // Check disconnect reason
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== DisconnectReason.forbidden;

        if (shouldReconnect && reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
          reconnectAttempts++;
          const delayMs = Math.min(5000 * Math.pow(2, reconnectAttempts - 1), 60000); // Exponential backoff
          console.log(`🔄 Reconnecting in ${delayMs / 1000} seconds...`);
          setTimeout(connectToWhatsApp, delayMs);
        } else if (statusCode === DisconnectReason.loggedOut) {
          console.log('🔐 Logged out. Clear session folder and restart.');
          console.log('   Run: rm -rf session/ && npm start');
          isConnected = false;
        } else {
          console.log(`⚠️  Max reconnect attempts reached. Manual restart needed.`);
        }
      }

      if (connection === 'connecting') {
        console.log('🔗 Connecting...');
      }
    });

    sock.ev.on('creds.update', saveCreds);

    // Connection error handler
    sock.ev.on('connection.error', (error) => {
      console.error('❌ Connection Error:', error?.message || error);
    });

  } catch (error) {
    console.error('❌ WhatsApp Connection Error:', error?.message || error);
    reconnectAttempts++;
    
    if (reconnectAttempts < MAX_RECONNECT_ATTEMPTS) {
      setTimeout(connectToWhatsApp, 5000);
    } else {
      console.log('❌ Failed to connect after max attempts');
    }
  }
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  if (sock) {
    await sock.end();
  }
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`📱 QR Code: http://localhost:${PORT}/qr`);
  connectToWhatsApp();
});

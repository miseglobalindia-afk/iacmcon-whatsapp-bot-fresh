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

// 🌐 1. QR Code Page Endpoint
app.get('/qr', async (req, res) => {
  if (qrCodeUrl) {
    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>IACMCON WhatsApp Bot</title>
        <style>
          body { font-family: Arial, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; background: #f0f0f0; margin: 0; }
          .container { text-align: center; background: white; padding: 30px; border-radius: 10px; box-shadow: 0 0 10px rgba(0,0,0,0.1); }
          h1 { color: #0F5A7A; }
          img { max-width: 280px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>IACMCON WhatsApp Bot</h1>
          <p>Scan this QR code with your WhatsApp</p>
          <img src="${qrCodeUrl}" alt="QR Code" />
          <p>Status: Connecting...</p>
        </div>
      </body>
      </html>
    `);
  } else if (isConnected) {
    res.send(`<h2 style="font-family: Arial; text-align: center; margin-top: 50px; color: green;">✅ WhatsApp is Connected and Ready!</h2>`);
  } else {
    res.send(`<h2 style="font-family: Arial; text-align: center; margin-top: 50px;">⏳ Initializing WhatsApp... Please refresh in 5 seconds.</h2>`);
  }
});

// 🏥 2. Health Check Endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    whatsappConnected: isConnected,
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
        error: 'WhatsApp not connected. Please scan QR code first.' 
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

    // 📄 Agar PDF URL diya gaya hai toh Document bhejo
    if (pdfUrl) {
      await sock.sendMessage(jid, {
        document: { url: pdfUrl },
        mimetype: 'application/pdf',
        fileName: fileName || 'Registration_Document.pdf',
        caption: message || '' // Document ke sath ka text message
      });
      console.log(`✅ PDF document sent successfully to ${cleanNumber}`);
    } 
    // 💬 Agar sirf Text Message bhejna ho
    else if (message) {
      await sock.sendMessage(jid, { text: message });
      console.log(`✅ Text message sent successfully to ${cleanNumber}`);
    } 
    else {
      return res.status(400).json({ success: false, error: 'Either message or pdfUrl is required' });
    }

    res.json({ success: true, sentTo: cleanNumber });

  } catch (error) {
    console.error('❌ Error sending WhatsApp message:', error);
    res.status(500).json({ success: false, error: error.message });
  }
});

// 🔄 Connection Handler
async function connectToWhatsApp() {
  try {
    console.log('🔄 Connecting to WhatsApp...');
    const { state, saveCreds } = await useMultiFileAuthState(SESSION_DIR);

    sock = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      logger: require('pino')({ level: 'silent' }),
      browser: Browsers.ubuntu('Chrome'),
      connectTimeoutMs: 60000,
      keepAliveIntervalMs: 10000,
    });

    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        qrCodeUrl = await qrcode.toDataURL(qr);
        console.log('📱 New QR Code generated! Open /qr page in browser.');
      }

      if (connection === 'open') {
        isConnected = true;
        qrCodeUrl = null;
        console.log('✅ WhatsApp Successfully Connected!');
      }

      if (connection === 'close') {
        isConnected = false;
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        console.log('❌ Connection Closed Status Code:', statusCode);

        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;
        if (shouldReconnect) {
          console.log('🔄 Attempting to reconnect in 5 seconds...');
          setTimeout(connectToWhatsApp, 5000);
        } else {
          console.log('❌ Logged out from WhatsApp. Clear session folder and restart.');
        }
      }
    });

    sock.ev.on('creds.update', saveCreds);

  } catch (error) {
    console.error('❌ WhatsApp Connection Error:', error);
    setTimeout(connectToWhatsApp, 5000);
  }
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  connectToWhatsApp();
});

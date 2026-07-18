const https = require('https');

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

function sendMessage(text) {
  return new Promise((resolve) => {
    if (!TOKEN || !CHAT_ID) {
      console.warn('Telegram not configured - skipping notification:', text);
      return resolve();
    }
    const payload = JSON.stringify({ chat_id: CHAT_ID, text, parse_mode: 'HTML' });
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => res.on('data', () => {})
    );
    req.on('error', (err) => console.warn('Telegram send failed:', err.message));
    req.write(payload);
    req.end();
    resolve();
  });
}

async function notifySuccess({ title, longUrl, shortUrl, narrativeStyle }) {
  const styleLine = narrativeStyle ? `\nStyle: ${narrativeStyle}` : '';
  await sendMessage(
    `✅ Video published: <b>${title}</b>\nLong: ${longUrl}\nShort: ${shortUrl}${styleLine}`
  );
}

async function notifyFailure(step, error) {
  await sendMessage(`❌ Pipeline failed at step "<b>${step}</b>":\n${error.message || error}`);
}

module.exports = { sendMessage, notifySuccess, notifyFailure };

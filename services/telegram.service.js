const https = require('https');

const TOKEN = (process.env.TELEGRAM_BOT_TOKEN || '').trim();
const CHAT_ID = (process.env.TELEGRAM_CHAT_ID || '').trim();

function sendMessage(text, { html = false } = {}) {
  return new Promise((resolve) => {
    if (!TOKEN || !CHAT_ID) {
      console.warn('Telegram not configured - skipping notification:', text);
      return resolve();
    }
    const safeText = text.length > 4000 ? `${text.slice(0, 4000)}\n... (truncated)` : text;
    const body = { chat_id: CHAT_ID, text: safeText };
    if (html) body.parse_mode = 'HTML';
    const payload = Buffer.from(JSON.stringify(body), 'utf-8');
    const req = https.request(
      {
        hostname: 'api.telegram.org',
        path: `/bot${TOKEN}/sendMessage`,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length },
      },
      (res) => {
        let resBody = '';
        res.on('data', (chunk) => { resBody += chunk; });
        res.on('end', () => {
          if (res.statusCode >= 400) {
            console.warn(`Telegram send failed: HTTP ${res.statusCode} ${resBody.slice(0, 300)}`);
            if (html) {
              sendMessage(text.replace(/<\/?[^>]+>/g, ''), { html: false }).then(resolve);
              return;
            }
          }
          resolve();
        });
      }
    );
    req.on('error', (err) => {
      console.warn('Telegram send failed:', err.message);
      resolve();
    });
    req.write(payload);
    req.end();
  });
}

async function notifySuccess({ title, longUrl, shortUrl, narrativeStyle }) {
  const styleLine = narrativeStyle ? `\nStyle: ${narrativeStyle}` : '';
  await sendMessage(
    `✅ Video published: <b>${title}</b>\nLong: ${longUrl}\nShort: ${shortUrl}${styleLine}`,
    { html: true }
  );
}

async function notifyFailure(step, error) {
  const detail = error?.stack || error?.message || String(error);
  await sendMessage(`❌ Pipeline failed at step "${step}":\n${detail}`);
}

module.exports = { sendMessage, notifySuccess, notifyFailure };

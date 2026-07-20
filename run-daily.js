require('dotenv').config();

const { runDailyWithStagger } = require('./pipeline');

async function main() {
  const jitterMs = Math.floor(Math.random() * 40 * 60 * 1000);
  console.log(`Starting in ${Math.round(jitterMs / 60000)} minutes (jitter)...`);
  await new Promise((r) => setTimeout(r, jitterMs));

  await runDailyWithStagger();
}

main()
  .then(() => {
    console.log('\nDaily run complete.');
    process.exit(0);
  })
  .catch((err) => {
    console.error('Daily run failed:', err);
    process.exit(1);
  });

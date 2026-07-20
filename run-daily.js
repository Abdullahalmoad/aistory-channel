require('dotenv').config();

const { runDailyWithStagger } = require('./pipeline');

async function main() {
  const jitterMs = Math.floor((60 + Math.random() * 120) * 60 * 1000); // 60-180 min delay
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

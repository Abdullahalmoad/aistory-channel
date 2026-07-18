// scheduler.js
require('dotenv').config();
const cron = require('node-cron');
const { runDailyPipeline } = require('./pipeline');

const SCHEDULE = process.env.PIPELINE_CRON || '0 9 * * 1,3,5,6';

console.log(`Scheduler started. Will run daily pipeline at cron "${SCHEDULE}" (server time).`);

cron.schedule(SCHEDULE, async () => {
  const jitterMs = Math.floor(Math.random() * 40 * 60 * 1000);
  console.log(`\n[${new Date().toISOString()}] Cron triggered - waiting ${Math.round(jitterMs / 60000)}min jitter before starting`);
  await new Promise((r) => setTimeout(r, jitterMs));

  console.log(`[${new Date().toISOString()}] Starting daily pipeline`);
  try {
    await runDailyPipeline();
  } catch (err) {
    console.error('Daily pipeline run failed:', err.message);
  }
});

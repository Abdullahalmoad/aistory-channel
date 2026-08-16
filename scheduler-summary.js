// scheduler-summary.js
// Runs the summary-Short pipeline daily. Separate from scheduler.js so the
// original long-form pipeline is completely untouched.
require('dotenv').config();
const cron = require('node-cron');
const { runDailySummaryShort } = require('./pipeline-summary');

const SCHEDULE = process.env.SUMMARY_PIPELINE_CRON || '0 10 * * *'; // every day 10:00 server time

console.log(`Summary Short scheduler started. Will run daily at cron "${SCHEDULE}" (server time).`);

cron.schedule(SCHEDULE, async () => {
  const jitterMs = Math.floor(Math.random() * 20 * 60 * 1000);
  console.log(`\n[${new Date().toISOString()}] Cron triggered - waiting ${Math.round(jitterMs / 60000)}min jitter before starting`);
  await new Promise((r) => setTimeout(r, jitterMs));

  console.log(`[${new Date().toISOString()}] Starting summary Short pipeline`);
  try {
    await runDailySummaryShort();
  } catch (err) {
    console.error('Summary Short pipeline run failed:', err.message);
  }
});

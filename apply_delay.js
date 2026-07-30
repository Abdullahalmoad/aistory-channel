const fs = require('fs');
const file = 'pipeline.js';
const bak = file + '.bak-delay';
const original = fs.readFileSync(file, 'utf8');
fs.writeFileSync(bak, original);

const old = `  const minDelayMs = 90 * 60 * 1000;
  const maxDelayMs = 4 * 60 * 60 * 1000;
  const delayMs = minDelayMs + Math.floor(Math.random() * (maxDelayMs - minDelayMs));
  console.log(\`\nWaiting \${Math.round(delayMs / 60000)} minutes before uploading the Short...\`);
  await new Promise((r) => setTimeout(r, delayMs));`;

const next = `  const delayMs = 10 * 60 * 1000;
  console.log(\`\nWaiting \${Math.round(delayMs / 60000)} minutes before uploading the Short...\`);
  await new Promise((r) => setTimeout(r, delayMs));`;

const count = original.split(old).length - 1;
if (count !== 1) {
  throw new Error(`expected exactly 1 match, found ${count}`);
}
fs.writeFileSync(file, original.replace(old, next));
console.log(`OK patched ${file} (backup at ${bak})`);

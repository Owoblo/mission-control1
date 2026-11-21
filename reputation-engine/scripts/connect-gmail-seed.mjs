#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { parseEnv } from 'node:util';
import { ImapFlow } from 'imapflow';

const file = path.resolve(process.cwd(), '.env.warmup.local');

function question(prompt, hidden = false) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) throw new Error('Run this command in an interactive terminal.');
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = string => {
        if (string.includes(prompt)) process.stdout.write(string);
        else if (string === '\r\n' || string === '\n') process.stdout.write(string);
      };
    }
    rl.question(prompt, answer => { rl.close(); resolve(answer.trim()); });
    rl.on('SIGINT', () => { rl.close(); reject(new Error('Cancelled.')); });
  });
}

async function check(email, password) {
  const client = new ImapFlow({
    host: 'imap.gmail.com', port: 993, secure: true,
    auth: { user: email, pass: password },
    logger: false, emitLogs: false, disableAutoIdle: true,
    socketTimeout: 15000, greetingTimeout: 15000,
  });
  try {
    await client.connect();
    await client.mailboxOpen('INBOX', { readOnly: true });
  } finally {
    if (client.usable) await client.logout().catch(() => {});
    else client.close();
  }
}

try {
  const saved = fs.existsSync(file) ? parseEnv(fs.readFileSync(file, 'utf8')) : {};
  if (process.argv.includes('--check')) {
    if (!saved.GMAIL_SEED_EMAIL || !saved.GMAIL_SEED_APP_PASSWORD) throw new Error('No Gmail seed connection saved. Run without --check first.');
    await check(saved.GMAIL_SEED_EMAIL, saved.GMAIL_SEED_APP_PASSWORD);
    console.log(`Read-only Gmail IMAP check passed for ${saved.GMAIL_SEED_EMAIL}. No mail sent or moved.`);
    process.exit(0);
  }
  if (fs.existsSync(file)) throw new Error(`${file} already exists. Run --check, or move the file aside before reconnecting.`);
  console.log('Connect a dedicated Gmail placement-test account. Nothing will be sent or moved.');
  const email = (await question('Gmail address: ')).toLowerCase();
  if (!/^[^\s@]+@gmail\.com$/.test(email)) throw new Error('Use a personal @gmail.com seed account for this connector.');
  const password = (await question('Google app password (hidden): ', true)).replace(/\s/g, '');
  if (!/^[a-z]{16}$/i.test(password)) throw new Error('Expected a 16-letter Google app password. No credential saved.');
  await check(email, password);
  const contents = `GMAIL_SEED_EMAIL=${JSON.stringify(email)}\nGMAIL_SEED_APP_PASSWORD=${JSON.stringify(password)}\n`;
  fs.writeFileSync(file, contents, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  fs.chmodSync(file, 0o600);
  console.log(`Read-only Gmail IMAP check passed for ${email}. Credential saved locally in ${file} (owner-only permissions). No mail sent or moved.`);
} catch (error) {
  console.error(`Gmail connection failed: ${error.message}`);
  process.exitCode = 1;
}

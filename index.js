import 'dotenv/config';
import fs from 'node:fs/promises';
import { input, select, Separator } from '@inquirer/prompts';
import { TelegramClient } from 'telegram';
import { StoreSession } from 'telegram/sessions/index.js';
import PitchJS from './pitch.js';
import got from 'got';

const APP_ID = parseInt(process.env.APP_ID);
const APP_HASH = process.env.APP_HASH;

async function tambah_sesi() {
  const phonenum = await input({
    message: 'Nomor HP',
    required: true,
    validate: (value) => {
      return value.match(/^\+?\d+$/)
        ? true
        : 'Nomor tidak valid';
    }
  }).then(result => result.replace('+', ''));

  const client = new TelegramClient(new StoreSession(`sessions/${phonenum}`), APP_ID, APP_HASH);

  await client.start({
    phoneNumber: phonenum,
    phoneCode: async () => await input({
      message: 'Kode verifikasi',
      required: true
    }),
    onError: (err) => console.error(err)
  });
}

async function start_farming() {
  const dirlist = await fs.readdir('sessions');
  
  dirlist.forEach(async (phonenum) => {
    const client = new TelegramClient(new StoreSession(`sessions/${phonenum}`), APP_ID, APP_HASH);
    const pitch = new PitchJS(phonenum, client);
    await pitch.Start()
  });
}

(async () => {
  /** @type <string|null> */
  const action = await select({
    message: 'Pilih aksi',
    choices: [
      {
        name: 'Mulai farming',
        value: 'start_farming',
      },
      new Separator(),
      {
        name: 'Tambah sesi',
        value: 'add_session'
      },
      new Separator(),
      {
        name: 'Exit',
        value: null
      }
    ]
  }).catch(() => null);

  switch (action) {
    case 'add_session': return await tambah_sesi();
    case 'start_farming': return await start_farming();
    case null: return;
  }
})();
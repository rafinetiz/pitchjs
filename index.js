import 'dotenv/config';
import fs from 'node:fs/promises';
import { input, select, Separator } from '@inquirer/prompts';
import { Logger, TelegramClient } from 'telegram';
import { StoreSession } from 'telegram/sessions/index.js';
import PitchJS from './pitch.js';
import * as dcjs from 'discord.js';
import logger from './logger.js';

const APP_ID = parseInt(process.env.APP_ID);
const APP_HASH = process.env.APP_HASH;
const base_tg_logger = new Logger('none');

/**
 * @returns {Promise<{client: dcjs.Client; notify_ch: dcjs.TextChannel}|null>}
 */
async function setup_discord() {
  if (process.env.ENABLE_DISCORD !== '1') {
    return null;
  }
  

  const client = new dcjs.Client({
    intents: [dcjs.GatewayIntentBits.Guilds]
  });

  client.on('ready', (c) => {
    logger.info('discord bot ready!');
  });

  await client.login(process.env.DISCORD_TOKEN);
  const channel = await client.channels.fetch(process.env.NOTIFY_CHANNEL_ID);

  return {
    client,
    notify_ch: channel
  }
}

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

  const client = new TelegramClient(new StoreSession(`sessions/${phonenum}`), APP_ID, APP_HASH, {
    baseLogger: base_tg_logger
  });

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
  const discord = await setup_discord();
  const dirlist = await fs.readdir('sessions');
  
  dirlist.forEach(async (phonenum) => {
    const client = new TelegramClient(new StoreSession(`sessions/${phonenum}`), APP_ID, APP_HASH, {
      baseLogger: base_tg_logger
    });
    const pitch = new PitchJS(phonenum, client);
    
    if (discord) {
      pitch.on('pitch:farmClaim', (result, instance) => {
        const nextClaimDate = new Date(result.farming.endTime);

        discord.notify_ch.send({
          content: dcjs.codeBlock(
            `${instance.phone} - ${result.username} claim successfully\n` +
            `balance    : ${result.coins}\n` +
            `next_claim : ${nextClaimDate.toLocaleString()}`
          )
        });
      });

      pitch.on('pitch:daily', (username, { coins, tickets, loginStreak, isNewDay}, instance) => {
        if (!isNewDay) {
          return;
        }

        discord.notify_ch.send({
          content: dcjs.codeBlock(
            `${instance.phone} (${username}) DAILY CLAIM NOTIFY` +
            `daily_coins   : ${coins}` +
            `daily_tickets : ${tickets}` +
            `daily_streak  : ${loginStreak}`
          )
        });
      });
    }

    await pitch.Start()
  });
}

(async () => {
  /** @type <string|null> */
  const action = await select({
    message: 'Pitch Auto Claimer',
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

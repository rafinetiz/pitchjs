import { Api } from 'telegram';
import got from 'got';
import EventEmitter from 'node:events';
import logger from './logger.js';

export default class PitchJS extends EventEmitter {
  static PitchBotId = 'pitchtalk_bot';

  constructor(
    /** @type {string} */ phone,
    /** @type {import('telegram').TelegramClient} */ tg
  ) {
    super();
    /** @type {string} */
    this.phone = phone;
    /**
     * @private
     * @type {import('telegram').TelegramClient}
     */
    this._tg = tg;
    this._httpraw = got.extend({
      prefixUrl: 'https://api.pitchtalk.app',
      http2: true,
      headers: {
        'Sec-Ch-Ua-Platform': '"Windows"',
        'Sec-Ch-Ua': '"Microsoft Edge";v="129", "Not=A?Brand";v="8", "Chromium";v="129", "Microsoft Edge WebView2";v="129"',
        'Sec-Ch-Ua-Mobile': '?0',
        'Sec-Fetch-Site': 'same-site',
        'Sec-Fetch-Mode': 'cors',
        'Sec-Fetch-Dest': 'empty',
        'Priority': 'u=1, i',
        'Accept': 'application/json, text/plain, */*',
        'Accept-Encoding': 'gzip, deflate, br',
        'Accept-Language': 'en-US,en;q=0.9',

        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0',
        'Origin': 'https://webapp.pitchtalk.app',
        'Referer': 'https://webapp.pitchtalk.app/'
      },
    });

    this._http = got.extend(this._httpraw, {
      hooks: {
        beforeRequest: [async (options) => {
          if (this._tokenLock) {
            throw new Error('request canceled because token currently being refreshed');
          }

          if (this._tokenExpireDate > 0 && Date.now() > this._tokenExpireDate) {
            this._tokenLock = true;
            await this.login().finally(() => this._tokenLock = false);
          }

          if (this._accessToken !== null) {
            options.headers['Authorization'] = `Bearer ${this._accessToken}`
          }
        }]
      }
    });


    /** @type {string|null} */
    this._accessToken = null;
    /** @type {number} */
    this._tokenExpireDate = -1;
    /** @type {boolean} */
    this._tokenLock = false;
    /** @type {number} */
    this._updatedAt = 0;
    /** @type {number} */
    this._nextFarmingClaimTime = 0;
  }

  /**
   * @returns {Promise<URLSearchParams>} webappdata
   */
  async getWebAppData() {
    await this._tg.connect();
    const webview = await this._tg.invoke(
      new Api.messages.RequestWebView({
        peer: await this._tg.getPeerId(PitchJS.PitchBotId),
        bot: await this._tg.getPeerId(PitchJS.PitchBotId),
        platform: 'android',
        fromBotMenu: true,
        url: 'https://webapp.pitchtalk.app/'
      })
    ).finally(() => this._tg.destroy());

    const params = new URLSearchParams(
      webview.url.substring(webview.url.indexOf('#'))
    );

    const webappdata = params.get('#tgWebAppData');

    return new URLSearchParams(webappdata);
  }

  /**
   * 
   * @param {import('got').OptionsInit} options 
   */
  async request(options) {
    try {
      const response = await this._http(options);

    } catch (err) {
    }
  }

  /**
   * @typedef {{
   *   id: string;
   *   lastReferralRewardClaim: string | null;
   *   photoUrl: string;
   *   telegramId: string;
   *   username: string;
   *   referralCode: string;
   *   referralById: string | null;
   *   farmingId: string;
   *   referralRewards: number;
   *   loginStreak: number;
   *   lastLogin: string;
   *   coins: number;
   *   tickets: number;
   *   createdAt: string;
   *   updatedAt: string;
   *   role: string;
   * }} PitchUser
   * 
   * @typedef {{
   *  accessToken: string;
   *  user: PitchUser,
   *  isNewUser: boolean;
   *  dailyRewards: {
   *    coins: number;
   *    tickets: number;
   *    loginStreak: number;
   *    isNewDay: boolean;
   *  }
   * }} PitchLoginResponse
   * @returns {Promise<PitchLoginResponse>}
   */
  async login() {
    const webappdata = await this.getWebAppData();
    const user = webappdata.get('user');
    if (!user) {
      throw new Error('webappdata user is empty');
    }
    const { id, username } = JSON.parse(user);

    /** @type {PitchLoginResponse} */
    const response = await this._httpraw.post('v1/api/auth', {
      json: {
        telegramId: `${id}`,
        username,
        hash: webappdata.toString(),
        referralCode: '',
        photoUrl: ''
      }
    }).json();

    const { accessToken, dailyRewards, user: pitchUser } = response;
    const jsonData = JSON.parse(
      Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8')
    );

    this._accessToken = accessToken;
    this._tokenExpireDate = jsonData.exp * 1000;
    this._updatedAt = new Date(pitchUser.updatedAt).getTime();
    this.emit('pitch:login', response);

    if (dailyRewards.isNewDay) {
      this.emit('pitch:daily', dailyRewards);
    }

    return response;
  }

  /**
   * @typedef {PitchUser & {
   *  farming: {
   *    id: string;
   *    userId: string;
   *    startTime: string;
   *    endTime: string;
   *    isClaimed: boolean;
   *    isActive: boolean;
   *    createdAt: string;
   *    updatedAt: string;
   *  }
   * }} FarmClaimResponse
   * @returns {Promise<void>}
   */
  async ClaimFarming() {
    /** @type {FarmClaimResponse} */
    const { farming, coins } = await this._http.post('v1/api/users/claim-farming').json();

    this._nextFarmingClaimTime = new Date(farming.endTime).getTime();

    this.emit('pitch:farmClaim', coins);
  }

  async CheckFarming() {
    const { statusCode, body } = await this._http.get('v1/api/farmings');

    if (statusCode == 304) {
      throw new Error('farming status: 304 not modified')
    }

    /**
     * @type {{
     *  id: string;
     *  userId: string;
     *  startTime: string;
     *  endTime: string;
     *  isClaimed: boolean;
     *  isActive: boolean;
     *  createdAt: string;
     *  updateAt: string;
     * }}
     */
    const { endTime, isActive  } = JSON.parse(body);
    this._nextFarmingClaimTime = new Date(endTime).getTime();
    this.emit('pitch:farmCheck', this._nextFarmingClaimTime);
  }

  async Start() {
    logger.info(`${this.phone} | starting`);

    this.on('pitch:login', ({user}) => {
      logger.info(`${this.phone} | login success | coins=${user.coins}`);
    });

    this.on('pitch:farmCheck', time => {
      logger.info(`${this.phone} | farm check | endTime=${(time - Date.now()) / 1000}s`);
    });

    this.on('pitch:farmClaim', coins => {
      logger.info(`${this.phone} | farm claim success | coins=${coins}`);
    })

    this.on('pitch:daily', ({ coins, tickets, loginStreak }) => {
      logger.info(`${this.phone} | daily claim success | coins=${coins} tickets=${tickets} streak=${loginStreak}`);
    });

    await this.login();
    await this.CheckFarming();

    while(true) {
      const now = Date.now();

      if (now > this._nextFarmingClaimTime) {
        await this.ClaimFarming().catch((err) => {
          logger.error(`${this.phone} | farm claim failed | ${err.message}`);
        });
      }

      await new Promise(r => setTimeout(r, 600000));
    }
  }
}
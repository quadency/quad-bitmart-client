import WebSocket from 'ws';
import axios from 'axios';
import CryptoJS from 'crypto-js';
import pako from 'pako';
import { CHANNELS, WEBSOCKET_CODES, WEBSOCKET_STATUS } from './utils';


const WEBSOCKET_URI = 'wss://ws-manager-compress.bitmart.com/';
const MAPPINGS_ENDPOINT = 'https://www.bitmart.com/api/market_trade_mappings_front';
const BASE_URL = 'https://openapi.bitmart.com/v2';
const PRECISIONS_ENDPOINT = `${BASE_URL}/symbols_details`;
const EXCHANGE = 'BITMART';

class WebsocketClient {
  constructor(correlationId, userConfig = {}) {
    Object.keys(userConfig).forEach((key) => {
      this[key] = userConfig[key];
    });
    this.correlationId = correlationId;
    this.SYMBOL_NAME_MAP = {};
    this.SYMBOL_PRECISIONS_MAP = {};
    this.socket = null;
    this.accessToken = null;
  }

  async login() {
    if (this.accessToken) {
      return;
    }
    if (!this.apiKey || !this.secret || !this.apiName) {
      throw new Error('Must provide credentials for authenticated route');
    }
    const message = `${this.apiKey}:${this.secret}:${this.apiName}`;

    const crypt = CryptoJS.HmacSHA256(message, this.secret);
    const signature = crypt.toString(CryptoJS.enc.HEX);

    const options = {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
      },
      params: {
        grant_type: 'client_credentials',
        client_id: this.apiKey,
        client_secret: signature,
      },
      url: `${BASE_URL}/authentication`,
    };

    const response = await axios(options);
    const { access_token: accessToken } = response.data;
    this.accessToken = accessToken;
  }

  async populateSymbolMap() {
    if (!Object.keys(this.SYMBOL_NAME_MAP).length) {
      const response = await axios(MAPPINGS_ENDPOINT);
      this.SYMBOL_NAME_MAP = response.data.data.result.reduce((acc, obj) => {
        obj.mappingList.forEach((pairObj) => {
          acc[pairObj.symbol] = pairObj.name;
        });
        return acc;
      }, {});
    }
  }

  async populatePrecisionsMapping() {
    if (!Object.keys(this.SYMBOL_PRECISIONS_MAP).length) {
      const response = await axios(PRECISIONS_ENDPOINT);
      this.SYMBOL_PRECISIONS_MAP = response.data.reduce((acc, obj) => {
        acc[obj.id] = obj.price_max_precision;
        return acc;
      }, {});
    }
  }

  addToSubscription(subscription) {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      subscription.forEach((sub) => {
        this.socket.send(JSON.stringify(sub));
      });
      return;
    }
    console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} cannot add to subscription, connection not open`);
  }

  subscribe(subscription, callback) {
    this.populateSymbolMap().then(() => {
      this.socket = new WebSocket(WEBSOCKET_URI);

      let pingInterval;

      this.socket.onopen = () => {
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} connection open`);
        subscription.forEach((sub) => {
          this.socket.send(JSON.stringify(sub));
        });

        pingInterval = setInterval(() => {
          if (this.socket && this.socket.readyState === this.socket.OPEN) {
            const pingMessage = { subscribe: 'ping' };
            this.socket.send(JSON.stringify(pingMessage));
          }
        }, 5000);
      };

      this.socket.onmessage = (message) => {
        const payload = pako.inflateRaw(message.data, { to: 'string' });
        if (!payload) {
          console.log('empty payload, skipping...');
          return;
        }
        const payloadObj = JSON.parse(payload);
        callback(payloadObj);
      };

      this.socket.onclose = () => {
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} connection closed`);
        clearInterval(pingInterval);
      };

      this.socket.onerror = (error) => {
        console.log(`[correlationId=${this.correlationId}] error with ${EXCHANGE} connection because`, error);

        // reconnect if error
        this.subscribe(subscription, callback);
      };
      return () => { this.socket.close(); };
    });
  }


  subscribePrices(pairs, callback) {
    const CHANNEL = CHANNELS.PRICE;
    if (!pairs) {
      throw new Error('must provide pairs to subscribe to');
    }
    const subscriptions = pairs.map((pair) => {
      const [base, quote] = pair.split('/');
      return {
        subscribe: CHANNEL,
        symbol: `${base}_${quote}`,
        local: 'en_US',
      };
    });

    this.subscribe(subscriptions, (msg) => {
      const {
        subscribe, symbol, data: tick, code,
      } = msg;
      if (subscribe === CHANNEL && code === WEBSOCKET_CODES.SUCCESS) {
        // conditional in case bitmart decides to change how they map symbols
        callback(Object.assign(tick, { pair: this.SYMBOL_NAME_MAP[symbol] ? this.SYMBOL_NAME_MAP[symbol] : symbol }));
        return;
      }
      console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} subscription error: ${WEBSOCKET_STATUS[code]}`);
    });
  }

  addToTradeSubscription(pairs) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = CHANNELS.TRADE;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }
      const subscriptions = pairs.map((pair) => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US',
        };
      });
      this.addToSubscription(subscriptions);
    });
  }

  subscribeTrades(pairs, callback) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = CHANNELS.TRADE;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }
      const subscriptions = pairs.map((pair) => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US',
        };
      });

      this.subscribe(subscriptions, (msg) => {
        const {
          subscribe, symbol, data: trades, firstSubscribe, code,
        } = msg;
        if (subscribe === CHANNEL && code === WEBSOCKET_CODES.SUCCESS) {
          // conditional in case bitmart decides to change how they map symbols
          callback(Object.assign(trades, {
            firstSubscribe,
            pair: this.SYMBOL_NAME_MAP[symbol] ? this.SYMBOL_NAME_MAP[symbol] : symbol,
          }));
          return;
        }
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} subscription error: ${WEBSOCKET_STATUS[code]}`);
      });
    });
  }

  addToOrdersSubscription(pairs) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = CHANNELS.ORDER;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }
      const subscriptions = pairs.map((pair) => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US',
        };
      });
      this.addToSubscription(subscriptions);
    });
  }

  subscribeOrders(pairs, callback) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = CHANNELS.ORDER;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }

      const subscriptions = pairs.map((pair) => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US',
        };
      });

      this.subscribe(subscriptions, (msg) => {
        const {
          subscribe, symbol, data: orders, code,
        } = msg;
        if (subscribe === CHANNEL && code === WEBSOCKET_CODES.SUCCESS) {
          // conditional in case bitmart decides to change how they map symbols
          callback(Object.assign(orders, { pair: this.SYMBOL_NAME_MAP[symbol] ? this.SYMBOL_NAME_MAP[symbol] : symbol }));
          return;
        }
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} subscription error: ${WEBSOCKET_STATUS[code]}`);
      });
    });
  }

  subscribeNotify(callback) {
    this.login().then(() => {
      const subscription = { subscribe: 'notify', token: this.accessToken };
      this.subscribe([subscription], (msg) => {
        callback(msg);
      });
    });
  }

  subscribeUserOrders(pairs, callback) {
    this.login().then(() => {
      const args = pairs.map((pair) => `spot/order:${pair.replace('/', '_')}`);
      const subscription = { op: 'subscribe', token: this.accessToken, args };
      this.subscribe([subscription], (msg) => {
        const callbackMessage = msg;
        callbackMessage.data.trademapping_name = msg.data.trademapping_name.replace('_', '/');
        callback(callbackMessage);
      });
    });
  }

  unsubscribe() {
    if (this.socket) {
      if (this.socket && this.socket.readyState === this.socket.OPEN) {
        this.socket.close();
      }
      this.socket = null;
    }
  }
}

export default WebsocketClient;

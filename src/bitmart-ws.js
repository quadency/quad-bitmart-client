import WebSocket from 'ws';
import axios from 'axios';
import pako from 'pako';
import { CHANNELS } from './utils';


const WEBSOCKET_URI = 'wss://ws-manager-compress.bitmart.com/';
const MAPPINGS_ENDPOINT = 'https://www.bitmart.com/api/market_trade_mappings_front';
const EXCHANGE = 'BITMART';

class WebsocketClient {
  constructor(correlationId, userConfig = {}) {
    Object.keys(userConfig).forEach((key) => {
      this[key] = userConfig[key];
    });
    this.correlationId = correlationId;
    this.SYMBOL_NAME_MAPPING = {};
  }

  async populateSymbolMap() {
    if (!Object.keys(this.SYMBOL_NAME_MAPPING).length) {
      const response = await axios(MAPPINGS_ENDPOINT);
      this.SYMBOL_NAME_MAPPING = response.data.data.result.reduce((acc, obj) => {
        obj.mappingList.forEach((pairObj) => {
          acc[pairObj.symbol] = pairObj.name;
        });
        return acc;
      }, {});
    }
  }

  subscribe(subscription, callback) {
    this.populateSymbolMap().then(() => {
      const socket = new WebSocket(WEBSOCKET_URI);
      let pingInterval;

      socket.onopen = () => {
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} connection open`);
        subscription.forEach((sub) => {
          socket.send(JSON.stringify(sub));
        });

        pingInterval = setInterval(() => {
          if (socket.readyState === socket.OPEN) {
            const pingMessage = { subscribe: 'ping' };
            socket.send(JSON.stringify(pingMessage));
          }
        }, 5000);
      };

      socket.onmessage = (message) => {
        const payload = pako.inflateRaw(message.data, { to: 'string' });
        if (!payload) {
          console.log('empty payload, skipping...');
          return;
        }
        const payloadObj = JSON.parse(payload);
        callback(payloadObj);
      };

      socket.onclose = () => {
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} connection closed`);
        clearInterval(pingInterval);
      };

      socket.onerror = (error) => {
        console.log(`[correlationId=${this.correlationId}] error with ${EXCHANGE} connection because`, error);

        // reconnect if error
        this.subscribe(subscription, callback);
      };
      return () => { socket.close(); };
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
      const { subscribe, symbol, data } = msg;
      if (subscribe === CHANNEL) {
        // conditional in case bitmart decides to change how they map symbols
        callback(Object.assign(data, { pair: this.SYMBOL_NAME_MAPPING[symbol] ? this.SYMBOL_NAME_MAPPING[symbol] : symbol }));
      }
    });
  }

  subscribeTrades(pairs, callback) {
    const CHANNEL = CHANNELS.TRADE;
    if (!pairs) {
      throw new Error('must provide pairs to subscribe to');
    }
    const subscriptions = pairs.map((pair) => {
      const [base, quote] = pair.split('/');
      return {
        subscribe: CHANNEL,
        symbol: `${base}_${quote}`,
        precision: 0,
        local: 'en_US',
      };
    });

    this.subscribe(subscriptions, (msg) => {
      console.log('msg', JSON.stringify(msg));
      const {
        subscribe, symbol, data, firstSubscribe,
      } = msg;
      if (subscribe === CHANNEL) {
        // conditional in case bitmart decides to change how they map symbols
        callback(Object.assign(data, { firstSubscribe, pair: this.SYMBOL_NAME_MAPPING[symbol] ? this.SYMBOL_NAME_MAPPING[symbol] : symbol }));
      }
    });
  }
}

export default WebsocketClient;

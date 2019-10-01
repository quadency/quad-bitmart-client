'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _ws = require('ws');

var _ws2 = _interopRequireDefault(_ws);

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _pako = require('pako');

var _pako2 = _interopRequireDefault(_pako);

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const WEBSOCKET_URI = 'wss://ws-manager-compress.bitmart.com/';
const MAPPINGS_ENDPOINT = 'https://www.bitmart.com/api/market_trade_mappings_front';
const EXCHANGE = 'BITMART';

class WebsocketClient {
  constructor(correlationId, userConfig = {}) {
    Object.keys(userConfig).forEach(key => {
      this[key] = userConfig[key];
    });
    this.correlationId = correlationId;
    this.SYMBOL_NAME_MAPPING = {};
  }

  populateSymbolMap() {
    var _this = this;

    return _asyncToGenerator(function* () {
      if (!Object.keys(_this.SYMBOL_NAME_MAPPING).length) {
        const response = yield (0, _axios2.default)(MAPPINGS_ENDPOINT);
        _this.SYMBOL_NAME_MAPPING = response.data.data.result.reduce(function (acc, obj) {
          obj.mappingList.forEach(function (pairObj) {
            acc[pairObj.symbol] = pairObj.name;
          });
          return acc;
        }, {});
      }
    })();
  }

  subscribe(subscription, callback) {
    this.populateSymbolMap().then(() => {
      const socket = new _ws2.default(WEBSOCKET_URI);
      let pingInterval;

      socket.onopen = () => {
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} connection open`);
        subscription.forEach(sub => {
          console.log('sub', JSON.stringify(sub));
          socket.send(JSON.stringify(sub));
        });

        pingInterval = setInterval(() => {
          if (socket.readyState === socket.OPEN) {
            const pingMessage = { subscribe: 'ping' };
            socket.send(JSON.stringify(pingMessage));
          }
        }, 5000);
      };

      socket.onmessage = message => {
        const payload = _pako2.default.inflateRaw(message.data, { to: 'string' });
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

      socket.onerror = error => {
        console.log(`[correlationId=${this.correlationId}] error with ${EXCHANGE} connection because`, error);

        // reconnect if error
        this.subscribe(subscription, callback);
      };
      return () => {
        socket.close();
      };
    });
  }

  subscribePrices(pairs, callback) {
    const CHANNEL = _utils.CHANNELS.PRICE;
    if (!pairs) {
      throw new Error('must provide pairs to subscribe to');
    }
    const subscriptions = pairs.map(pair => {
      const [base, quote] = pair.split('/');
      return {
        subscribe: CHANNEL,
        symbol: `${base}_${quote}`,
        local: 'en_US'
      };
    });

    this.subscribe(subscriptions, msg => {
      const { subscribe, symbol, data } = msg;
      if (subscribe === CHANNEL) {
        callback(Object.assign(data, { pair: this.SYMBOL_NAME_MAPPING[symbol] }));
      }
    });
  }
}

exports.default = WebsocketClient;
'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});

var _ws = require('ws');

var _ws2 = _interopRequireDefault(_ws);

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _cryptoJs = require('crypto-js');

var _cryptoJs2 = _interopRequireDefault(_cryptoJs);

var _pako = require('pako');

var _pako2 = _interopRequireDefault(_pako);

var _utils = require('./utils');

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { default: obj }; }

function _asyncToGenerator(fn) { return function () { var gen = fn.apply(this, arguments); return new Promise(function (resolve, reject) { function step(key, arg) { try { var info = gen[key](arg); var value = info.value; } catch (error) { reject(error); return; } if (info.done) { resolve(value); } else { return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); }); } } return step("next"); }); }; }

const WEBSOCKET_URI = 'wss://ws-manager-compress.bitmart.com/';
const MAPPINGS_ENDPOINT = 'https://www.bitmart.com/api/market_trade_mappings_front';
const BASE_URL = 'https://openapi.bitmart.com/v2';
const PRECISIONS_ENDPOINT = `${BASE_URL}/symbols_details`;
const EXCHANGE = 'BITMART';

class WebsocketClient {
  constructor(correlationId, userConfig = {}) {
    Object.keys(userConfig).forEach(key => {
      this[key] = userConfig[key];
    });
    this.correlationId = correlationId;
    this.SYMBOL_NAME_MAP = {};
    this.SYMBOL_PRECISIONS_MAP = {};
    this.socket = null;
    this.accessToken = null;
  }

  login() {
    var _this = this;

    return _asyncToGenerator(function* () {
      if (_this.accessToken) {
        return;
      }
      if (!_this.apiKey || !_this.secret || !_this.apiName) {
        throw new Error('Must provide credentials for authenticated route');
      }
      const message = `${_this.apiKey}:${_this.secret}:${_this.apiName}`;

      const crypt = _cryptoJs2.default.HmacSHA256(message, _this.secret);
      const signature = crypt.toString(_cryptoJs2.default.enc.HEX);

      const options = {
        method: 'POST',
        headers: {
          'content-type': 'application/x-www-form-urlencoded'
        },
        params: {
          grant_type: 'client_credentials',
          client_id: _this.apiKey,
          client_secret: signature
        },
        url: `${BASE_URL}/authentication`
      };

      const response = yield (0, _axios2.default)(options);
      const { access_token: accessToken } = response.data;
      _this.accessToken = accessToken;
    })();
  }

  populateSymbolMap() {
    var _this2 = this;

    return _asyncToGenerator(function* () {
      if (!Object.keys(_this2.SYMBOL_NAME_MAP).length) {
        const response = yield (0, _axios2.default)(MAPPINGS_ENDPOINT);
        _this2.SYMBOL_NAME_MAP = response.data.data.result.reduce(function (acc, obj) {
          obj.mappingList.forEach(function (pairObj) {
            acc[pairObj.symbol] = pairObj.name;
          });
          return acc;
        }, {});
      }
    })();
  }

  populatePrecisionsMapping() {
    var _this3 = this;

    return _asyncToGenerator(function* () {
      if (!Object.keys(_this3.SYMBOL_PRECISIONS_MAP).length) {
        const response = yield (0, _axios2.default)(PRECISIONS_ENDPOINT);
        _this3.SYMBOL_PRECISIONS_MAP = response.data.reduce(function (acc, obj) {
          acc[obj.id] = obj.price_max_precision;
          return acc;
        }, {});
      }
    })();
  }

  addToSubscription(subscription) {
    if (this.socket && this.socket.readyState === this.socket.OPEN) {
      subscription.forEach(sub => {
        this.socket.send(JSON.stringify(sub));
      });
      return;
    }
    console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} cannot add to subscription, connection not open`);
  }

  subscribe(subscription, callback) {
    this.populateSymbolMap().then(() => {
      this.socket = new _ws2.default(WEBSOCKET_URI);

      let pingInterval;

      this.socket.onopen = () => {
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} connection open`);
        subscription.forEach(sub => {
          this.socket.send(JSON.stringify(sub));
        });

        pingInterval = setInterval(() => {
          if (this.socket && this.socket.readyState === this.socket.OPEN) {
            const pingMessage = { subscribe: 'ping' };
            this.socket.send(JSON.stringify(pingMessage));
          }
        }, 5000);
      };

      this.socket.onmessage = message => {
        const payload = _pako2.default.inflateRaw(message.data, { to: 'string' });
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

      this.socket.onerror = error => {
        console.log(`[correlationId=${this.correlationId}] error with ${EXCHANGE} connection because`, error);

        // reconnect if error
        this.subscribe(subscription, callback);
      };
      return () => {
        this.socket.close();
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
      const {
        subscribe, symbol, data: tick, code
      } = msg;
      if (subscribe === CHANNEL && code === _utils.WEBSOCKET_CODES.SUCCESS) {
        // conditional in case bitmart decides to change how they map symbols
        callback(Object.assign(tick, { pair: this.SYMBOL_NAME_MAP[symbol] ? this.SYMBOL_NAME_MAP[symbol] : symbol }));
        return;
      }
      console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} subscription error: ${_utils.WEBSOCKET_STATUS[code]}`);
    });
  }

  addToTradeSubscription(pairs) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = _utils.CHANNELS.TRADE;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }
      const subscriptions = pairs.map(pair => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US'
        };
      });
      this.addToSubscription(subscriptions);
    });
  }

  subscribeTrades(pairs, callback) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = _utils.CHANNELS.TRADE;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }
      const subscriptions = pairs.map(pair => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US'
        };
      });

      this.subscribe(subscriptions, msg => {
        const {
          subscribe, symbol, data: trades, firstSubscribe, code
        } = msg;
        if (subscribe === CHANNEL && code === _utils.WEBSOCKET_CODES.SUCCESS) {
          // conditional in case bitmart decides to change how they map symbols
          callback(Object.assign(trades, {
            firstSubscribe,
            pair: this.SYMBOL_NAME_MAP[symbol] ? this.SYMBOL_NAME_MAP[symbol] : symbol
          }));
          return;
        }
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} subscription error: ${_utils.WEBSOCKET_STATUS[code]}`);
      });
    });
  }

  addToOrdersSubscription(pairs) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = _utils.CHANNELS.ORDER;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }
      const subscriptions = pairs.map(pair => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US'
        };
      });
      this.addToSubscription(subscriptions);
    });
  }

  subscribeOrders(pairs, callback) {
    this.populatePrecisionsMapping().then(() => {
      const CHANNEL = _utils.CHANNELS.ORDER;
      if (!pairs) {
        throw new Error('must provide pairs to subscribe to');
      }

      const subscriptions = pairs.map(pair => {
        const [base, quote] = pair.split('/');
        return {
          subscribe: CHANNEL,
          symbol: `${base}_${quote}`,
          precision: this.SYMBOL_PRECISIONS_MAP[`${base}_${quote}`],
          local: 'en_US'
        };
      });

      this.subscribe(subscriptions, msg => {
        const {
          subscribe, symbol, data: orders, code
        } = msg;
        if (subscribe === CHANNEL && code === _utils.WEBSOCKET_CODES.SUCCESS) {
          // conditional in case bitmart decides to change how they map symbols
          callback(Object.assign(orders, { pair: this.SYMBOL_NAME_MAP[symbol] ? this.SYMBOL_NAME_MAP[symbol] : symbol }));
          return;
        }
        console.log(`[correlationId=${this.correlationId}] ${EXCHANGE} subscription error: ${_utils.WEBSOCKET_STATUS[code]}`);
      });
    });
  }

  subscribeNotify(callback) {
    this.login().then(() => {
      const subscription = { subscribe: 'notify', token: this.accessToken };
      this.subscribe([subscription], msg => {
        callback(msg);
      });
    });
  }

  subscribeUserOrders(pairs, callback) {
    this.login().then(() => {
      const args = pairs.map(pair => `spot/order:${pair.replace('/', '_')}`);
      const subscription = { op: 'subscribe', token: this.accessToken, args };
      this.subscribe([subscription], msg => {
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

exports.default = WebsocketClient;
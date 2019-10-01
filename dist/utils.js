'use strict';

Object.defineProperty(exports, "__esModule", {
  value: true
});
const COMMON_CURRENCIES = { // gets extended/overwritten in subclasses
  XBT: 'BTC',
  BCC: 'BCH',
  DRK: 'DASH',
  BCHABC: 'BCH',
  BCHSV: 'BSV'
};
const CHANNELS = {
  PRICE: 'price',
  TRADE: 'trade'
};

exports.COMMON_CURRENCIES = COMMON_CURRENCIES;
exports.CHANNELS = CHANNELS;
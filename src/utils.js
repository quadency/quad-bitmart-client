const COMMON_CURRENCIES = { // gets extended/overwritten in subclasses
  XBT: 'BTC',
  BCC: 'BCH',
  DRK: 'DASH',
  BCHABC: 'BCH',
  BCHSV: 'BSV',
};
const CHANNELS = {
  PRICE: 'price',
  TRADE: 'trade',
  ORDER: 'depth',
};

const WEBSOCKET_CODES = {
  SUCCESS: 0,
  ERROR: -1,
  PARAMETER_MISSING: -8101,
  PARAMETER_ERROR: -8102,
  TOPIC_ERROR: -8103,
};

const WEBSOCKET_STATUS = {
  0: 'Success',
  [-1]: 'Error',
  [-8101]: 'Parameter missing',
  [-8102]: 'Parameter error',
  [-8103]: 'Topic error',
};


export {
  COMMON_CURRENCIES, CHANNELS, WEBSOCKET_CODES, WEBSOCKET_STATUS,
};

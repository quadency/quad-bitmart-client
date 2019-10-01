import WebsocketClient from './bitmart-ws';


async function main() {
  const client = new WebsocketClient('correlationId123');

  client.subscribePrices(['BTC/USDT'], (msg) => {
    console.log('callll', msg);
  });

}

main().then(() => {});

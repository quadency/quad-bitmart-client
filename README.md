# quad-bitmart-client

Client to allow easier access to Bitmart's websocket api.


## Websocket Example

```
import okex from 'quad-bitmart-client';

// For authenticated endpoints, provide object of credentials.  
// This is not required for public rest endpoints
const exchangeClient = new bitmart.WebsocketClient({
  apiKey: 'your api key',
  secret: 'your secret',
});

exchangeClient.subscribeBalance((balanceUpdate)=>{
  console.log('My balance update:', balanceUpdate);
});

```

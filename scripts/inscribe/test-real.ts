/**
 * Real test with actual wallet
 */

import * as bitcore from 'bitcore-lib-zcash';

// Get address from private key
const privateKeyWIF = 'L4uKvbvx2RiPNvi45eimSLuA1HzFrjzZYqr5Ww1J29x9porfF17z';
const privateKey = bitcore.PrivateKey.fromWIF(privateKeyWIF);
const address = privateKey.toAddress().toString();

console.log('Address from private key:', address);

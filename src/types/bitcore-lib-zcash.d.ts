declare module 'bitcore-lib-zcash' {
  export class Transaction {
    constructor(serialized?: string);
    from(utxo: {
      txId: string;
      outputIndex: number;
      satoshis: number;
      script: string | any;
    }): Transaction;
    to(address: string, satoshis: number): Transaction;
    addOutput(output: any): Transaction;
    sign(privateKey: PrivateKey): Transaction;
    serialize(): string;
    uncheckedSerialize(): string;
    static Output: any;
  }

  export class PrivateKey {
    constructor(wif?: string);
    static fromWIF(wif: string): PrivateKey;
    toWIF(): string;
  }

  export class Address {
    constructor(address: string);
    static fromString(address: string): Address;
    toString(): string;
  }

  export class Script {
    static buildPublicKeyHashOut(address: Address): Script;
    static buildDataOut(data: Buffer): Script;
    toHex(): string;
  }

  export = bitcore;
  namespace bitcore {
    export { Transaction, PrivateKey, Address, Script };
  }
}

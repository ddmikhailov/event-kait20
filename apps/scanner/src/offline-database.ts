import Dexie from 'dexie';

export class ScannerDatabase extends Dexie {
  public constructor() {
    super('event-registration-scanner');
  }
}

export const scannerDatabase = new ScannerDatabase();

import { parseWorkerEnvironment } from '@event-registration/config';

import { getWorkerStatus } from './status.js';

parseWorkerEnvironment(process.env);
process.stdout.write(`${JSON.stringify(getWorkerStatus())}\n`);

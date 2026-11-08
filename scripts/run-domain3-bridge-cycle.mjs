// Child-process entry for one Domain 3 detection/bridge cycle.
//
// The replay loads the full observation window (100k rows with
// payloads) into memory. Running the cycle in a child process
// keeps that heap out of the long-lived web service: when this
// process exits, the OS reclaims all of it. The scheduler spawns
// this script and reads exactly one receipt line from stdout:
//   BRIDGE_CYCLE_RESULT {"ok":true,"result":{...}}
// (src/services/scheduler.js, runDomain3Bridge.)
import dotenv from 'dotenv';
import { runLiveDataSignalBridge } from '../src/services/liveDataSignalBridgeService.js';

dotenv.config();

try {
  const result = await runLiveDataSignalBridge(process.env);
  console.log(`BRIDGE_CYCLE_RESULT ${JSON.stringify({ ok: true, result })}`);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.log(`BRIDGE_CYCLE_RESULT ${JSON.stringify({ ok: false, error: message })}`);
  process.exitCode = 1;
}

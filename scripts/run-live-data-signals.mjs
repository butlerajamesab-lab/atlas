import dotenv from 'dotenv';
import { runLiveDataSignalBridge } from '../src/services/liveDataSignalBridgeService.js';

dotenv.config();

try {
  const result = await runLiveDataSignalBridge(process.env);
  console.log(JSON.stringify({ ok: true, result }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  }, null, 2));
  process.exitCode = 1;
}
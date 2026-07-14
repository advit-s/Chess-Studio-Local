import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { parentPort, workerData } from 'node:worker_threads';
import { pathToFileURL } from 'node:url';

if (!parentPort) throw new Error('The OCR Node wrapper must run inside a worker thread.');

globalThis.self = globalThis;
self.document = {
  createElement: () => ({ getContext: () => null }),
};
self.location = { href: `${workerData.baseUrl}/scanWorker.js` };
self.postMessage = (message, transfer = []) => parentPort.postMessage(message, transfer);
self.importScripts = (...urls) => {
  for (const url of urls) {
    const scriptPath = path.resolve(path.dirname(workerData.scanWorkerPath), url);
    const source = workerData.scriptSources?.[scriptPath];
    if (typeof source !== 'string') {
      throw new Error(`Node OCR wrapper did not preload importScripts asset: ${scriptPath}`);
    }
    vm.runInThisContext(source, { filename: scriptPath });
  }
};

const tfScriptPath = path.resolve(path.dirname(workerData.scanWorkerPath), 'tf.min.js');
workerData.scriptSources = {
  [tfScriptPath]: await readFile(tfScriptPath, 'utf8'),
};

await import(pathToFileURL(workerData.scanWorkerPath).href);

parentPort.on('message', (data) => {
  Promise.resolve(self.onmessage?.({ data })).catch((error) => {
    parentPort.postMessage({
      requestId: data?.requestId,
      status: 'error',
      action: data?.action,
      message: error instanceof Error ? error.message : String(error),
    });
  });
});

parentPort.postMessage({ status: 'ready' });

import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.join(projectRoot, 'dist');
const preferredPort = Number(process.env.PORT || process.argv[2] || 8080);

if (!existsSync(path.join(root, 'index.html'))) {
  throw new Error('The production build is missing. Run npm run build first.');
}

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.wasm', 'application/wasm'],
  ['.webmanifest', 'application/manifest+json; charset=utf-8'],
]);

const server = createServer(async (request, response) => {
  try {
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    const decoded = decodeURIComponent(requestUrl.pathname);
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    let target = path.resolve(root, relative);
    if (target !== root && !target.startsWith(root + path.sep)) {
      response.writeHead(403).end('Forbidden');
      return;
    }

    let info;
    try {
      info = await stat(target);
    } catch {
      const acceptsHtml = (request.headers.accept || '').includes('text/html');
      if (!acceptsHtml || path.extname(relative)) {
        response.writeHead(404).end('Not found');
        return;
      }
      target = path.join(root, 'index.html');
      info = await stat(target);
    }
    if (info.isDirectory()) {
      target = path.join(target, 'index.html');
      info = await stat(target);
    }

    const extension = path.extname(target).toLowerCase();
    const basename = path.basename(target);
    const immutable = target.includes(path.sep + 'assets' + path.sep);
    response.writeHead(200, {
      'Content-Type': contentTypes.get(extension) || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': immutable
        ? 'public, max-age=31536000, immutable'
        : basename === 'index.html' || basename === 'sw.js'
          ? 'no-store'
          : 'no-cache',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(target).pipe(response);
  } catch (error) {
    console.error(error);
    response.writeHead(500).end('Local server error');
  }
});

async function listen() {
  for (let port = preferredPort; port < preferredPort + 10; port += 1) {
    const result = await new Promise((resolve) => {
      const onError = () => {
        server.off('listening', onListening);
        resolve(false);
      };
      const onListening = () => {
        server.off('error', onError);
        resolve(true);
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen(port, '127.0.0.1');
    });
    if (result) return port;
  }
  throw new Error('No free local port was found between ' + preferredPort + ' and ' + (preferredPort + 9) + '.');
}

function openInBrowser(url) {
  if (process.env.CHESS_STUDIO_NO_OPEN === '1') return;
  if (process.platform === 'win32') {
    const candidates = [
      process.env.PROGRAMFILES && path.join(process.env.PROGRAMFILES, 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env['PROGRAMFILES(X86)'] && path.join(process.env['PROGRAMFILES(X86)'], 'Google', 'Chrome', 'Application', 'chrome.exe'),
      process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    ].filter(Boolean);
    const chrome = candidates.find((candidate) => existsSync(candidate));
    if (chrome) spawn(chrome, [url], { detached: true, stdio: 'ignore' }).unref();
    else spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    return;
  }
  const command = process.platform === 'darwin' ? 'open' : 'xdg-open';
  spawn(command, [url], { detached: true, stdio: 'ignore' }).unref();
}

const port = await listen();
const url = 'http://127.0.0.1:' + port + '/';
console.log('Chess Studio Local is running at ' + url);
console.log('Keep this window open. Press Ctrl+C to stop the app.');
openInBrowser(url);

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

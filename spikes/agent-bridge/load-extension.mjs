const [, , portText, extensionPath] = process.argv;

if (!portText || !extensionPath) {
  console.error('usage: node load-extension.mjs <debugging-port> <extension-path>');
  process.exit(2);
}

const port = Number.parseInt(portText, 10);
if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error('invalid debugging port: ' + portText);
  process.exit(2);
}

const versionResponse = await fetch('http://127.0.0.1:' + port + '/json/version');
if (!versionResponse.ok) {
  throw new Error('Chrome DevTools discovery failed: HTTP ' + versionResponse.status);
}

const versionPayload = await versionResponse.json();
const debuggerUrl = versionPayload?.webSocketDebuggerUrl;
if (typeof debuggerUrl !== 'string') {
  throw new Error('Chrome DevTools discovery returned no WebSocket URL');
}

const socket = new WebSocket(debuggerUrl);
const result = await new Promise((resolve, reject) => {
  const timeout = setTimeout(() => {
    socket.close();
    reject(new Error('Extensions.loadUnpacked timed out'));
  }, 15_000);

  socket.addEventListener('open', () => {
    socket.send(JSON.stringify({
      id: 1,
      method: 'Extensions.loadUnpacked',
      params: { path: extensionPath },
    }));
  });

  socket.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(String(event.data));
    } catch {
      return;
    }
    if (message?.id !== 1) return;
    clearTimeout(timeout);
    socket.close();
    if (message.error) {
      reject(new Error('Extensions.loadUnpacked failed: ' + message.error.message));
      return;
    }
    resolve(message.result);
  });

  socket.addEventListener('error', () => {
    clearTimeout(timeout);
    reject(new Error('Chrome DevTools WebSocket failed'));
  });
});

console.log(JSON.stringify(result));

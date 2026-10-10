// Optional desktop shell. Starts the local API server as a child process (Electron's own Node runtime)
// and shows the app in a window. Data lives in the OS user-data folder, so it survives updates.
import { app, BrowserWindow, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import http from 'node:http';

const PORT = Number(process.env.PORT || 3917);
let server: ChildProcess | null = null;

function waitForServer(retries = 60): Promise<void> {
  return new Promise((resolve, reject) => {
    const tryOnce = (n: number) => {
      http.get({ host: '127.0.0.1', port: PORT, path: '/api/auth/status' }, (res) => { res.resume(); resolve(); })
        .on('error', () => (n <= 0 ? reject(new Error('Server did not start')) : setTimeout(() => tryOnce(n - 1), 250)));
    };
    tryOnce(retries);
  });
}

function startServer() {
  const root = app.isPackaged ? path.join(process.resourcesPath, 'app') : path.resolve(__dirname, '..');
  server = spawn(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), path.join(root, 'server.ts')], {
    cwd: root,
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PORT: String(PORT), HOST: '127.0.0.1', PHARMACY_DATA_DIR: app.getPath('userData') },
    stdio: 'inherit',
  });
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1366, height: 768, autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  await waitForServer();
  await win.loadURL(`http://127.0.0.1:${PORT}`);
}

app.whenReady().then(() => { startServer(); createWindow(); });
app.on('window-all-closed', () => { server?.kill(); app.quit(); });
app.on('before-quit', () => server?.kill());

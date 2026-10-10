// electron-builder configuration. Build with: npm run electron:build
module.exports = {
  appId: 'com.pharmacy.pos',
  productName: 'Pharmacy POS',
  directories: { output: 'release' },
  files: ['dist/**', 'dist-electron/**', 'server.ts', 'src/db/**', 'src/server/**', 'src/types/**', 'package.json', 'node_modules/**'],
  extraResources: [],
  npmRebuild: true, // rebuilds better-sqlite3 for Electron's Node ABI
  win: { target: 'nsis' },
  mac: { target: 'dmg' },
  linux: { target: 'AppImage' },
};

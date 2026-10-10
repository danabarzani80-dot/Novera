// Secure bridge: the renderer gets only these whitelisted, read-only values (no Node access).
import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  platform: process.platform,
});

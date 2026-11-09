// Roda o robô em segundo plano para a tela não travar enquanto ele pensa.
import { chooseAction } from './ai.js';

self.onmessage = e => {
  const { id, state, me, level } = e.data;
  let action = null;
  try { action = chooseAction(state, me, level); } catch (err) { console.error(err); }
  self.postMessage({ id, action });
};

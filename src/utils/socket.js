import { io } from 'socket.io-client';

const socket = io('https://laudofy-backend-production.up.railway.app', {
  autoConnect: false,
  withCredentials: true, // 👈 ESSENCIAL pra sessão/cookie funcionar
  transports: ['websocket'] // 👌 evita fallback zuado com polling
});

export default socket;

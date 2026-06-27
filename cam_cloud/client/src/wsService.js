import { WS_URL } from './config.js';

export const wsState = {
  instance: null,
  pingInterval: null,
  deviceID: null,

  open(token, onMessageCallback) {
    this.cleanup();
    this.instance = new WebSocket(`${WS_URL}?token=${token}`);
    
    this.instance.addEventListener('message', onMessageCallback);
    this.instance.onopen = () => {
      this.send({ type: "init_conn", role: "client", device: "node_server" });
      this.pingInterval = setInterval(() => this.send({ type: "ping" }), 30000);
    };
    this.instance.onclose = (event) => {
      console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
      cleanup();
    };
    this.instance.onerror = (error) => {
      console.error("WebSocket error observed:", error);
    };
  },

  send(dataObj) {
    if (this.instance && this.instance.readyState === WebSocket.OPEN) {
      this.instance.send(JSON.stringify(dataObj));
    }
  },

  cleanup() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.instance) {
      if (this.instance.readyState <= 1) this.instance.close();
      this.instance = null;
    }
  }
};
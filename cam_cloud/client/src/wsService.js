import { WS_URL } from '../config.js';

export const wsService = {
  instance: null,
  pingInterval: null,
  reconnectTimeout: null,
  onMessageCallback: null,

  open(onMessageReceived) {

    this.onMessageCallback = onMessageReceived;

    this.clearTimers();

    this.instance = new WebSocket(`${WS_URL}`);
    if (this.onMessageCallback) {
      this.instance.addEventListener('message', this.onMessageCallback);
    }
    
    this.instance.onopen = () => {
      console.log("Connected to server");
      this.send({
        type: "init_conn",
        role: "client",
        device: "node_server",
      });
      
      // Start keep-alive ping loop
      this.pingInterval = setInterval(() => {
        this.send({ type: "ping" });
      }, 30000);
      
    };
    
    this.instance.onerror = (error) => {
      console.error("WebSocket error observed:", error);
    };
    
    this.instance.onclose = (event) => {
      console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
      this.cleanupAndScheduleReconnect();
    };

    return this.instance;
  },

  send(dataObj) {
    if (this.instance && this.instance.readyState === WebSocket.OPEN) {
      this.instance.send(JSON.stringify(dataObj));
    }
  },

  clearTimers() {
    if (this.pingInterval) clearInterval(this.pingInterval);
    if (this.reconnectTimeout) clearTimeout(this.reconnectTimeout);
    this.pingInterval = null;
    this.reconnectTimeout = null;
  },

  async cleanupAndScheduleReconnect() {
    if (!this.instance) return;
    this.clearTimers();

    if (this.instance) {
      // Detach listeners so they don't fire during termination
      if (this.onMessageCallback) {
        this.instance.removeEventListener('message', this.onMessageCallback);
      }
      this.instance.onopen = null;
      this.instance.onclose = null;
      this.instance.onerror = null;

      if (this.instance.readyState <= 1) {
        this.instance.close();
      }
      this.instance = null;
      console.log("WebSocket reference cleaned up.");
    }
    try {
      const response = await fetch('auth_status');
      if (!response.ok) {
        const forceLogout = new CustomEvent("forceLogout");
        window.dispatchEvent(forceLogout);
        return;
      }
  
      if (!this.instance) {
        console.log("Scheduling reconnect in 5 seconds...");
        this.reconnectTimeout = setTimeout(() => {
          this.open(this.onMessageCallback);
        }, 5000);
      }
    } catch (err) {

      console.error("Auth status check failed (Server offline?). Retrying connection...", err);
      
      this.reconnectTimeout = setTimeout(() => {
        this.open(this.onMessageCallback);
      }, 5000);
    }
  },
};
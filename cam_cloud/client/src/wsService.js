// src/services/wsService.js
import { WS_URL } from '../config.js';

export const wsService = {
  instance: null,
  pingInterval: null,
  reconnectTimeout: null,
  currentToken: null,
  onMessageCallback: null,

  open(token, onMessageReceived) {
    if (!token) {
      console.warn("WebSocket connection aborted: No valid token provided.");
      return;
    }

    // Save references for potential automatic reconnections
    this.currentToken = token;
    this.onMessageCallback = onMessageReceived;

    // Clear any pending triggers
    this.clearTimers();

    this.instance = new WebSocket(`${WS_URL}?token=${token}`);

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

    // Notice we use arrow functions here so 'this' still points to wsService!
    this.instance.onclose = (event) => {
      console.log(`WebSocket closed. Code: ${event.code}, Reason: ${event.reason}`);
      this.cleanupAndScheduleReconnect();
    };

    this.instance.onerror = (error) => {
      console.error("WebSocket error observed:", error);
      this.cleanupAndScheduleReconnect();
    };
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

  cleanupAndScheduleReconnect() {

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

    // Attempt reconnection using the saved parameters
    if (this.currentToken) {
      console.log("Scheduling reconnect in 5 seconds...");
      this.reconnectTimeout = setTimeout(() => {
        this.open(this.currentToken, this.onMessageCallback);
      }, 5000);
    } else {
      console.log("Reconnect aborted: No active session token found.");
    }
  },
  
  // Force a manual logout/disconnect
  disconnect() {
    this.currentToken = null; // Clear token so it doesn't auto-reconnect
    this.cleanupAndScheduleReconnect();
  }
};
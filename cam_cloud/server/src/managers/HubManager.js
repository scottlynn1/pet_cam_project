export class HubManager {
  constructor(clientmanager = null, streammanager = null) {
    this.hubs = {};
    this.clientmanager = clientmanager;
    this.streammanager = streammanager;
  }

  add_socket(socket, hubID, devices) {
    console.log(`registering hub: ${hubID}`)
    this.hubs[hubID] = {
      devices: devices,
      socket
    }
    socket.on("message", (message) => {
      const msg = JSON.parse(message);
      console.log(`Message of type: ${msg.type} recieved from hub: ${hubID}`)
      if (msg.type == "sync_data") {
        if (this.hubs[msg.hubID]) {
          this.hubs[msg.hubID].devices = msg.devices
          console.log(`Devices: ${msg.devices} registerd to hub: ${hubID}`)
        }
      }
      if (msg.type == "confirmation") {
        console.log(msg.clientID)
        const clientSocket = this.clientmanager.clientsockets[msg.clientID];
        if (clientSocket && clientSocket.readyState === WebSocket.OPEN) {
          clientSocket.send(JSON.stringify(msg));
        }
      }

    })
    socket.on('close', () => {
      console.log(`unregistering hub: ${hubID}`)
    // Kill any streams associated with this specific hub
      for (const streamKey in this.streammanager.runningstreams) {
        if (streamKey.startsWith(`${hubID}/`)) {
          const stream = this.streammanager.runningstreams[streamKey];
          
          // Close all browser connections for this stream
          stream.viewers.forEach(res => {
            if (!res.writableEnded) res.end();
          });

          // Close the hub-to-node stream socket
          if (stream.streamSocket.readyState === 1) stream.streamSocket.close();
          
          delete this.streammanager.runningstreams[streamKey];
        }
      }
	    delete this.hubs[hubID];
    })
  }
}
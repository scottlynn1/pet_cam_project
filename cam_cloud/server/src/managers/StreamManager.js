export class StreamManager {
  constructor(hubmanager) {
    this.runningstreams = {};
    this.hubmanager = hubmanager;
    this.pendingstreams = {};
    this.timeoutMs = 5000;
    // need to add an initialingstreams logic to avoid race conditions
  }

  async sendErrorFrame(res, buffer) {
    if (res.writableEnded) return;
    res.write(`--frame\r\n`);
    res.write(`Content-Type: image/jpeg\r\n`);
    res.write(`Content-Length: ${buffer.length}\r\n\r\n`);
    res.write(buffer);
    res.write(`\r\n`);
    setTimeout(() => res.end(), 100);
  }
  
  async add_viewer(res, hubID, deviceID, clientID) {
    console.log(`Client: ${clientID} connecting to stream: ${deviceID} on hub: ${hubID}`);
    let stream = `${hubID}/${deviceID}`
    if (!Object.hasOwn(this.runningstreams, stream)) {
      await this.start_stream(res, hubID, deviceID, clientID)
    } else {
      this.runningstreams[stream].viewers.add(res)
      console.log(`client: ${clientID} added to stream: ${deviceID} on hub: ${hubID}`)
    }
  }
    
  async start_stream(res, hubID, deviceID, clientID) {
    let stream = `${hubID}/${deviceID}`
    let timer;
    let requestId;
    //checking again if stream initiated by another client to avoid race conditions and duplicate streams
    try {
      if (this.runningstreams[stream]) {
        this.runningstreams[stream].viewers.add(res);
        console.log(`client: ${clientID} added to stream: ${deviceID} on hub: ${hubID}`)
        return; 
      }
      if (!this.hubmanager.hubs[hubID]) {
        throw new Error("HUB_OFFLINE");
      }        
      //set up promise that resolves after message is sent to hub to open up a ws
      const { promise, resolve, reject } = Promise.withResolvers();
      requestId = `${clientID}-${Date.now()}`
      this.pendingstreams[requestId] = resolve
      // time out if ws connection takes too long
      timer = setTimeout(() => {
        delete this.pendingstreams[requestId];
        reject(new Error ("HUB_TIMEOUT"));
      }, this.timeoutMs);
      console.log(`opening back channel ws with hub: ${hubID} for stream: ${deviceID}`)
      this.hubmanager.hubs[hubID].socket.send(JSON.stringify({ type: 'init_stream', role: "node_server", device: deviceID, socket_id: requestId}))
      let ws = await promise
      this.runningstreams[stream] = { streamSocket: ws, viewers: new Set([res]) }

      // set up listener that sends jpeg frames to clients res objects that are subscribed to stream 
      ws.on("message", (message) => {
        let clients = this.runningstreams[stream]?.viewers || [];
        for (let client of clients) {
          if (client.writableEnded) {
            clients.delete(client);
            continue;
          }

          if (client.isBackedUp) {
            continue; // skip sending completely
          }

          const ok = client.write(message);

          if (!ok) {
            client.isBackedUp = true;
            console.log("Backpressure detected, purging buffer")
            client.once("drain", () => {
              client.isBackedUp = false;
              console.log("client recovered");
            });
          }
        }
      });
      // close stream for all clients on close initiated from hub
      ws.on("close", async () => {
        ws.removeAllListeners("message");
        let clients = this.runningstreams[stream]?.viewers || new Set();
        for (let client of clients) { 
          await this.sendErrorFrame(client, errorBuffer)
          if (client.writableEnded) return; 
          client.end();
        }
        console.log(`removing stream: ${stream} from running streams`)
        delete this.runningstreams[stream];
        console.log(`ws pipe closed by hub: ${hubID}`)
        ws.removeAllListeners("close");
      });

    } catch (err) {
      
      // Determine which image to send
      let img = errorBuffer;
      if (err.message === "HUB_TIMEOUT") img = timeoutBuffer;
      if (err.message === "HUB_OFFLINE") img = offlineBuffer;
      console.error(`Stream error: ${err.message}`);
      
      await this.sendErrorFrame(res, img);
    } finally {
      clearTimeout(timer);
      delete this.pendingstreams[requestId];
    }
  }

  remove_viewer(res, hubID, deviceID, clientID) {
    console.log(`Client: ${clientID} disconnecting from stream: ${deviceID} on hub: ${hubID}`)
    let stream = `${hubID}/${deviceID}`
    const runningstream = this.runningstreams[stream]
    if (!runningstream) {
      console.log("no runningstream to disconnect from")
      return
    }
    runningstream.viewers.delete(res);
    if (!runningstream.viewers.size) {
      console.log(`Stoping stream`)
      runningstream.streamSocket.close()
      delete this.runningstreams[stream]
    }
  }
}  
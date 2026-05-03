export class ClientManager {
  constructor(hubmanager) {
    this.clientsockets = {};
    this.hubmanager = hubmanager
  }
  add_client(ws, hubID, clientID) {
    console.log(`adding client:\n  hubID: ${hubID}\n  clientID: ${clientID}`)
    this.clientsockets[clientID] = ws;
    ws.on("message", (message) => {
      const msg = JSON.parse(message);
      if (msg.type === "servo_cmd" || msg.type == "laser_cmd") {
	      console.log(`Message recieved on client socket with clientID: ${clientID}\n  ${msg}`)
        const pyserver = this.hubmanager.hubs[hubID]?.socket
        if (pyserver) {
          msg["clientID"] = clientID
          pyserver.send(JSON.stringify(msg));
          console.log(`message relayed to hub: ${hubID}`)
        } else {
          console.error(`camera hub: ${hubID} is offline`)
          ws.send(JSON.stringify({ type: "error", data: "camera hub offline" }))
        }
      }
    }) 
    ws.on("close", () => {
      const pyserver = this.hubmanager.hubs[hubID]?.socket
      // remove client_user from devices associated with hubID
      if (pyserver) {
        for (let device of this.hubmanager.hubs[hubID].devices) {
          pyserver.send(JSON.stringify({ type: "laser_cmd", role: "client", data: "off", device, hubID: hubID, clientID}));
          console.log("laser off sent from cloud backend")
        }
      }
      delete this.clientsockets[clientID];
      console.log(`client ws connection with client ID: ${clientID}`)
    })
  }
}
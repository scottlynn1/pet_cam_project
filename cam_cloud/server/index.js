const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 3000 });

let pyserver = null

wss.on('connection', (ws) => {
  console.log('Client connected')
  
  ws.on('message', (message) => {
    let msg = JSON.parse(message)
    console.log('Received of type', msg.type);

    if (msg.type === "init") {
      if (msg.role === "python") {
        if (pyserver) {
          console.log('pyserver already connected')
          ws.send(JSON.stringify({ type: 'error', server: 'node-01' }))
          return
        } else {
          pyserver = ws
          console.log("Python registered");
          ws.send(JSON.stringify({ type: 'welcome', server: 'node-01'}));
        }
      } else {
        console.log("frontend connected")
        ws.send(JSON.stringify({ type: 'welcome', server: 'node-01'}))
      }
      return
    }

    if (msg.type === "data-point") {
      let msg = JSON.parse(message)
      console.log('Received data-point', msg.data);
      if (!pyserver) {
        console.log('no pyserver connection to relay to')
      } else {
        pyserver.send(JSON.stringify({ data: msg.data}));
      }
    }
  })
})
// const io = require('socket.io')(3000, {
//   cors : {
//     origins : ['http://localhost:5173']
//   }
// })
// io.on('connection', socket => {
//   console.log(socket)
//   socket.on('custom-event', (data) => {
//     console.log(data)
//   })
// })

console.log("Index.js started");

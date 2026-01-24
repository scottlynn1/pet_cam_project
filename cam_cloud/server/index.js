const io = require('socket.io')(3000, {
  cors : {
    origins : ['http://localhost:5173']
  }
})

io.on('connection', socket => {
  console.log(socket)
  socket.on('custom-event', (data) => {
    console.log(data)
  })
})

console.log("Index.js started");

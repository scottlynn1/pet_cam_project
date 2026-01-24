const ws = new WebSocket ("ws://localhost:3000");
const control = document.getElementById("control");

ws.onopen = () => {
  console.log("connected to server")

  ws.send(JSON.stringify({
    type: "init",
    severId: "frontend-01",
    role: "browser-client"
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(raw);
  console.log(msg)
}

control.addEventListener("touchstart", e => {
  e.preventDefault();
  console.log(e.touches[0].clientX);
  console.log(e.touches[0].clientY);
})
control.addEventListener("touchmove", e => {
  e.preventDefault();
  [...e.touches].forEach(touch => {
    ws.send(JSON.stringify({ type: "data-point", data: touch.clientX }))
    ws.send(JSON.stringify({ type: "data-point", data: touch.clientX }))
    // socket.emit('custom-event', touch.clientX)
    // socket.emit('custom-event', touch.clientY)
  })
})
control.addEventListener("touchend", (e) => {
  e.preventDefault();
  console.log(e.touches[0].clientX);
  console.log(e.touches[0].clientY);
})
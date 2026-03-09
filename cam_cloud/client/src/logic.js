const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const url = import.meta.env.PROD ? `${protocol}://${window.location.host}/ws` : `${protocol}://${window.location.hostname}:3000`
const ws = new WebSocket (url);
ws.onopen = () => {
  console.log("connected to server")
  ws.send(JSON.stringify({
    type: "init_conn",
    role: "client",
    target: "node_server"
  }))
  //load connected cameras with streamId's
};

let streamId;
const container = document.getElementById("container");
const control = document.getElementById("control");
const displayButton = document.getElementById("camselect");
const feedstopButton = document.getElementById("feedstop");
const feedframe = document.createElement("img");

displayButton.addEventListener("click", () => {
  console.log("event-triggered")
  streamId = 1;
  feedframe.style.width = "100px";
  feedframe.style.height = "100px";
  feedframe.setAttribute("src", `${location.protocol}//${window.location.host}/stream?streamId=1`)
  container.appendChild(feedframe);
})
feedstopButton.addEventListener("click", () => {
  feedframe.remove();
})

// ws.onmessage = (event) => {
//   const msg = JSON.parse(event.data);
//   console.log(msg)
// }

control.addEventListener("touchstart", e => {
  e.preventDefault();
  ws.send(JSON.stringify({ type: "servo_cmd", role: "client", data: { x: e.touches[0].clientX, y: e.touches[0].clientY}, target: streamId}))
  console.log(e.touches[0].clientX);
  console.log(e.touches[0].clientY);
})

control.addEventListener("touchmove", e => {
  e.preventDefault();
  [...e.touches].forEach(touch => {
    ws.send(JSON.stringify({ type: "servo_cmd", role: "client", data: { x: touch.clientX, y: touch.clientY}, target: streamId}))
    console.log(touch.clientX)
    console.log(touch.clientX)
  })
})

control.addEventListener("touchend", (e) => {
  e.preventDefault();
  ws.send(JSON.stringify({ type: "servo_cmd", role: "client", data: { x: e.touches[0].clientX, y: e.touches[0].clientY}, target: streamId}))
  console.log(e.touches[0].clientX);
  console.log(e.touches[0].clientY);
})
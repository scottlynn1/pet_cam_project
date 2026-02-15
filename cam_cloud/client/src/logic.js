const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
const url = import.meta.env.PROD ? `${protocol}://${window.location.host}/ws` : `${protocol}://${window.location.hostname}:3000`
const ws = new WebSocket (url);

const control = document.getElementById("control");
const displayButton = document.getElementById("camselect");
const feedstopButton = document.getElementById("feedstop");

displayButton.addEventListener("onclick", () => {
  const feedframe = document.createElement("img");
  feedframe.setAttribute("src", `${location.protocol}//${window.location.host}/stream?streamId=1`)
})
// src="http://esp32cam.local/stream"

ws.onopen = () => {
  console.log("connected to server")

  ws.send(JSON.stringify({
    type: "init",
    severId: "frontend-01",
    role: "browser-client"
  }));
};

ws.onmessage = (event) => {
  const msg = JSON.parse(event.data);
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
  })
})

control.addEventListener("touchend", (e) => {
  e.preventDefault();
  console.log(e.touches[0].clientX);
  console.log(e.touches[0].clientY);
})
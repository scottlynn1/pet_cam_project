import asyncio
import websockets
import json
import aiohttp

PORT = 5000
NODE_URL = 'ws://project4.scottlynn.live/ws'
CAM_URL = "http://esp32cam.local/stream/"
devices = {}
stream_task = None

async def listen(websocket):
    print("ESP32 connected")
    await websocket.send(json.dumps({
        "type":"init_conn",
        "role":"py_server"
    }))

    try:
        async for msg in websocket:
              device_data = json.loads(msg)
              print("Registering:", device_data["role"])
              devices[device_data["streamId"]] = websocket
    except websockets.exceptions.ConnectionClosed:
        print("ESP32 disconnected: connecton failed")

async def start_server():
    server = await websockets.serve(
        listen,
        "0.0.0.0",
        PORT,
        ping_interval=20,
        ping_timeout=20
    )
    print(f"WebSocket server listening on {PORT}")
    await server.wait_closed()

async def stream_video(ws, url):
    async with aiohttp.ClientSession() as session:
        async with session.get(url) as resp:
            async for chunk in resp.content.iter_chunked(4096):
                await ws.send(chunk)

def cancel_stream():
    global stream_task
    if stream_task and not stream_task.done():
        stream_task.cancel()
    stream_task = None

async def connect_to_node(uri):
    global stream_task

    while True:
        try:
            async with websockets.connect(uri) as ws:
                print(f"Connected to {uri}")
                await ws.send(json.dumps({ 
                    "type": "init_conn",
                        "role": "py_server",
                        "target": "node_server"
                }))
                async for message in ws:
                    msg = json.loads(message)
                    print(msg)
                    if msg["type"] == "servo_cmd":
                        socket = devices.get(msg["target"])
                        if socket:
                          await socket.send(json.dumps({
                              "type": "servo_cmd",
                              "data": msg["data"]
                          }))
                        
                    elif msg["type"] == "init_stream":
                      if stream_task is None or stream_task.done():
                        stream_task = asyncio.create_task(
                            stream_video(ws, f"{CAM_URL}{msg["target"]}"))
        except websockets.exceptions.ConnectionClosed:
            print("Node disconnected")
            cancel_stream()

        except Exception as e:
            print(f"Connection to {uri} failed: {e}")
            cancel_stream()
            await asyncio.sleep(5)  # reconnect delay

async def main():
    await asyncio.gather(
      start_server(),
      connect_to_node(NODE_URL)
    )

if __name__ == "__main__":
    asyncio.run(main())



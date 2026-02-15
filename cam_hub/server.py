import asyncio
import websockets
import json
import requests

PORT = 5000
url = 'ws://project4.scottlynn.live/ws'
camurl = "http://esp32cam.local/stream"
devices = map()


# async def listen(websocket):
#   print(websocket)

# async def start_server():
#   server = await websockets.serve(listen, "localhost", PORT)
#   print(f"WebSocket server listening on {PORT}")
#   await server.wait_closed()

async def listen(websocket):
    print("ESP32 connected")
    await websocket.send('{"type":"hello","source":"pi"}')

    try:
        async for msg in websocket:
            print("Received:", msg)
            devices.set(msg, websocket)
    except websockets.exceptions.ConnectionClosed:
        print("ESP32 disconnected")

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

headers = {
    "X-Server-ID": "rasppi",
    "X-Role": "hub"
}





async def connect_to_node(uri):
    while True:
        try:
            async with websockets.connect(uri) as ws:
                await ws.send(json.dumps({
                  "type": "init",
                  "role": "python",
                  "server_id": "py-01"
                }))
                print(f"Connected to {uri}")
                async for msg in ws:
                    if "messege = init":
                      r = requests.get(url, stream=True)
                      for chunk in r.iter_content(chunk_size=4096):
                        if not chunk:
                          break
                        ws.send(chunk)
                    print(f"From {uri}: {msg}")
        except Exception as e:
            print(f"Connection to {uri} failed: {e}")
            await asyncio.sleep(5)  # reconnect delay

async def main():
    await asyncio.gather(
      start_server(),
      connect_to_node(url)
    )

if __name__ == "__main__":
    asyncio.run(main())

# import asyncio
# import websockets

# # ----------------------
# # WebSocket SERVER
# # ----------------------

# async def handle_client(websocket):
#     async for message in websocket:
#         print(f"Incoming client says: {message}")
#         await websocket.send("ack")

# async def start_server():
#     server = await websockets.serve(handle_client, "0.0.0.0", 8765)
#     print("WebSocket server listening on :8765")
#     await server.wait_closed()

# # ----------------------
# # WebSocket CLIENT
# # ----------------------

# async def connect_to_other_server(uri):
#     while True:
#         try:
#             async with websockets.connect(uri) as ws:
#                 print(f"Connected to {uri}")
#                 async for msg in ws:
#                     print(f"From {uri}: {msg}")
#         except Exception as e:
#             print(f"Connection to {uri} failed: {e}")
#             await asyncio.sleep(5)  # reconnect delay

# # ----------------------
# # MAIN
# # ----------------------

# async def main():
#     await asyncio.gather(
#         start_server(),
#         connect_to_other_server("ws://example.com:9000"),
#         connect_to_other_server("ws://another-server:9010"),
#     )

# asyncio.run(main())

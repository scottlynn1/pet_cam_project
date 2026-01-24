import asyncio
import websockets

PORT = 5000
url = 'ws://localhost:3000'

async def listen(websocket):
  print(websocket)

async def start_server():
  server = await websockets.serve(listen, "localhost", PORT)
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
                print(f"Connected to {uri}")
                async for msg in ws:
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

import asyncio
import websockets
import json
from device_manager import DeviceManager
from stream_manager import StreamManager
from node_connection import NodeConnection

PORT = 5000
NODE_URL = 'wss://project4.scottlynn.live/ws'
CAM_URL = "http://esp32cam-"
SERVER_ID = 123
            
device_manager = DeviceManager(SERVER_ID)
stream_manager = StreamManager(NODE_URL, CAM_URL, SERVER_ID)
node_connection = NodeConnection(device_manager, stream_manager, SERVER_ID)

async def listen(websocket):
    print("ESP32 connecting")
    streamId = None
    try:
      await websocket.send(json.dumps({
          "type":"init_conn",
          "role":"py_server"
      }))
      print("init msg sent")
      msg = await websocket.recv()
      device_data = json.loads(msg)
      if device_data.get("type") == "init_conn":
          print("init_conn recieved from ", device_data["role"])
          streamId = str(device_data["streamId"])
          print("Registering: ", device_data["role"], " with streamId: ", streamId)
          await device_manager.register(streamId, device_data["role"], websocket)
      else:
          print("first message not 'init_conn'")
          raise Exception("message recieved not 'init_conn'")
    except websockets.exceptions.ConnectionClosed as e:
        print(f"ESP32 disconnected: {e.code} - {e.reason}")
    except Exception as e:
        print(f"CRITICAL ERROR: {e}")

    finally:
        if streamId and streamId in device_manager.list():
            print("Unregistering device with streamId: ", streamId)
            await device_manager.unregister(streamId)
        if streamId and streamId in stream_manager.active_streams:
            print("Cancelling active stream task for streamId: ", streamId)
            task = stream_manager.active_streams.get(streamId)
            if task:
                task.cancel()
                await task

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

async def main():
    await asyncio.gather(
      start_server(),
      node_connection.connect(NODE_URL)
    )

if __name__ == "__main__":
    asyncio.run(main())



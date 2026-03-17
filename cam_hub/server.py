import asyncio
import websockets
import json
import aiohttp

PORT = 5000
NODE_URL = 'ws://project4.scottlynn.live/ws'
CAM_URL = "http://esp32cam.local/stream/"
SERVER_ID = 123

class DeviceManager:
    def __init__(self):
        self.devices = {}
        self.on_change_callbacks = []

    def register_callback(self, callback):
        self.on_change_callbacks.append(callback)

    async def register(self, stream_id, role, websocket):
        self.devices[stream_id] = {
            "ws": websocket,
            "role": role
        }
        await self._notify_change()
    
    async def unregister(self, stream_id):
        self.devices.pop(stream_id, None)
        await self._notify_change()

    def get(self, stream_id):
        return self.devices.get(stream_id)

    def list(self):
        return list(self.devices.keys())
    
    async def _notify_change(self):
        for cb in self.on_change_callbacks:
            await cb(self.list())

class StreamManager:
    def __init__(self):
        self.active_streams = {}

    async def start(self, device_id):
        if device_id in self.active_streams:
            return

        
        task = asyncio.create_task(self._stream(device_id))
        self.active_streams[device_id] = task

    async def _stream(self, device_id):
        ws_stream = None
        try:
            ws_stream = await websockets.connect(NODE_URL)

            await ws_stream.send(json.dumps({
                "type": "init_stream", "role": "py_server", "hubID": SERVER_ID, "device": device_id
                }))
            
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{CAM_URL}{device_id}") as resp:
                    async for chunk in resp.content.iter_chunked(4096):
                        await ws_stream.send(chunk)

        except Exception as e:
            print(f"Stream socket error: {e}")
        finally:
            if ws_stream:
                await ws_stream.close()
            self.active_streams.pop(device_id, None)


class NodeConnection:
    def __init__(self, device_manager, stream_manager):
        self.ws = None
        self.device_manager = device_manager
        self.stream_manager = stream_manager
        device_manager.register_callback(self.broadcast_devices)

    async def connect(self, uri):
        await asyncio.gather(
            self._handle_commands(uri),
        )

    async def _handle_commands(self, uri):
        while True:
            try:
                async with websockets.connect(uri) as ws:
                    self.ws = ws

                    await ws.send(json.dumps({
                        "type": "init_conn", "role": "py_server", "hubID": SERVER_ID, "devices": DeviceManager.list()
                        }))


                    async for msg in ws:
                        await self.handle(msg)
            except Exception as e:
                print(f"Command socket error: {e}")
                self.ws = None
                await asyncio.sleep(5)

    async def broadcast_devices(self, devices_list):
        if self.ws:
            await self.ws.send(json.dumps({
                "type": "sync_data",
                "devices": devices_list
                }))
    
    async def handle(self, message):
        msg = json.loads(message)

        if msg["type"] in ["servo_cmd","laser_cmd"]:
            device = self.device_manager.get(msg["target"])

            if device:
                await device["ws"].send(json.dumps(msg))
        
        elif msg["type"] == "init_stream":
            self.stream_manager.start(msg["target"])
            
device_manager = DeviceManager()
stream_manager = StreamManager()
node_connection = NodeConnection(device_manager, stream_manager)


async def listen(websocket):
    print("ESP32 connected")
    streamId = None
    await websocket.send(json.dumps({
        "type":"init_conn",
        "role":"py_server"
    }))
    try:
        async for msg in websocket:
            device_data = json.loads(msg)
            streamId = device_data["streamId"]
            print("Registering: ", device_data["role"], " with streamId: ", streamId)
            await device_manager.register(device_data["streamId"], device_data["role"], websocket)
    except websockets.exceptions.ConnectionClosed:
        print("ESP32 disconnected: connecton failed")

    finally:
        if streamId and streamId in device_manager.list():
            print("Unregistering device with streamId: ", streamId)
            await device_manager.unregister(streamId)

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



# def cancel_stream():
#     global stream_task
#     if stream_task and not stream_task.done():
#         stream_task.cancel()
#     stream_task = None




async def main():
    await asyncio.gather(
      start_server(),
      node_connection.connect(NODE_URL)
    )

if __name__ == "__main__":
    asyncio.run(main())



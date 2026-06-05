import asyncio
import websockets
import json
from device_manager import DeviceManager
from stream_manager import StreamManager
from node_connection import NodeConnection
import os
from tapo import ApiClient
from dotenv import load_dotenv

load_dotenv()

# username = os.getenv("TAPO_USERNAME")
# password = os.getenv("TAPO_PASSWORD")
ip_address = os.getenv("TAPO_PLUG_IP")

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
          camName = device_data.get("camName", streamId)
          print("Registering: ", device_data["role"], " with streamId: ", streamId)
          await device_manager.register(streamId, device_data["role"], websocket, camName)
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

# async def plug_endpoint():
#     print("running tapo code")
#     if not all([username, password, ip_address]):
#         print("Error: Missing required environment variables in .env file.")
#         return

#     # Initialize the Tapo client
#     client = ApiClient(username, password)
    
#     try:
#         # Connect to the plug (using p110 as an example)
#         device = await client.p110(ip_address)
        
#         print("Connecting to plug and toggling state...")
#         await device.on()

#     except Exception as e:
#             print(f"An error occurred: {e}")
async def check_ip(client: ApiClient, ip: str, found_devices: list):
    """Attempts to connect to a single IP to see if it's a Tapo device."""
    try:
        # We use a short timeout so the script doesn't hang on empty IPs
        # client.p100() works as a generic check for most Tapo plugs/switches
        print(f"attempting to connect to {ip}")
        device = await asyncio.wait_for(client.p110(ip), timeout=1.5)
        print(device)
        # If it connects, grab the device info
        info = await device.get_device_info()
        name = getattr(info, "alias", None) or getattr(info, "nickname", None) or "Unknown Tapo Device"
        device_data = {
            "ip": ip,
            "name": name,
            "model": info.model,
            "mac": info.mac,
            "is_on": info.device_on
        }
        print(device_data)
        found_devices.append(device_data)
        print(f"✅ Found Tapo Device: {info.alias} ({info.model}) at {ip}")
        
    except (asyncio.TimeoutError, Exception):
        # Fail silently for IPs that don't have a Tapo device listening
        pass


async def scan_subnet(subnet_prefix: str):
    """Scans IPs from .1 to .254 concurrently."""
    username = os.getenv("TAPO_USERNAME")
    password = os.getenv("TAPO_PASSWORD")
    
    client = ApiClient(username, password)
    found_devices = []
    tasks = []
    
    print(f"Scanning subnet {subnet_prefix}.0/24...")
    
    # Generate tasks for IPs .1 through .254
    for i in range(1, 255):
        ip = f"{subnet_prefix}.{i}"
        tasks.append(check_ip(client, ip, found_devices))
    
    # Run all 254 network checks concurrently
    await asyncio.gather(*tasks)
    
    return found_devices

async def main():
    SUBNET = "192.168.1" 
    
    tapo_list = await scan_subnet(SUBNET)
    
    print("\n--- Final Scan Results ---")
    print(f"Total Tapo devices found: {len(tapo_list)}")
    for dev in tapo_list:
        print(f"- {dev['name']} [{dev['model']}] -> {dev['ip']} (Status: {'ON' if dev['is_on'] else 'OFF'})")

    await asyncio.gather(
      start_server(),
      node_connection.connect(NODE_URL)
    )


if __name__ == "__main__":
    asyncio.run(main())



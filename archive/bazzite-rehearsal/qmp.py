#!/usr/bin/env python3
"""Minimal QMP client: qmp.py <command-json> [<command-json>...]
Example: qmp.py '{"execute":"screendump","arguments":{"filename":"/work/logs/screen.png","format":"png"}}'"""
import json, socket, sys

s = socket.create_connection(("127.0.0.1", 4444), timeout=10)
f = s.makefile("rw")
json.loads(f.readline())  # greeting
f.write(json.dumps({"execute": "qmp_capabilities"}) + "\n"); f.flush()
json.loads(f.readline())
for arg in sys.argv[1:]:
    f.write(arg + "\n"); f.flush()
    while True:
        resp = json.loads(f.readline())
        if "event" in resp:
            continue
        print(json.dumps(resp))
        break

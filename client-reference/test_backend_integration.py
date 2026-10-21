"""Opt-in actual HTTP client/backend test against an isolated SQLite file.
Run: python3 test_backend_integration.py /workspace/license-api-fixed
No production database, known license, credentials or live API are used.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import secrets
import socket
import subprocess
import sys
import tempfile
import time
from urllib.request import Request, urlopen
from license_client import ClientConfig, LicenseClient, LicenseClientError


def run(backend: Path) -> None:
    with tempfile.TemporaryDirectory(prefix="license-client-http-") as directory:
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        base = f"http://127.0.0.1:{port}"
        password = secrets.token_urlsafe(32)
        env = {k: v for k, v in os.environ.items() if not k.startswith("FIREBASE_") and k != "GOOGLE_APPLICATION_CREDENTIALS"}
        env.update(NODE_ENV="production", LICENSE_DB_FILE=str(Path(directory) / "private.sqlite"), ADMIN_USERNAME="isolated-test-admin", ADMIN_PASSWORD=password, PORT=str(port), HOST="127.0.0.1", SESSION_TTL_SECONDS="300")
        process = None

        def start():
            child = subprocess.Popen(["node", str(backend / "server.js")], cwd=backend, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            for _ in range(200):
                if child.poll() is not None:
                    raise RuntimeError("isolated backend failed to start")
                try:
                    with urlopen(base + "/api/health", timeout=0.3) as response:
                        health = json.load(response)
                        if health.get("ready") is True and health.get("storage") == "sqlite":
                            return child
                except OSError:
                    pass
                time.sleep(0.05)
            child.terminate()
            child.wait(timeout=10)
            raise RuntimeError("isolated backend readiness timeout")

        def stop(child):
            if child and child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill()
                    child.wait(timeout=5)

        def request(path, payload=None, token=None):
            headers = {"Content-Type": "application/json"}
            if token:
                headers["Authorization"] = "Bearer " + token
            req = Request(base + path, data=json.dumps(payload).encode() if payload is not None else None, headers=headers)
            with urlopen(req, timeout=10) as response:
                return json.load(response)

        def login():
            return request("/api/auth/login", {"username": "isolated-test-admin", "password": password})["token"]

        try:
            process = start()
            token = login()
            request("/api/admin/generate", {"duration": 7, "count": 1, "max_devices": 1}, token)
            record = request("/api/admin/data", token=token)["keys"][0]
            client = LicenseClient(ClientConfig(base, allow_http_loopback=True))
            session = client.activate(record["key_value"], "isolated-device")
            assert session.session_expires_at is not None, "session expiry was not parsed"
            assert client.heartbeat().session_id == session.session_id, "session mismatch"
            print("PASS: actual HTTP activation and heartbeat with server-generated license")
            stop(process)
            process = start()
            assert client.heartbeat().session_id == session.session_id, "session did not persist"
            print("PASS: same server-issued session survives backend restart")
            token = login()
            request(f"/api/admin/key/toggle-disable/{record['id']}", {}, token)
            try:
                client.heartbeat()
            except LicenseClientError:
                assert client.session is None
            else:
                raise AssertionError("revoked license heartbeat was accepted")
            print("PASS: actual revocation fails closed and clears client state")
        finally:
            stop(process)


if __name__ == "__main__":
    target = Path(sys.argv[1] if len(sys.argv) > 1 else "/workspace/license-api-fixed").resolve()
    run(target)

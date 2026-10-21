"""Actual HTTP acceptance checks. Uses only a generated temporary SQLite DB.
Run after npm run build: python3 acceptance_http.py
No live API or existing credential file is accessed.
"""
import concurrent.futures
import json
import os
from pathlib import Path
import secrets
import socket
import sqlite3
import subprocess
import tempfile
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parent

def free_port():
    with socket.socket() as sock:
        sock.bind(('127.0.0.1', 0))
        return sock.getsockname()[1]

def request(base, path, body=None, token=None, raw=None):
    headers = {'Content-Type': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = raw if raw is not None else json.dumps(body).encode() if body is not None else None
    req = Request(base + path, data=data, headers=headers)
    try:
        response = urlopen(req, timeout=20)
    except HTTPError as error:
        response = error
    with response:
        return response.code, json.load(response)

def run():
    checks = []
    processes = []
    def passed(name):
        checks.append(name)
        print('PASS:', name, flush=True)
    def expect(status, expected, label):
        if status != expected:
            raise AssertionError(label + ': unexpected HTTP status (private response omitted)')
    with tempfile.TemporaryDirectory(prefix='license-acceptance-') as directory:
        database = Path(directory) / 'private.sqlite'
        password = secrets.token_urlsafe(32)
        env = {k: v for k, v in os.environ.items() if not k.startswith('FIREBASE_') and k != 'GOOGLE_APPLICATION_CREDENTIALS'}
        env.update(NODE_ENV='production', HOST='127.0.0.1', LICENSE_DB_FILE=str(database), ADMIN_USERNAME='acceptance-admin', ADMIN_PASSWORD=password, SESSION_TTL_SECONDS='120')
        def start():
            port = free_port()
            child = subprocess.Popen(['node', str(ROOT / 'server.js')], cwd=ROOT, env={**env, 'PORT': str(port)}, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            processes.append(child)
            base = f'http://127.0.0.1:{port}'
            for _ in range(200):
                if child.poll() is not None:
                    raise RuntimeError('isolated service startup failed')
                try:
                    status, body = request(base, '/api/health')
                    if status == 200 and body.get('storage') == 'sqlite':
                        return child, base
                except OSError:
                    pass
                time.sleep(.05)
            raise RuntimeError('isolated service readiness timed out')
        def stop(child):
            if child.poll() is None:
                child.terminate()
                try:
                    child.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    child.kill(); child.wait(timeout=5)
        def login(base):
            status, body = request(base, '/api/auth/login', {'username': 'acceptance-admin', 'password': password})
            expect(status, 200, 'admin login')
            return body['token']
        def create(base, token, duration=7, max_devices=1):
            status, _ = request(base, '/api/admin/generate', {'duration': duration, 'count': 1, 'max_devices': max_devices}, token)
            expect(status, 200, 'generate')
            status, body = request(base, '/api/admin/data', token=token)
            expect(status, 200, 'admin data')
            return body['keys'][0]
        def fixture(edit):
            # Only this freshly-created temporary test database; never production.
            with sqlite3.connect(database) as connection:
                value, = connection.execute('SELECT value FROM state WHERE id=1').fetchone()
                state = json.loads(value); edit(state)
                connection.execute('UPDATE state SET value=?, revision=revision+1 WHERE id=1', (json.dumps(state),))
        try:
            child, base = start(); token = login(base)
            passed('health and private admin login')
            key = create(base, token)
            payload = {'license_key': key['key_value'], 'device_fingerprint': 'device-a'}
            status, activation = request(base, '/api/activate', payload)
            expect(status, 200, 'activation'); assert activation['success'] is True
            assert all(name in activation for name in ['session_id', 'session_expires_at', 'expires_at', 'plan', 'user', 'seller'])
            heartbeat = {'key': key['key_value'], 'session_id': activation['session_id'], 'hwid': 'device-a'}
            expect(request(base, '/api/heartbeat', heartbeat)[0], 200, 'heartbeat')
            passed('authorized generated-license activation, heartbeat, aliases and response fields')
            expect(request(base, '/api/activate', {'license_key': 'invalid-not-a-license', 'hwid': 'a'})[0], 404, 'invalid')
            expect(request(base, '/api/activate', {**payload, 'key': 'conflicting'})[0], 400, 'conflict')
            expect(request(base, '/api/activate', {'license_key': [], 'hwid': 'a'})[0], 400, 'type')
            expect(request(base, '/api/activate', raw=b'{broken')[0], 400, 'malformed')
            passed('invalid license, conflicting aliases, wrong types and malformed JSON rejected')
            expect(request(base, '/api/activate', {**payload, 'device_fingerprint': 'other-device'})[0], 403, 'binding')
            expect(request(base, '/api/heartbeat', {**heartbeat, 'hwid': 'other-device'})[0], 403, 'heartbeat binding')
            passed('activation device limit and heartbeat device binding')
            stop(child); child, base = start(); token = login(base)
            expect(request(base, '/api/heartbeat', heartbeat)[0], 200, 'persisted session')
            passed('same license and server-issued session survive restart')
            fixture(lambda state: next(s for s in state['sessions'] if s['session_id'] == activation['session_id']).__setitem__('expires_at', '2000-01-01T00:00:00Z'))
            expect(request(base, '/api/heartbeat', heartbeat)[0], 401, 'expired session')
            passed('expired session fixture rejected')
            fixture(lambda state: next(k for k in state['keys'] if k['id'] == key['id']).__setitem__('expires_at', '2000-01-01T00:00:00Z'))
            expect(request(base, '/api/activate', payload)[0], 400, 'expired license')
            passed('expired license fixture rejected')
            fresh = create(base, token)
            fresh_payload = {'key': fresh['key_value'], 'hwid': 'fresh-device'}
            status, fresh_activation = request(base, '/api/activate', fresh_payload); expect(status, 200, 'fresh')
            fresh_hb = {**fresh_payload, 'session_id': fresh_activation['session_id']}
            expect(request(base, f"/api/admin/key/toggle-disable/{fresh['id']}", {}, token)[0], 200, 'disable')
            expect(request(base, '/api/activate', fresh_payload)[0], 403, 'disabled activation')
            assert request(base, '/api/heartbeat', fresh_hb)[0] in (401, 403)
            passed('revoked license activation and session rejected')
            expect(request(base, f"/api/admin/key/toggle-disable/{fresh['id']}", {}, token)[0], 200, 'enable')
            status, fresh_activation = request(base, '/api/activate', fresh_payload); expect(status, 200, 're-activate')
            expect(request(base, f"/api/admin/key/reset-devices/{fresh['id']}", {}, token)[0], 200, 'reset')
            expect(request(base, '/api/heartbeat', {**fresh_payload, 'session_id': fresh_activation['session_id']})[0], 401, 'reset session')
            passed('reset-devices revokes existing sessions')
            expect(request(base, '/api/admin/reseller/create', {'username': 'fixture-reseller', 'password': secrets.token_urlsafe(24), 'balance': 100}, token)[0], 200, 'reseller create')
            expect(request(base, '/api/admin/prices', {'prices': {'7': 25}}, token)[0], 200, 'prices')
            status, data = request(base, '/api/admin/data', token=token); expect(status, 200, 'admin data')
            assert len(data['resellers']) == 1 and len(data['prices']) > 0
            passed('retained admin/data, reseller creation and prices routes')
            concurrent_key = create(base, token)
            second, base2 = start()
            def activate(index):
                return request(base if index % 2 else base2, '/api/activate', {'license_key': concurrent_key['key_value'], 'hwid': f'race-device-{index}'})[0]
            with concurrent.futures.ThreadPoolExecutor(max_workers=12) as pool:
                statuses = list(pool.map(activate, range(24)))
            assert statuses.count(200) == 1 and all(status in (200, 403, 409) for status in statuses)
            with sqlite3.connect(database) as connection:
                value, = connection.execute('SELECT value FROM state WHERE id=1').fetchone()
                saved = next(k for k in json.loads(value)['keys'] if k['id'] == concurrent_key['id'])
                assert len(saved['hwid_list']) == 1
            passed('24 activations across two processes: exactly one bound device, no lost update')
            result = {'passed': len(checks), 'checks': checks, 'storage': 'isolated temporary SQLite', 'firebase_tested': False, 'android_binary_tested': False, 'secrets_included': False}
            (ROOT / 'acceptance-results.json').write_text(json.dumps(result, indent=2) + '\n')
            print('ALL ACCEPTANCE GROUPS PASSED:', len(checks))
        finally:
            for process in processes:
                stop(process)

if __name__ == '__main__':
    run()

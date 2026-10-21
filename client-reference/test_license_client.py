import json
import unittest
from datetime import datetime, timedelta, timezone
from unittest.mock import patch
from license_client import ClientConfig, LicenseClient, LicenseClientError, LicenseProtocolError


def iso(delta=3600):
    return (datetime.now(timezone.utc) + timedelta(seconds=delta)).isoformat().replace("+00:00", "Z")


def response(session="s1", success=True, status=200, **extra):
    body = {"success": success, "session_id": session, "heartbeat_interval": 60,
            "user": {"expires_at": iso()}}
    body.update(extra)
    return status, json.dumps(body).encode()


class Fake:
    def __init__(self, *results): self.results = list(results); self.calls = []
    def __call__(self, method, url, body, timeout):
        self.calls.append((method, url, body, timeout))
        result = self.results.pop(0)
        if isinstance(result, BaseException): raise result
        return result


class ClientTests(unittest.TestCase):
    def client(self, fake):
        return LicenseClient(ClientConfig("https://license.example", timeout_seconds=0.2), fake)

    def test_malformed_json_and_missing_fields_fail_closed(self):
        c = self.client(Fake((200, b"not-json")))
        with self.assertRaises(LicenseProtocolError): c.activate("K", "H")
        self.assertIsNone(c.session)
        c = self.client(Fake((200, b'{"success":true}')))
        with self.assertRaises(LicenseProtocolError): c.activate("K", "H")
        self.assertIsNone(c.session)

    def test_success_false_200_and_500_success_true(self):
        for result in [(200, b'{"success":false}'), response(status=500)]:
            c = self.client(Fake(result))
            with self.assertRaises(LicenseProtocolError): c.activate("K", "H")
            self.assertIsNone(c.session)

    def test_timeout_invalidates_existing_state(self):
        fake = Fake(response(), TimeoutError("slow"))
        c = self.client(fake); c.activate("K", "H")
        with self.assertRaises(LicenseClientError): c.heartbeat()
        self.assertIsNone(c.session)

    def test_activation_and_exact_heartbeat(self):
        fake = Fake(response("s1"), response("s1"))
        c = self.client(fake); s = c.activate("K", "H"); c.heartbeat()
        self.assertEqual(fake.calls[0][2], {"license_key": "K", "hwid": "H"})
        self.assertEqual(fake.calls[1][2], {"license_key": "K", "session_id": "s1", "hwid": "H"})
        self.assertEqual(s.session_id, "s1")

    def test_expired_license_and_session_rejected(self):
        expired = (200, json.dumps({"success": True, "session_id": "s", "heartbeat_interval": 60,
          "user": {"expires_at": iso(-1)}}).encode())
        c = self.client(Fake(expired))
        with self.assertRaises(LicenseProtocolError): c.activate("K", "H")
        session_expired = response(user={"expires_at": iso(), "session_expires_at": iso(-1)})
        c = self.client(Fake(session_expired))
        with self.assertRaises(LicenseProtocolError): c.activate("K", "H")

    def test_conflicting_heartbeat_session_invalidates(self):
        c = self.client(Fake(response("s1"), response("different")))
        c.activate("K", "H")
        with self.assertRaises(LicenseProtocolError): c.heartbeat()
        self.assertIsNone(c.session)

    def test_top_level_session_expiry(self):
        c = self.client(Fake(response(session_expires_at=iso(-1))))
        with self.assertRaises(LicenseProtocolError): c.activate("K", "H")
        self.assertIsNone(c.session)
        expires = iso(60)
        c = self.client(Fake(response(session_expires_at=expires)))
        self.assertEqual(c.activate("K", "H").session_expires_at.isoformat(), expires.replace("Z", "+00:00"))

    def test_conflicting_expiries_rejected(self):
        for result in [response(expires_at=iso(7200)), response(session_expires_at=iso(60), user={"expires_at": iso(), "session_expires_at": iso(120)})]:
            c = self.client(Fake(result))
            with self.assertRaises(LicenseProtocolError): c.activate("K", "H")
            self.assertIsNone(c.session)

    def test_session_property_expires_locally(self):
        c = self.client(Fake(response(session_expires_at=iso(60))))
        c.activate("K", "H")
        with patch("license_client.datetime") as clock:
            clock.now.return_value = datetime.now(timezone.utc) + timedelta(seconds=120)
            self.assertIsNone(c.session)

    def test_http_requires_explicit_loopback_and_unknown_profile_rejected(self):
        with self.assertRaises(ValueError): ClientConfig("http://api.example")
        ClientConfig("http://127.0.0.1:3000", allow_http_loopback=True)
        ClientConfig("http://[::1]:3000", allow_http_loopback=True)
        for base in ["https://user:pass@example.com", "https://example.com?x=1", "https://example.com#fragment", "https://example.com/path", "https://"]:
            with self.assertRaises(ValueError): ClientConfig(base)
        with self.assertRaises(ValueError): ClientConfig("https://x", profile="new_api")


if __name__ == "__main__": unittest.main()

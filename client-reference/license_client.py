"""Safe reference client for the verified Express license API.

This module intentionally supports only profile="verified_express". It keeps
credentials/session state in memory and never writes tokens or license keys.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import json
import ssl
from typing import Any, Callable, Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPSHandler, HTTPRedirectHandler


class LicenseClientError(Exception):
    """Base error; callers should treat the client as unusable after failures."""


class LicenseProtocolError(LicenseClientError):
    pass


class LicenseTransportError(LicenseClientError):
    pass


@dataclass(frozen=True)
class ClientConfig:
    base_url: str
    profile: str = "verified_express"
    timeout_seconds: float = 10.0
    allow_http_loopback: bool = False

    def __post_init__(self) -> None:
        if self.profile != "verified_express":
            raise ValueError("only the verified_express API profile is supported")
        base = self.base_url.rstrip("/")
        parsed = urlsplit(base)
        if parsed.scheme not in {"https", "http"} or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
            raise ValueError("base_url must be an HTTP(S) origin without credentials, path, query or fragment")
        if parsed.scheme == "http":
            if not (self.allow_http_loopback and parsed.hostname.lower() in {"127.0.0.1", "localhost", "::1"}):
                raise ValueError("HTTP is allowed only for explicit loopback development")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")


@dataclass(frozen=True)
class Session:
    session_id: str
    license_expires_at: datetime
    heartbeat_interval: int
    session_expires_at: datetime | None = None


class UrllibTransport:
    """Default transport. Tests can inject a callable with the same contract."""
    def __call__(self, method: str, url: str, body: Mapping[str, str], timeout: float) -> tuple[int, bytes]:
        request = Request(url, data=json.dumps(dict(body)).encode(), method=method,
                          headers={"Content-Type": "application/json", "Accept": "application/json"})
        class NoRedirect(HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                return None
        opener = build_opener(HTTPSHandler(context=ssl.create_default_context()), NoRedirect())
        try:
            with opener.open(request, timeout=timeout) as response:
                raw = response.read(65537)
                if len(raw) > 65536:
                    raise LicenseProtocolError("license API response exceeds size limit")
                return int(response.status), raw
        except HTTPError as exc:
            return int(exc.code), exc.read(65536)
        except (URLError, TimeoutError, OSError) as exc:
            raise LicenseTransportError("license API network failure") from exc


class LicenseClient:
    def __init__(self, config: ClientConfig, transport: Callable[[str, str, Mapping[str, str], float], tuple[int, bytes]] | None = None):
        self.config = config
        self._transport = transport or UrllibTransport()
        self._session: Session | None = None
        self._license_key: str | None = None
        self._hwid: str | None = None

    @property
    def session(self) -> Session | None:
        if self._session is not None:
            now = datetime.now(timezone.utc)
            if self._session.license_expires_at <= now or (self._session.session_expires_at is not None and self._session.session_expires_at <= now):
                self._clear()
        return self._session

    def _clear(self) -> None:
        self._session = self._license_key = self._hwid = None

    @staticmethod
    def _timestamp(value: Any, field: str) -> datetime:
        if not isinstance(value, str) or not value.strip():
            raise LicenseProtocolError(f"{field} must be a non-empty ISO-8601 string")
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise LicenseProtocolError(f"{field} is not a valid timestamp") from exc
        if parsed.tzinfo is None:
            raise LicenseProtocolError(f"{field} must include a timezone")
        return parsed.astimezone(timezone.utc)

    @staticmethod
    def _required_text(obj: Mapping[str, Any], field: str) -> str:
        value = obj.get(field)
        if not isinstance(value, str) or not value.strip():
            raise LicenseProtocolError(f"missing or invalid {field}")
        return value

    def _request(self, path: str, body: Mapping[str, str]) -> Mapping[str, Any]:
        try:
            status, raw = self._transport("POST", self.config.base_url.rstrip("/") + path, body, self.config.timeout_seconds)
        except LicenseClientError:
            self._clear()
            raise
        except Exception as exc:
            self._clear()
            raise LicenseTransportError("license API transport failure") from exc
        if not isinstance(status, int) or status < 100:
            self._clear(); raise LicenseTransportError("invalid HTTP status")
        try:
            parsed = json.loads(raw.decode("utf-8") if isinstance(raw, (bytes, bytearray)) else raw)
        except (UnicodeDecodeError, json.JSONDecodeError, TypeError) as exc:
            self._clear(); raise LicenseProtocolError("response was not valid JSON") from exc
        if not isinstance(parsed, dict):
            self._clear(); raise LicenseProtocolError("response JSON must be an object")
        # HTTP status and application success are both authoritative.
        if status < 200 or status >= 300 or parsed.get("success") is not True:
            self._clear(); raise LicenseProtocolError("license API rejected request")
        return parsed

    def _parse_success(self, response: Mapping[str, Any]) -> Session:
        session_id = self._required_text(response, "session_id")
        interval = response.get("heartbeat_interval")
        if isinstance(interval, bool) or not isinstance(interval, int) or interval <= 0:
            raise LicenseProtocolError("heartbeat_interval must be a positive integer")
        user = response.get("user")
        if not isinstance(user, dict):
            raise LicenseProtocolError("user object is required")
        expires = self._timestamp(user.get("expires_at"), "user.expires_at")
        if "expires_at" in response and self._timestamp(response["expires_at"], "expires_at") != expires:
            raise LicenseProtocolError("conflicting license expiry fields")
        session_exp_raw = response.get("session_expires_at")
        session_exp = self._timestamp(session_exp_raw, "session_expires_at") if session_exp_raw is not None else None
        if "session_expires_at" in user:
            nested_exp = self._timestamp(user["session_expires_at"], "user.session_expires_at")
            if session_exp is not None and nested_exp != session_exp:
                raise LicenseProtocolError("conflicting session expiry fields")
            session_exp = nested_exp
        now = datetime.now(timezone.utc)
        if expires <= now or (session_exp is not None and session_exp <= now):
            raise LicenseProtocolError("license or session is expired")
        return Session(session_id, expires, interval, session_exp)

    def activate(self, license_key: str, hwid: str) -> Session:
        # A failed activation always destroys any prior usable state.
        self._clear()
        if not isinstance(license_key, str) or not license_key.strip() or not isinstance(hwid, str) or not hwid.strip():
            raise ValueError("license_key and hwid must be non-empty strings")
        try:
            response = self._request("/api/activate", {"license_key": license_key, "hwid": hwid})
            session = self._parse_success(response)
        except LicenseClientError:
            self._clear(); raise
        self._license_key, self._hwid, self._session = license_key, hwid, session
        return session

    def heartbeat(self) -> Session:
        if self._session is None or self._license_key is None or self._hwid is None:
            raise LicenseClientError("no usable license session")
        now = datetime.now(timezone.utc)
        if now >= self._session.license_expires_at or (self._session.session_expires_at and now >= self._session.session_expires_at):
            self._clear(); raise LicenseProtocolError("license or session is expired")
        try:
            response = self._request("/api/heartbeat", {"license_key": self._license_key, "session_id": self._session.session_id, "hwid": self._hwid})
            next_session = self._parse_success(response)
            if next_session.session_id != self._session.session_id:
                raise LicenseProtocolError("heartbeat returned a conflicting session_id")
        except LicenseClientError:
            self._clear(); raise
        self._session = next_session
        return next_session

    def revoke_local(self) -> None:
        self._clear()

"""Shared helpers for the shanti-ops E2E test scripts (phaseN_*.py).

Talks to the real running dev server (http://localhost:3000) over the real API,
and to the real Turso DB directly (HTTP pipeline API) only for test-data reset/
inspection between runs — never as a shortcut around the app's own business logic.
"""
import json
import os
import re

import requests

BASE = "http://localhost:3000"


def _load_env(path=".env.local"):
    env = {}
    if os.path.exists(path):
        for line in open(path):
            m = re.match(r"^([A-Z_]+)=(.*)$", line.strip())
            if m:
                env[m.group(1)] = m.group(2)
    return env


_ENV = _load_env()
TURSO_URL = _ENV.get("TURSO_URL", "")
TURSO_TOKEN = _ENV.get("TURSO_AUTH_TOKEN", "")


def _turso_pipeline(sql, args=None):
    host = TURSO_URL.replace("libsql://", "https://")
    payload = {"requests": [
        {"type": "execute", "stmt": {"sql": sql, "args": [
            {"type": "integer" if isinstance(a, int) else "text", "value": str(a)} for a in (args or [])
        ]}},
        {"type": "close"},
    ]}
    r = requests.post(f"{host}/v2/pipeline", headers={"Authorization": f"Bearer {TURSO_TOKEN}"},
                       json=payload, timeout=60)
    r.raise_for_status()
    result = r.json()["results"][0]
    if result["type"] == "error":
        raise RuntimeError(result["error"]["message"])
    return result["response"]["result"]


def turso_execute(sql, args=None):
    """Runs one write/DDL statement against the real Turso DB via its HTTP pipeline API."""
    return _turso_pipeline(sql, args)


def turso_query(sql, args=None):
    """Runs one SELECT against the real Turso DB, returning a list of dicts (column name -> value)."""
    result = _turso_pipeline(sql, args)
    cols = [c["name"] for c in result["cols"]]
    return [dict(zip(cols, [cell.get("value") for cell in row])) for row in result["rows"]]


def api(session, method, path, **kw):
    return session.request(method, f"{BASE}{path}", timeout=120, **kw)


def must_ok(r, label):
    if not r.ok:
        raise RuntimeError(f"{label} failed [{r.status_code}]: {r.text[:400]}")
    return r.json() if r.text else {}


def login(session, username="admin", password="admin123"):
    r = api(session, "POST", "/api/login", json={"username": username, "password": password})
    return must_ok(r, f"login({username})")

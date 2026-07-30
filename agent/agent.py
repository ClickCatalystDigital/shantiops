#!/usr/bin/env python3
"""Device approval agent (USB storage + CD/DVD). Detects devices, blocks them at the OS
level until a manager approves the request from the dashboard, then unblocks for a
time-boxed window. Counterpart backend: app/api/agent/requests/route.js + lib/usb.js.

Usage:
    python3 agent.py                 # real Windows enforcement (needs pywin32 + wmi, admin)
    python3 agent.py --simulate      # fake devices from agent/sim_events.txt, for macOS dev
    python3 agent.py --selftest      # state-machine assertions against stubs, no server needed
    python3 agent.py --winselftest   # real registry round-trip (Windows only, needs admin)
"""
import argparse
import json
import logging
import os
import sys
import time
from pathlib import Path

import requests

__version__ = "1.2.1"
log = logging.getLogger("usb-agent")

# PyInstaller extracts to a temp dir at runtime, so a frozen build can't keep config next to
# the script — it lives in ProgramData instead, matching where the installer writes it.
if getattr(sys, "frozen", False):
    CONFIG_PATH = Path(os.environ.get("PROGRAMDATA", r"C:\ProgramData")) / "ShantiAgent" / "config.json"
else:
    CONFIG_PATH = Path(__file__).parent / "config.json"
# The scheduled task runs this headless (no console, as SYSTEM) — without a file, a startup
# crash (bad enroll code, blocked network, ...) leaves zero trace anywhere.
LOG_PATH = CONFIG_PATH.parent / "agent.log"


def load_config():
    with open(CONFIG_PATH) as f:
        return json.load(f)


def ensure_token(config):
    """Zero-typing enrollment: if there's no token yet, redeem an enroll code (from a sidecar
    shanti-enroll.json dropped next to config, or an inline enroll_code) for the machine token,
    then persist it. Falls back to the existing token when one is already present."""
    if config.get("token"):
        return config

    sidecar = CONFIG_PATH.parent / "shanti-enroll.json"
    if sidecar.exists():
        with open(sidecar) as f:
            enroll = json.load(f)
        server_url = enroll.get("server_url") or config.get("server_url")
        code = enroll.get("enroll_code")
    else:
        server_url = config.get("server_url")
        code = config.get("enroll_code")

    if not (server_url and code):
        raise SystemExit("no token and no enroll code — cannot start")

    r = requests.post(f"{server_url.rstrip('/')}/api/agent/enroll", json={"code": code}, timeout=15)
    if not r.ok:
        raise SystemExit(f"enrollment failed: {r.status_code} {r.text}")
    token = r.json()["token"]

    config = {"server_url": server_url, "token": token, "poll_seconds": config.get("poll_seconds", 5)}
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2)
    if sidecar.exists():
        sidecar.unlink()   # consumed — don't leave the code lying around
    log.info("enrolled successfully; token stored")
    return config


def fingerprint(d):
    return (d.get("kind", "usb"), d["vendor_id"], d["product_id"], d.get("serial", ""))


def _is_newer(candidate, current):
    """True if version string `candidate` is newer than `current` (numeric, dot-separated).
    Tuple compare, not string — so 1.10.0 > 1.9.0. Non-numeric or missing → not newer."""
    def parse(v):
        try:
            return tuple(int(x) for x in str(v).split("."))
        except (ValueError, AttributeError):
            return None
    a, b = parse(candidate), parse(current)
    return a is not None and b is not None and a > b


class Agent:
    """States: BLOCKED (default / fail-safe) -> PENDING (request filed) -> APPROVED (unlocked).
    Rejection, revocation, expiry, or device removal all snap back to BLOCKED."""

    def __init__(self, backend, server_url, token, poll_seconds=5, browser_guard=None):
        self.backend = backend
        self.server_url = server_url.rstrip("/")
        self.token = token
        self.poll_seconds = poll_seconds
        self.browser_guard = browser_guard   # optional BrowserGuard; separate from device state machine
        self.state = "BLOCKED"
        self.tracked_device = None   # device this request/approval is about
        self.expires_at = None       # epoch ms, mirrors the server's usb_requests.expires_at
        self._warned_version = None  # avoid re-logging "update available" every poll
        self._update_attempted = None  # version we've already tried to self-install (once per version)
        self.backend.block()         # fail-safe: always start locked down

    def _headers(self):
        return {"Authorization": f"Bearer {self.token}", "X-Agent-Version": __version__}

    def _post_request(self, device):
        r = requests.post(f"{self.server_url}/api/agent/requests", json=device, headers=self._headers(), timeout=10)
        r.raise_for_status()
        return r.json()

    def _poll(self):
        r = requests.get(f"{self.server_url}/api/agent/requests", headers=self._headers(), timeout=10)
        r.raise_for_status()
        return r.json()

    def tick(self):
        try:
            present = self.backend.list_devices()
        except Exception:
            log.exception("device enumeration failed")
            present = []

        if self.state == "BLOCKED":
            # ponytail: posts present[0] without checking for a second device already sitting
            # alongside it — if the tracked device has a still-live approval, this can flap
            # block/unblock every poll_seconds while an intruder stays plugged in (verified in
            # E2E: never stays open past one cycle). Fine for v1; check all of `present` here
            # if flapping needs to become "stay blocked" instead.
            if present:
                try:
                    resp = self._post_request(present[0])
                except requests.RequestException:
                    log.warning("server unreachable, staying blocked")
                    return
                self._apply(resp, present[0])
            return

        # Device-swap guard: the registry block is global, so an unapproved second stick
        # must not ride an open (or about-to-open) window alongside the tracked one.
        if self.tracked_device and present:
            others = [d for d in present if fingerprint(d) != fingerprint(self.tracked_device)]
            if others:
                log.warning("unapproved device present alongside tracked one — blocking")
                self._block()
                return

        if self.state == "APPROVED" and not present:
            log.info("device removed — blocking")
            self._block()
            return

        # Local clock enforces expiry too — server unreachable must not mean "stay open".
        if self.state == "APPROVED" and self.expires_at and time.time() * 1000 > self.expires_at:
            log.info("approval window elapsed locally — blocking")
            self._block()
            return

        try:
            resp = self._poll()
        except requests.RequestException:
            log.warning("server unreachable during poll")
            return
        self._apply(resp, self.tracked_device)

    def _apply(self, resp, device):
        self.maybe_self_update(resp.get("latest_version"), resp.get("update_url"))

        status = resp.get("status")
        if status == "approved":
            kind = (device or {}).get("kind", "usb")
            if self.state != "APPROVED":
                self.backend.unblock(kind)
                log.info("APPROVED — unblocked %s (%s)", kind, device)
            self.state = "APPROVED"
            self.tracked_device = device
            self.expires_at = resp.get("expires_at")
        elif status == "pending":
            self.state = "PENDING"
            self.tracked_device = device
        else:  # rejected | revoked | expired | idle
            if self.state != "BLOCKED":
                log.info("%s — blocking", status)
            self._block()

    def _block(self):
        self.backend.block()
        self.state = "BLOCKED"
        self.tracked_device = None
        self.expires_at = None

    def maybe_self_update(self, latest_version, update_url):
        """If the server advertises a newer version + an installer URL, self-install it.
        Attempted at most once per target version; a failed download just logs and keeps
        running (retried only when the server advertises a different newer version)."""
        if not (update_url and _is_newer(latest_version, __version__)):
            return
        if self._update_attempted == latest_version:
            return
        self._update_attempted = latest_version
        log.info("self-updating %s -> %s from %s", __version__, latest_version, update_url)
        self._run_update(update_url)

    def _run_update(self, update_url):
        """Download the installer and launch it silently, then hard-exit so the running exe is
        unlocked and the installer can replace it (its [Run] schtasks /run restarts the agent).
        On any failure, log and return WITHOUT exiting — a broken update must not kill enforcement."""
        import subprocess
        import tempfile
        try:
            r = requests.get(update_url, timeout=120)
            r.raise_for_status()
            path = Path(tempfile.gettempdir()) / "ShantiAgentSetup.exe"
            path.write_bytes(r.content)
        except (requests.RequestException, OSError) as e:
            log.warning("update download failed, staying on current version: %s", e)
            return
        try:
            subprocess.Popen([str(path), "/VERYSILENT", "/SUPPRESSMSGBOXES", "/NORESTART"],
                             close_fds=True)
        except OSError as e:
            log.warning("update launch failed: %s", e)
            return
        # ponytail: exit immediately so the exe unlocks before the installer's file copy; the SYSTEM
        # task's registry/DNR blocks persist during the ~10s gap, so enforcement stays on.
        log.info("update launched; exiting for replacement")
        os._exit(0)

    def run_forever(self):
        while True:
            self.tick()
            if self.browser_guard:
                self.browser_guard.refresh()   # sync browser policy + grants each cycle
            time.sleep(self.poll_seconds)


def selftest():
    """State-machine assertions against a stub backend and stubbed HTTP — no server or
    Windows required. The one runnable check for this file's branching logic."""
    import unittest.mock as mock

    class StubBackend:
        def __init__(self):
            self.blocked = {"usb": True, "cd": True, "phone": True}
            self.devices = []

        def block(self): self.blocked = {"usb": True, "cd": True, "phone": True}
        def unblock(self, kind="usb"): self.blocked[kind] = False
        def is_blocked(self, kind="usb"): return self.blocked[kind]
        def list_devices(self): return self.devices

    class FakeResponse:
        def __init__(self, data): self._data = data
        def raise_for_status(self): pass
        def json(self): return self._data

    post_response = {"id": 1, "status": "pending", "expires_at": None}
    poll_response = {}

    def fake_post(url, json=None, headers=None, timeout=None):
        return FakeResponse(post_response)

    def fake_get(url, headers=None, timeout=None):
        return FakeResponse(poll_response)

    backend = StubBackend()
    agent = Agent(backend, "http://test", "t", poll_seconds=0)
    usb_device = {"kind": "usb", "vendor_id": "0781", "product_id": "5567", "serial": "X"}

    with mock.patch("requests.post", fake_post), mock.patch("requests.get", fake_get):
        backend.devices = [usb_device]
        agent.tick()  # BLOCKED -> POST -> pending
        assert agent.state == "PENDING", agent.state
        assert backend.blocked["usb"] is True

        poll_response = {"id": 1, "status": "approved", "expires_at": (time.time() + 60) * 1000}
        agent.tick()  # PENDING -> poll -> approved
        assert agent.state == "APPROVED", agent.state
        assert backend.blocked["usb"] is False

        # Device-swap guard: a second, different device appears while approved -> re-block.
        backend.devices.append({"kind": "usb", "vendor_id": "aaaa", "product_id": "bbbb", "serial": "Y"})
        agent.tick()
        assert agent.state == "BLOCKED", agent.state
        assert backend.blocked["usb"] is True

        # Re-approve (fresh request, since state reset cleared tracked_device), then remove
        # the device entirely -> re-block.
        post_response = {"id": 2, "status": "approved", "expires_at": (time.time() + 60) * 1000}
        backend.devices = [usb_device]
        agent.tick()  # BLOCKED -> POST -> approved directly
        assert agent.state == "APPROVED", agent.state
        assert backend.blocked["usb"] is False
        backend.devices = []
        agent.tick()
        assert agent.state == "BLOCKED", agent.state
        assert backend.blocked["usb"] is True

        # CD/DVD: approving a disc unblocks only 'cd', leaves USB storage still blocked.
        cd_device = {"kind": "cd", "vendor_id": "0000", "product_id": "0000", "serial": "1A2B3C4D"}
        post_response = {"id": 3, "status": "approved", "expires_at": (time.time() + 60) * 1000}
        backend.devices = [cd_device]
        agent.tick()
        assert agent.state == "APPROVED", agent.state
        assert backend.blocked["cd"] is False
        assert backend.blocked["usb"] is True, "approving a disc must not open USB storage"

        # Cross-kind swap guard: a USB stick appears alongside the approved disc -> re-block all.
        backend.devices.append(usb_device)
        agent.tick()
        assert agent.state == "BLOCKED", agent.state
        assert backend.blocked["cd"] is True and backend.blocked["usb"] is True

        # Phone (MTP/WPD): approving a phone unblocks only 'phone', leaves USB storage blocked.
        phone_device = {"kind": "phone", "vendor_id": "05ac", "product_id": "12a8", "serial": "SN9"}
        post_response = {"id": 4, "status": "approved", "expires_at": (time.time() + 60) * 1000}
        backend.devices = [phone_device]
        agent.tick()
        assert agent.state == "APPROVED", agent.state
        assert backend.blocked["phone"] is False
        assert backend.blocked["usb"] is True, "approving a phone must not open USB storage"

    # Version compare
    assert _is_newer("1.2.0", "1.1.0")
    assert _is_newer("1.10.0", "1.9.0"), "numeric compare, not string"
    assert not _is_newer("1.1.0", "1.1.0")
    assert not _is_newer("1.0.0", "1.2.0")
    assert not _is_newer(None, "1.0.0")

    # Self-update trigger: fires once for a newer version + url, skips when same/older/no-url.
    calls = []
    agent._run_update = lambda url: calls.append(url)
    agent.maybe_self_update("9.9.9", "http://x/setup.exe")
    assert calls == ["http://x/setup.exe"], "should trigger for a newer version"
    agent.maybe_self_update("9.9.9", "http://x/setup.exe")
    assert len(calls) == 1, "should not re-trigger for the same version"
    agent.maybe_self_update("0.0.1", "http://x/setup.exe")
    assert len(calls) == 1, "should not trigger for an older version"
    agent.maybe_self_update("9.9.10", None)
    assert len(calls) == 1, "should not trigger without an update_url"

    print("selftest OK")


def winselftest():
    """Real registry round-trip on Windows — the genuine test CI's windows-latest runner can
    do that macOS never can. Saves and restores prior state; exits nonzero on failure."""
    from backends import WindowsBackend, USBSTOR_KEY

    winreg = __import__("winreg")
    backend = WindowsBackend()

    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, USBSTOR_KEY, 0, winreg.KEY_READ) as k:
        original_start, _ = winreg.QueryValueEx(k, "Start")

    try:
        backend.block()
        assert backend.is_blocked("usb") is True, "USBSTOR did not report blocked after block()"
        assert backend.is_blocked("cd") is True, "CD policy did not report blocked after block()"
        assert backend.is_blocked("phone") is True, "WPD policy did not report blocked after block()"

        backend.unblock("usb")
        assert backend.is_blocked("usb") is False, "USBSTOR still blocked after unblock('usb')"
        assert backend.is_blocked("cd") is True, "unblock('usb') must not touch the cd channel"
        assert backend.is_blocked("phone") is True, "unblock('usb') must not touch the phone channel"

        backend.unblock("cd")
        assert backend.is_blocked("cd") is False, "CD policy still blocked after unblock('cd')"
        assert backend.is_blocked("phone") is True, "unblock('cd') must not touch the phone channel"

        backend.unblock("phone")
        assert backend.is_blocked("phone") is False, "WPD policy still blocked after unblock('phone')"

        devices = backend.list_devices()
        assert isinstance(devices, list), "list_devices() must return a list"
        print(f"list_devices() ok, {len(devices)} device(s) currently present")
    finally:
        backend._set_start(original_start)
        backend._set_cd_deny(False)
        backend._set_wpd_deny(False)

    print("winselftest OK")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--simulate", action="store_true", help="use the file-based simulator backend")
    parser.add_argument("--selftest", action="store_true", help="run state-machine assertions and exit")
    parser.add_argument("--winselftest", action="store_true", help="real registry round-trip (Windows only)")
    args = parser.parse_args()

    LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                         handlers=[logging.FileHandler(LOG_PATH), logging.StreamHandler()])

    if args.selftest:
        selftest()
        return
    if args.winselftest:
        winselftest()
        return

    try:
        from backends import SimulatorBackend, WindowsBackend
        from browser import BrowserGuard
        config = ensure_token(load_config())
        backend = SimulatorBackend() if args.simulate else WindowsBackend()
        guard = BrowserGuard(config["server_url"], config["token"], __version__)
        guard.start()   # localhost HTTP server for the browser extension
        agent = Agent(backend, config["server_url"], config["token"], config.get("poll_seconds", 5),
                      browser_guard=guard)
    except Exception:
        log.exception("startup failed — see %s", LOG_PATH)
        raise
    agent.run_forever()


if __name__ == "__main__":
    main()

# Mechanism ports (from market-intel)

The canonical definition of each mechanism is in the market-intel repository: `mechanisms/<id>/v<n>/spec.yaml` and
`vectors.json`. The files here are **ports**: a JavaScript copy of the formula and a copy of the reference vectors.

- `vectors/<id>@<n>.json` is a byte-for-byte copy of the canonical `vectors.json`.
- `PINS.json` records the sha256 of each copy. `lib/mechanisms-selfcheck.mjs` fails if a copy's hash differs from its pin, or if a
  port is outside tolerance on any vector. `market-intel/tests/test_port_parity.py` fails if a pin differs from the canonical file.
- A mechanism version is immutable. To change a formula, add `v2` in market-intel, regenerate its vectors, copy them here, update
  the pin, and add a second port: never edit the `@1` port.
- Ports are pure: no database, no network, no imports from the rest of the app. Do not add one that is.

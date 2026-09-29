#!/usr/bin/env python3
"""Decode one auto-saved javascript_tool result file (from the SalesMantra quotation extraction
loop) and append its `results` array to a running JSONL file, one quotation per line.
Usage: python3 decode_batch.py <tool-result-file> <output-jsonl-file>
"""
import json, re, sys

def decode(path):
    d = json.load(open(path))
    inner = d[0]['text']
    inner = re.sub(r'\n\n\(captured at origin.*\)\s*$', '', inner)
    # the payload may be single- or double-JSON-encoded depending on size; handle both
    parsed = json.loads(inner)
    if isinstance(parsed, str):
        parsed = json.loads(parsed)
    return parsed

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    data = decode(src)
    results = data['results']
    with open(out, 'a') as f:
        for r in results:
            f.write(json.dumps(r) + '\n')
    errs = [r for r in results if r.get('error')]
    print(f"start={data['start']} count={data['count']} loggedOut={data['loggedOut']} errors={data['errors']}")
    if errs:
        print('  error ids:', [(r['id'], r['error']) for r in errs])

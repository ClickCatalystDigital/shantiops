#!/usr/bin/env python3
"""Decode an auto-saved javascript_tool result file that is a JSON.stringify'd array
(from window.__resultsBuffer dumps) and append it to quotations.jsonl.
Usage: python3 decode_dump.py <tool-result-file> <output-jsonl-file>
"""
import json, re, sys

def decode(path):
    d = json.load(open(path))
    inner = d[0]['text']
    inner = re.sub(r'\n\n\(captured at origin.*\)\s*$', '', inner)
    parsed = json.loads(inner)
    if isinstance(parsed, str):
        parsed = json.loads(parsed)
    return parsed

if __name__ == '__main__':
    src, out = sys.argv[1], sys.argv[2]
    results = decode(src)
    with open(out, 'a') as f:
        for r in results:
            f.write(json.dumps(r) + '\n')
    errs = [r for r in results if r.get('error')]
    print(f"appended={len(results)}")
    if errs:
        print('  error ids:', [(r['id'], r['error']) for r in errs])

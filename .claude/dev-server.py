#!/usr/bin/env python3
"""Static dev server with caching disabled.

The plain `python3 -m http.server` sends no Cache-Control header, so browsers
heuristically cache the ES modules and serve stale game code after an edit
(hard to notice, maddening to debug). This wrapper is identical except every
response carries `Cache-Control: no-store`, so a plain reload always runs the
code that's on disk. Used by .claude/launch.json.
"""
import http.server
import os
import sys


class NoStoreHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


if __name__ == '__main__':
    port = int(sys.argv[1] if len(sys.argv) > 1 else os.environ.get('PORT', 8642))
    http.server.test(HandlerClass=NoStoreHandler, port=port)

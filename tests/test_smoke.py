# -*- coding: utf-8 -*-
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app import Handler
from workspace import ensure_dirs, load_workspace


class SmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        ensure_dirs()
        load_workspace()
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.port = cls.server.server_address[1]
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.base = f"http://127.0.0.1:{cls.port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()

    def get(self, path: str):
        req = urllib.request.Request(self.base + path, method="GET")
        with urllib.request.urlopen(req, timeout=8) as resp:
            return resp.status, resp.headers.get("Content-Type", ""), resp.read()

    def get_json(self, path: str):
        status, mime, body = self.get(path)
        self.assertEqual(status, 200)
        self.assertIn("json", mime)
        return json.loads(body.decode("utf-8"))

    def test_index_and_modules(self):
        status, mime, body = self.get("/")
        self.assertEqual(status, 200)
        html = body.decode("utf-8")
        self.assertIn("app.js", html)
        self.assertIn("text/html", mime)

        status, _, js = self.get("/static/js/dialogue-util.js")
        self.assertEqual(status, 200)
        text = js.decode("utf-8")
        self.assertIn("export function dialogueVisible", text)
        self.assertIn("export function parseBulk", text)

        status, _, dlg = self.get("/static/js/dialogue.js")
        self.assertEqual(status, 200)
        self.assertIn("dialogue-util.js", dlg.decode("utf-8"))

        status, _, app = self.get("/static/js/app.js")
        self.assertEqual(status, 200)
        self.assertGreater(len(app), 20)

    def test_boot_apis(self):
        ws = self.get_json("/api/workspace")
        self.assertIsInstance(ws, dict)

        pages = self.get_json("/api/pages")
        self.assertIn("pages", pages)
        self.assertIsInstance(pages["pages"], list)

        fonts = self.get_json("/api/fonts")
        self.assertIsInstance(fonts, dict)

        project = self.get_json("/api/project")
        self.assertIsInstance(project, dict)

        settings = self.get_json("/api/settings")
        self.assertTrue(settings.get("ok"))
        self.assertIn("settings", settings)

        if pages["pages"]:
            first = pages["pages"][0]
            status, _, data = self.get(first["url"].split("?")[0])
            self.assertEqual(status, 200)
            self.assertGreater(len(data), 8)

    def test_unknown_api_is_404(self):
        with self.assertRaises(urllib.error.HTTPError) as ctx:
            self.get("/api/not-a-real-route")
        self.assertEqual(ctx.exception.code, 404)


if __name__ == "__main__":
    unittest.main()

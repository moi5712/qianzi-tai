# -*- coding: utf-8 -*-
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from local_ocr import _LARGE_AREA, _LOW_CONF, _SHORT_SRC, _needs_crop_reread, probe_sample


class NeedsCropRereadTests(unittest.TestCase):
    def test_confident_normal_box_skips(self):
        item = {"src": "こんにちは", "score": 0.9, "w": 80, "h": 120}
        self.assertFalse(_needs_crop_reread(item, 1000, 1400))

    def test_low_confidence_retries(self):
        item = {"src": "こんにちは", "score": _LOW_CONF - 0.01, "w": 80, "h": 120}
        self.assertTrue(_needs_crop_reread(item, 1000, 1400))

    def test_short_src_retries(self):
        item = {"src": "あ", "score": 0.99, "w": 80, "h": 120}
        self.assertEqual(len("あ"), _SHORT_SRC - 1)
        self.assertTrue(_needs_crop_reread(item, 1000, 1400))

    def test_large_area_retries(self):
        img_w, img_h = 1000, 1000
        side = int((img_w * img_h * _LARGE_AREA) ** 0.5) + 20
        item = {"src": "長い對白文字", "score": 0.99, "w": side, "h": side}
        self.assertTrue(_needs_crop_reread(item, img_w, img_h))


class ProbeApiTests(unittest.TestCase):
    def test_probe_sample_is_public(self):
        self.assertTrue(callable(probe_sample))


if __name__ == "__main__":
    unittest.main()

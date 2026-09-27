# -*- coding: utf-8 -*-
import io
import unittest
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from auto_letter import extract_json, scale_box, to_box


class ToBoxTests(unittest.TestCase):
    def test_normalized_coords_scale_to_pixels(self):
        box = to_box({"x": 0.1, "y": 0.2, "w": 0.3, "h": 0.4, "vertical": False}, 1000, 2000)
        self.assertEqual(box["x"], 100)
        self.assertEqual(box["y"], 400)
        self.assertEqual(box["w"], 300)
        self.assertEqual(box["h"], 800)
        self.assertFalse(box["vertical"])

    def test_pixel_coords_stay_pixels(self):
        box = to_box({"x": 40, "y": 80, "w": 120, "h": 60, "vertical": True}, 800, 600)
        self.assertEqual((box["x"], box["y"], box["w"], box["h"]), (40, 80, 120, 60))
        self.assertTrue(box["vertical"])

    def test_min_size_and_clamp(self):
        box = to_box({"x": -10, "y": 590, "w": 1, "h": 1}, 800, 600)
        self.assertEqual(box["x"], 0)
        self.assertGreaterEqual(box["w"], 8)
        self.assertGreaterEqual(box["h"], 8)
        self.assertLessEqual(box["y"] + box["h"], 600)


class ScaleBoxTests(unittest.TestCase):
    def test_same_size_unchanged(self):
        src = {"x": 10, "y": 20, "w": 30, "h": 40, "vertical": True}
        self.assertEqual(scale_box(src, 800, 600, 800, 600), src)

    def test_sent_half_maps_back_to_original(self):
        box = scale_box({"x": 50, "y": 40, "w": 100, "h": 80, "vertical": False}, 500, 400, 1000, 800)
        self.assertEqual(box["x"], 100)
        self.assertEqual(box["y"], 80)
        self.assertEqual(box["w"], 200)
        self.assertEqual(box["h"], 160)

    def test_scale_then_clamp_to_original(self):
        box = scale_box({"x": 490, "y": 10, "w": 20, "h": 20, "vertical": False}, 500, 400, 1000, 800)
        self.assertEqual(box["x"], 980)
        self.assertLessEqual(box["x"] + box["w"], 1000)


class ExtractJsonTests(unittest.TestCase):
    def test_fenced_object(self):
        data = extract_json("```json\n{\"items\":[1]}\n```")
        self.assertEqual(data, {"items": [1]})

    def test_empty_raises(self):
        with self.assertRaises(ValueError):
            extract_json("   ")


class EncodeScaleContractTests(unittest.TestCase):
    def test_encode_returns_original_and_sent_size(self):
        from PIL import Image
        from auto_letter import encode_page_image

        img = Image.new("RGB", (2000, 1000), "white")
        buf = io.BytesIO()
        path = ROOT / "tests" / "_tmp_page.jpg"
        path.parent.mkdir(parents=True, exist_ok=True)
        img.save(path, "JPEG")
        try:
            _b64, orig_w, orig_h, sent_w, sent_h = encode_page_image(path, 1000)
            self.assertEqual((orig_w, orig_h), (2000, 1000))
            self.assertEqual(max(sent_w, sent_h), 1000)
            self.assertLess(sent_w, orig_w)
        finally:
            path.unlink(missing_ok=True)


if __name__ == "__main__":
    unittest.main()

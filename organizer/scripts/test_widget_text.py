import importlib.util
import unittest
from pathlib import Path

spec = importlib.util.spec_from_file_location("widget_text", Path(__file__).with_name("check-widget-text.py"))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class WidgetTextTests(unittest.TestCase):
    def check(self, text):
        return module.issues({"sections": [{"items": [{"text": text}]}]})

    def test_missing_word_time_and_duration_spaces(self):
        for text in ("Vor11:22 prüfen", "08:30Handshaken", "ACM13:15–16:30",
                     "Einkauf14–15", "jeweils15Minuten", "keinen15-Minuten-Slot",
                     "amFreitag18:15", "VorbereitungDi10:15", "für04Nov",
                     "geprüft.15Minuten", "nötig:08:30", "PDFs vorhanden;15Min Vorlauf"):
            with self.subTest(text=text):
                self.assertTrue(self.check(text))

    def test_legitimate_versions_ranges_and_compounds(self):
        for text in ("Vor 11:22 prüfen", "ACM 13:15–16:30", "15-Minuten-Slot",
                     "Example paper 1.0/2.0", "pwn01_01", "iPhone", "ACM-Gruppe",
                     "Di 04. Nov., 10:15 Uhr", "45–90 Minuten", "24h"):
            with self.subTest(text=text):
                self.assertFalse(self.check(text))

    def test_all_display_fields_and_no_mutation(self):
        board = {"verified_at": "unchanged", "sections": [{"title": "amDienstag", "items": [
            {"label": "um19:00", "mobile_label": "Vor11:22", "mobile_text": "15Minuten",
             "action": {"url": "https://example.com/Vor11:22"}}]}]}
        import copy
        before = copy.deepcopy(board)
        self.assertEqual(len(module.issues(board)), 4)
        self.assertEqual(board, before)
        self.assertFalse(module.issues({"sections": [{"items": [{"action": {
            "url": "https://example.com/Vor11:22"}}]}]}))


if __name__ == "__main__":
    unittest.main()

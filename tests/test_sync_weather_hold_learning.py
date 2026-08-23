import importlib.util
import pathlib
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location(
    "sync_weather_hold_learning", ROOT / "sync_weather_hold_learning.py"
)
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC and SPEC.loader
SPEC.loader.exec_module(MODULE)


class ConfigurationNormalizationTests(unittest.TestCase):
    def test_first_non_empty_removes_leading_bom_from_secret(self):
        self.assertEqual(
            MODULE.first_non_empty("\ufeffservice-role-key"),
            "service-role-key",
        )

    def test_first_non_empty_handles_whitespace_around_bom(self):
        self.assertEqual(
            MODULE.first_non_empty("  \ufeff  https://example.supabase.co  "),
            "https://example.supabase.co",
        )

    def test_supabase_headers_are_latin1_encodable_after_normalization(self):
        key = MODULE.first_non_empty("\ufeffexample-key")
        headers = MODULE.SupabaseRest("https://example.invalid", key).headers()
        for value in headers.values():
            value.encode("latin-1")


if __name__ == "__main__":
    unittest.main()

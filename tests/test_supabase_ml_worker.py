import unittest

from supabase_ml_worker import InventoryEntry, InventoryMatcher, map_model_grade_to_app_grade, parse_label_entry


class GradeMappingTests(unittest.TestCase):
    def test_a_grade_uses_selected_s1_or_f1_season(self):
        self.assertEqual(map_model_grade_to_app_grade("A", "S1"), "S1")
        self.assertEqual(map_model_grade_to_app_grade("A", "F1"), "F1")

    def test_lower_grades_map_to_app_move_up_codes(self):
        self.assertEqual(map_model_grade_to_app_grade("B", "F1"), "U1")
        self.assertEqual(map_model_grade_to_app_grade("C", "F1"), "U2")
        self.assertEqual(map_model_grade_to_app_grade("D", "F1"), "U3")
        self.assertEqual(map_model_grade_to_app_grade("X", "F1"), "X")


class LabelParsingTests(unittest.TestCase):
    def test_pipe_label_parses_genus_common_name_and_grade(self):
        label = parse_label_entry("Acer|Autumn Blaze Maple|A")
        self.assertEqual(label["genus"], "Acer")
        self.assertEqual(label["common_name"], "Autumn Blaze Maple")
        self.assertEqual(label["grade"], "A")


class InventoryMatcherTests(unittest.TestCase):
    def test_exact_common_name_match(self):
        matcher = InventoryMatcher([InventoryEntry(genus="Cercis", common_name="Cotton Candy Redbud", itemcode="123")])
        entry, score = matcher.match("Cercis", "Cotton Candy Redbud")
        self.assertIsNotNone(entry)
        self.assertEqual(entry.itemcode, "123")
        self.assertGreaterEqual(score, 0.98)

    def test_fuzzy_common_name_match(self):
        matcher = InventoryMatcher([InventoryEntry(genus="Cercis", common_name="Cotton Candy Redbud", itemcode="123")])
        entry, score = matcher.match("Cercis", "Cotton Candy Red Bud")
        self.assertIsNotNone(entry)
        self.assertEqual(entry.itemcode, "123")
        self.assertGreater(score, 0.75)


if __name__ == "__main__":
    unittest.main()

import unittest

from rkive.visibility import DEFAULT_VISIBILITY, ORG_PUBLIC, SALES_PRIVATE, normalize_visibility


class VisibilityTests(unittest.TestCase):
    def test_normalize_visibility_maps_legacy_public_value(self):
        self.assertEqual(normalize_visibility("public"), ORG_PUBLIC)

    def test_normalize_visibility_maps_sales_alias(self):
        self.assertEqual(normalize_visibility("sales-private"), SALES_PRIVATE)

    def test_normalize_visibility_uses_default_for_empty_values(self):
        self.assertEqual(normalize_visibility(""), DEFAULT_VISIBILITY)
        self.assertEqual(normalize_visibility(None), DEFAULT_VISIBILITY)

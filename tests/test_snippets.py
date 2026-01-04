import unittest
from src.engine.core.snippets import SnippetGenerator

class TestSnippetGenerator(unittest.TestCase):
    def setUp(self):
        self.generator = SnippetGenerator()
        
        # Test data: 100x50 box located at (10, 20)
        self.bounds = {
            "x": 10,
            "y": 20,
            "width": 100,
            "height": 50
        }
        # Safe zone might differ, but generator currently favors layout_bounds
        self.safe_zone = {
            "x": 12,
            "y": 22,
            "width": 96,
            "height": 46
        }

    def test_tailwind_absolute(self):
        snippets = self.generator.generate_all(self.safe_zone, self.bounds)
        expected = "absolute left-[10px] top-[20px] w-[100px] h-[50px]"
        self.assertEqual(snippets["tailwind_absolute"], expected)

    def test_css_absolute(self):
        snippets = self.generator.generate_all(self.safe_zone, self.bounds)
        self.assertIn("left: 10px;", snippets["css_absolute"])
        self.assertIn("top: 20px;", snippets["css_absolute"])
        self.assertIn("width: 100px;", snippets["css_absolute"])
        self.assertIn("height: 50px;", snippets["css_absolute"])

    def test_react_native_absolute(self):
        snippets = self.generator.generate_all(self.safe_zone, self.bounds)
        self.assertIn("left: 10", snippets["react_native_absolute"])
        self.assertIn("width: 100", snippets["react_native_absolute"])
        self.assertIn("position: 'absolute'", snippets["react_native_absolute"])

    def test_swift_uikit(self):
        snippets = self.generator.generate_all(self.safe_zone, self.bounds)
        expected = "CGRect(x: 10, y: 20, width: 100, height: 50)"
        self.assertEqual(snippets["swift_uikit"], expected)

    def test_kotlin_compose(self):
        snippets = self.generator.generate_all(self.safe_zone, self.bounds)
        expected = "Modifier.offset(x = 10.dp, y = 20.dp).size(width = 100.dp, height = 50.dp)"
        self.assertEqual(snippets["kotlin_compose"], expected)

if __name__ == '__main__':
    unittest.main()

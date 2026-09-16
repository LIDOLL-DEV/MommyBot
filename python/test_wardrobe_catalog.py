"""Exercise import decisions with tiny synthetic artwork, without the external asset archive."""
from pathlib import Path
from tempfile import TemporaryDirectory
from PIL import Image, ImageDraw
import unittest
from wardrobe_catalog import discover

class WardrobeImportTests(unittest.TestCase):
    def test_trouser_family_is_excluded_without_removing_skirts_or_training_pants(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            for name in ["Trousers/TQ_Clothing_Trousers_Jeans_1.png", "Trousers/TQ_Clothing_Trousers_Bloomers_1.png",
                         "Dresses/TQ_Clothing_LatexDungarees_1A.png", "Dresses/TQ_Clothing_LatexDungarees_1B.png",
                         "Skirts/TQ_Clothing_Skirts_Floral.png", "Knickers/TQ_Clothing_Knickers_TrainingPants_1.png"]:
                path = root / "CW" / name
                path.parent.mkdir(parents=True, exist_ok=True)
                Image.new("RGBA", (387, 875), (40, 70, 90, 255)).save(path)
            copied = []
            def copy(path):
                copied.append(path)
                return Path(path).name
            items, report = discover(root, copy, {})
            self.assertEqual([item["image"] for item in items], ["TQ_Clothing_Skirts_Floral.png"])
            self.assertEqual(report["dispositions"]["excluded-trousers"], 4)
            self.assertEqual(report["dispositions"]["atelier-diaper-family"], 1)
            self.assertEqual(len(copied), 1)  # Retirement happens before copying assets or reassembling garment sections.

    def test_sections_variants_faded_copies_and_new_slots(self):
        with TemporaryDirectory() as directory:
            root = Path(directory)
            def art(relative, box, color):
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                image = Image.new("RGBA", (387, 875))
                ImageDraw.Draw(image).rectangle(box, fill=color)
                image.save(path)
            art("CW/Dresses/TQ_Clothing_Gown_1aA.png", (100, 200, 250, 316), (200, 0, 0, 255))
            art("CW/Dresses/TQ_Clothing_Gown_1aAd.png", (100, 200, 250, 316), (200, 0, 0, 128))
            art("CW/Dresses/TQ_Clothing_Gown_1aB.png", (100, 317, 250, 413), (200, 0, 0, 255))
            art("CW/Dresses/TQ_Clothing_Gown_1aC.png", (90, 414, 260, 520), (200, 0, 0, 255))
            art("CW/Dresses/TQ_Clothing_Gown_1bC.png", (90, 414, 260, 530), (0, 0, 200, 255))
            art("CW/Dresses/TQ_Clothing_Bodysuit_2d.png", (110, 220, 230, 450), (0, 200, 0, 255))
            art("CW/Dresses/TQ_Clothing_Bodysuit_2.png", (110, 220, 230, 450), (0, 0, 200, 255))
            art("CW/Dresses/TQ_Clothing_SchoolgirlUniform_3A.png", (110, 220, 240, 510), (0, 80, 200, 255))
            art("CW/Dresses/TQ_Clothing_Gown_1a_BackB.png", (70, 317, 290, 413), (100, 0, 0, 255))
            art("CW/Bags/TQ_Clothing_Bag_1.png", (10, 400, 90, 470), (100, 100, 0, 255))
            art("CW/Equippables/TQ_Clothing_Mittens_1.png", (10, 400, 90, 470), (100, 100, 0, 255))
            art("CW/Knickers/TQ_Clothing_Knickers_Briefs_1.png", (110, 400, 230, 460), (0, 100, 0, 255))
            art("CW/Knickers/TQ_Clothing_Knickers_TrainingPants_1.png", (110, 400, 230, 460), (0, 100, 0, 255))
            copied = []
            def copy(path):
                copied.append(path)
                return Path(path).name
            items, report = discover(root, copy, {})
            variant = next(item for item in items if item["id"] == "tq-clothing-gown-1bc")
            self.assertEqual(variant["parts"], ["TQ_Clothing_Gown_1aB.png", "TQ_Clothing_Gown_1bC.png"])
            original = next(item for item in items if item["id"] == "tq-clothing-gown-1aa")
            self.assertEqual(original["backParts"], ["TQ_Clothing_Gown_1a_BackB.png"])
            self.assertTrue(any(item["image"] == "TQ_Clothing_Bodysuit_2d.png" for item in items))
            uniform = next(item for item in items if item["image"] == "TQ_Clothing_SchoolgirlUniform_3A.png")
            self.assertEqual(uniform["warp"], "auto")  # Reimports preserve the school-uniform fitting fix.
            self.assertTrue(uniform["warpPreserveHem"])
            self.assertEqual(report["dispositions"]["faded-overlay"], 1)
            self.assertTrue(any(item["slot"] == "bag" for item in items))
            self.assertTrue(any(item["slot"] == "gloves" for item in items))
            self.assertFalse(any(path.endswith("1aAd.png") for path in copied))
            self.assertFalse(any(item["slot"] == "underwear" for item in items))
            self.assertEqual(report["dispositions"]["excluded-ordinary-underwear"], 1)
            self.assertEqual(report["dispositions"]["atelier-diaper-family"], 1)

if __name__ == "__main__":
    unittest.main()

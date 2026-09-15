"""Littlepottchi wardrobe editor: preview and tune packaged clothing and diaper fits."""
from pathlib import Path
import argparse
import copy
import json
import subprocess
import tkinter as tk
from tkinter import ttk, messagebox
from PIL import Image, ImageTk

ROOT = Path(__file__).resolve().parents[1]
ART = ROOT / "assets/dressup"
CATALOG = ART / "catalog.json"

def validate():
    return subprocess.run(["node", "--input-type=module", "-e",
        "import {loadDressupCatalog} from './src/dressup/catalog.js'; console.log('Validated', loadDressupCatalog().clothes.length, 'clothing pieces.');"],
        cwd=ROOT, capture_output=True, text=True, check=False)  # Use the same validator as the shipping server.

class WardrobeEditor:
    def __init__(self, root):
        self.root = root
        self.data = json.loads(CATALOG.read_text(encoding="utf-8"))
        self.saved = copy.deepcopy(self.data)
        self.rows = [("clothes", item) for item in self.data["clothes"]] + [("diapers", item) for item in self.data["diapers"]]
        self.visible_rows = list(self.rows)
        root.title("Littlepottchi · Wardrobe & Fit Editor")
        root.geometry("1100x760")
        browser = ttk.Frame(root, padding=12)
        browser.pack(side="left", fill="both")
        ttk.Label(browser, text="Find a garment or stable ID").pack(anchor="w")
        self.search = tk.StringVar()
        ttk.Entry(browser, textvariable=self.search).pack(fill="x", pady=(4, 8))
        self.list = tk.Listbox(browser, width=48, exportselection=False)
        self.list.pack(side="left", fill="both", expand=True)
        scroll = ttk.Scrollbar(browser, orient="vertical", command=self.list.yview)
        scroll.pack(side="right", fill="y")
        self.list.configure(yscrollcommand=scroll.set)
        for group, item in self.rows:
            self.list.insert("end", f"{group}: {item.get('name', item['id'])}")
        self.list.bind("<<ListboxSelect>>", self.select)
        form = ttk.Frame(root, padding=12)
        form.pack(side="left", fill="y")
        self.fields = {}
        for field, values in [("name", None), ("rarity", ["common", "uncommon", "rare", "epic", "legendary"]),
                              ("slot", ["top", "bottom", "shoes", "socks", "head", "bra", "corset", "belt", "gloves", "accessory", "hand", "bag"]), ("fit", ["narrow", "wide", "both"]),
                              ("bulk", None), ("shape", ["soft", "angular"]), ("preview stance", ["narrow", "wide"])]:
            ttk.Label(form, text=field.title()).pack(anchor="w", pady=(12, 3))
            variable = tk.StringVar(value="soft" if field == "shape" else "narrow" if field == "preview stance" else "")
            widget = ttk.Combobox(form, textvariable=variable, values=values, state="readonly") if values else ttk.Entry(form, textvariable=variable)
            widget.pack(fill="x")
            self.fields[field] = (variable, widget)
        ttk.Button(form, text="Preview fit", command=self.preview).pack(fill="x", pady=(20, 8))
        ttk.Button(form, text="Save selected item", command=self.save).pack(fill="x")
        self.messy_preview = tk.BooleanVar(value=False)
        ttk.Checkbutton(form, text="Messy mode camera preview", variable=self.messy_preview).pack(anchor="w", pady=(10, 0))
        ttk.Button(form, text="Preview rear camera", command=self.preview_camera).pack(fill="x")
        ttk.Label(form, text="Diaper fit selects the stance automatically.\nBulk holds both wettings and messy accidents.\nMessy mode uses the shared care rules in\nsrc/dressup/care.js. Preview stance is only\na comparison tool; source art stays fixed.", wraplength=240).pack(pady=20)
        self.status = ttk.Label(form, wraplength=240)
        self.status.pack(fill="x")
        self.canvas = tk.Canvas(root, width=310, height=700, bg="#fff5ef", highlightthickness=0)
        self.canvas.pack(side="left", padx=12, pady=12)
        self.list.selection_set(0)
        self.select()
        self.search.trace_add("write", self.filter_rows)

    def filter_rows(self, *args):
        term = self.search.get().casefold()
        self.visible_rows = [(group, item) for group, item in self.rows if term in f"{item.get('name', '')} {item['id']} {item.get('slot', 'diaper')}".casefold()]
        self.list.delete(0, "end")
        for group, item in self.visible_rows:
            self.list.insert("end", f"{group}: {item.get('name', item['id'])}")
        if self.visible_rows:
            self.list.selection_set(0)
            self.select()  # Filtering keeps selection tied to the matching catalog record.

    def current(self):
        return self.visible_rows[self.list.curselection()[0]]  # Resolve the selected stable catalog ID.

    def select(self, event=None):
        if not self.list.curselection():
            return
        group, item = self.current()
        for key in ["name", "rarity", "slot"]:
            self.fields[key][0].set(item.get(key, ""))
            self.fields[key][1].configure(state="disabled" if group == "diapers" else "normal" if key == "name" else "readonly")
        fit = item.get("stance") or ("both" if len(item["stances"]) == 2 else item["stances"][0])
        self.fields["fit"][0].set(fit)
        self.fields["bulk"][0].set(str(item.get("bulk", "")))
        self.fields["bulk"][1].configure(state="normal" if group == "diapers" else "disabled")
        self.fields["preview stance"][0].set("narrow" if fit == "both" else fit)
        self.fields["fit"][1].configure(values=["narrow", "wide"] if group == "diapers" else ["narrow", "wide", "both"])
        self.status.configure(text=f"ID: {item['id']}\n{self.data['provenance'][item['image']]['source']}")
        self.preview()

    def preview(self):
        if not self.list.curselection():
            return
        group, item = self.current()
        stance, shape = self.fields["preview stance"][0].get(), self.fields["shape"][0].get()
        art = Image.new("RGBA", (387, 875))
        for name in item.get("backParts", []):
            art.alpha_composite(Image.open(ART / name).convert("RGBA"))
        art.alpha_composite(Image.open(ART / self.data["bases"][shape][stance]).convert("RGBA"))
        starter = next(d for d in self.data["diapers"] if d["id"] == "cloud-tapes")
        layers = [starter, next(c for c in self.data["clothes"] if c["image"] == "TQ_Clothing_TShirt_1A.png")]
        if group == "diapers":
            layers = [item, layers[1]]
        elif item["slot"] in ["bra", "corset"]:
            layers = [starter, item]
        else:
            layers.append(item)
        layers = [part for layer in layers for part in [layer] + [{"image": image} for image in layer.get("parts", [])]]
        for layer in layers:
            overlay = Image.open(ART / layer["image"]).convert("RGBA")
            if layer.get("rect"):
                x, y, width, height = layer["rect"]
                art.alpha_composite(overlay.resize((width, height)), (x, y))
            else:
                art.alpha_composite(overlay)
        self.preview_image = ImageTk.PhotoImage(art.resize((310, 700)))
        self.canvas.delete("all")
        self.canvas.create_image(0, 0, anchor="nw", image=self.preview_image)  # Composite only the preview; never rewrite source images.

    def save(self):
        if not self.list.curselection():
            return
        group, item = self.current()
        previous_item = copy.deepcopy(item)
        fit = self.fields["fit"][0].get()
        if group == "diapers":
            try:
                bulk = int(self.fields["bulk"][0].get())
                if not 1 <= bulk <= 100:
                    raise ValueError()
            except ValueError:
                messagebox.showerror("Invalid capacity", "Bulk must be a whole number from 1 to 100 wettings.")
                return
            item["bulk"] = bulk  # Reaching this many wettings triggers a leak; visual stance is tuned separately.
            item["stance"] = fit
        else:
            for key in ["name", "rarity", "slot"]:
                item[key] = self.fields[key][0].get().strip()
            item["stances"] = ["narrow", "wide"] if fit == "both" else [fit]
        previous = CATALOG.read_text(encoding="utf-8")
        try:
            CATALOG.write_text(json.dumps(self.data, indent=2) + "\n", encoding="utf-8")
            result = validate()
            if result.returncode:
                raise ValueError(result.stderr or result.stdout)
            CATALOG.with_suffix(".json.bak").write_text(previous, encoding="utf-8")
            self.saved = copy.deepcopy(self.data)
            self.status.configure(text="Saved and validated. Restart MommyBot to load catalog changes.")
        except Exception as error:
            CATALOG.write_text(previous, encoding="utf-8")
            item.clear()
            item.update(previous_item)
            messagebox.showerror("Catalog was not changed", str(error))  # Restore the previous manifest if validation fails.

    def preview_camera(self):
        if not self.list.curselection():
            return
        group, item = self.current()
        if group == "diapers":
            frames = item["buttcams"]
            name = frames[min(1, len(frames) - 1) if self.messy_preview.get() else 0]
        else:
            name = self.data["bareCameras"][self.fields["shape"][0].get()]
        with Image.open(ART / name) as source:
            art = source.copy()
        art.thumbnail((310, 310))
        self.preview_image = ImageTk.PhotoImage(art)
        self.canvas.delete("all")
        self.canvas.create_image(155, 160, image=self.preview_image)
        self.status.configure(text=name + "\n" + item.get("buttcamNote", ""))  # Preview original frames without editing their source bytes.

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--validate", action="store_true", help="Validate the catalog without opening a window")
    args = parser.parse_args()
    if args.validate:
        result = validate()
        print(result.stdout or result.stderr)
        raise SystemExit(result.returncode)
    app = tk.Tk()
    WardrobeEditor(app)
    app.mainloop()

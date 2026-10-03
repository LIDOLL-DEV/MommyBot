# Contributing clothing

Edit `python/build_piko_clothing.py`. `DESIGNS` defines styles, base item IDs, and
slots; `GRAYSCALE` defines outline, shadow, fabric, highlight, and accent.
Keep 32x32 frame origins and original gait positions. Draw on transparent
layers and use only alpha 0/255. Never crop frames to garment bounds.
Add new stable IDs rather than changing IDs already referenced by game data.
Regenerate into a new folder, inspect the preview, and compare source hashes.
The workspace modding editor also offers a Piko sprite-pack preview launcher.

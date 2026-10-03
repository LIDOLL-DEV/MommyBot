# Clothing generation tuning

Generation is deterministic pixel editing, with no image model or API.
All garments use GRAYSCALE (135, 187, 236, 255); the engine supplies color.
Each design exports one base-item filename; no color variants are generated.
Tops reuse tee shading; longer sleeves follow the body's arm pixels.
Trousers use explicit hip spans to keep hands visible and follow leg pixels.
Skirts and dresses reuse animated hem registration and remove the large bow.
Boot shafts follow the socks; shoe buckles are one pixel per connected foot.
Tune poses in the relevant function before adjusting neutral shading values.
The manifest records source SHA-256 hashes. Preview timing defaults to about
six frames per second; animation timing remains a game integration choice.

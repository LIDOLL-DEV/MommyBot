"""Stage server-to-server LAN pet-bridge support in Little Log."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Scripts\omo-trainer")
OUT = ROOT / "data/little-log-pet-patch"
manifest = []


def stage(relative, transform):
    original = (SOURCE / relative).read_bytes()
    edited = transform(original.decode("utf-8"))
    if edited == original.decode("utf-8"):
        return
    staged = relative + ".payload" if relative.startswith("tests/") else relative
    target = OUT / staged
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(edited, encoding="utf-8", newline="")
    manifest.append({"path": relative, "source": staged, "before": hashlib.sha256(original).hexdigest()})
    # The installer verifies all source hashes before replacing any files.


stage("server/littlepottchi-bridge.mjs", lambda _: (ROOT / "integrations/little-log/littlepottchi-bridge.mjs").read_text(encoding="utf-8"))
stage("tests/littlepottchi-bridge.test.mjs", lambda text: text if "test('LAN bridge sends analysis" in text else text + "\ntest('LAN bridge sends analysis" +
      (ROOT / "test/little-log-bridge.test.js").read_text(encoding="utf-8").split("test('LAN bridge sends analysis", 1)[1])
stage("deploy/tracker.env.example", lambda text: text if "LITTLEPOTTCHI_API_URL=" in text else text + "\n# Optional server-to-server Littlepottchi bridge, avoiding public hairpin NAT.\n# LITTLEPOTTCHI_API_URL=http://10.1.1.23:4190/littlepottchi/integration/v1/\n# LITTLEPOTTCHI_BRIDGE_TOKEN=<same dedicated random secret as MommyBot>\n")
stage("LITTLEPOTTCHI_API.md", lambda _: (ROOT / "LITTLEPOTTCHI_API.md").read_text(encoding="utf-8"))
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"Staged {len(manifest)} pet bridge LAN files in {OUT}")

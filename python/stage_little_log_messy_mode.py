"""Stage the optional messy-mode push update; use the hash-checking PowerShell installer."""
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
    staged = relative + ".payload" if relative.startswith("tests/") else relative
    target = OUT / staged
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(edited, encoding="utf-8", newline="")
    manifest.append({"path": relative, "source": staged, "before": hashlib.sha256(original).hexdigest()})
    # Preserve the exact source digest so intervening sibling edits stop installation before any copies.

def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected one patch location: {old[:90]}")
    return text.replace(old, new, 1)

def worker(text):
    text = replace_once(text, "little-log-v91-littlepottchi-", "little-log-v92-messy-mode-")
    return replace_once(text, "wet:'Your Littlepottchi has a wet diaper.',", "wet:'Your Littlepottchi has a wet diaper.',mess:'Your Littlepottchi has a messy diaper and needs a fresh change.',")

def tests(text):
    new_test = """test('messy diaper events use the existing identity-bound push path', async t => {
  const f = fixture(t); f.events.push(f.event('mess'));
  await f.bridge().tick(f.now);
  assert.equal(f.sent.length,1); assert.equal(f.sent[0].payload.need,'mess');
  assert.equal(f.sent[0].sub.endpoint,'push-owner'); assert.equal(f.events.length,0);
});

"""
    return replace_once(text, "test('quiet hours defer,", new_test + "test('quiet hours defer,")

stage("sw.js", worker)
stage("server/littlepottchi-bridge.mjs", lambda text: replace_once(text, "['wet','leak','feed','water','play','rest','complete']", "['wet','mess','leak','feed','water','play','rest','complete']"))
stage("tests/littlepottchi-bridge.test.mjs", tests)
stage("LITTLEPOTTCHI_API.md", lambda _: (ROOT / "LITTLEPOTTCHI_API.md").read_text(encoding="utf-8"))
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"Staged {len(manifest)} messy-mode integration files in {OUT}")

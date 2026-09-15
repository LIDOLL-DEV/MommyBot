"""Prepare a reviewable Little Log patch locally; the PowerShell installer checks original hashes."""
from pathlib import Path
import hashlib
import json

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Scripts\omo-trainer")
OUT = ROOT / "data/little-log-pet-patch"
OUT.mkdir(parents=True, exist_ok=True)
manifest = []

def stage(relative, transform):
    path = SOURCE / relative
    original = path.read_bytes() if path.exists() else None
    content = transform(original.decode("utf-8") if original else "")
    staged = relative + ".payload" if relative.startswith("tests/") else relative
    target = OUT / staged
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="")
    manifest.append({"path": relative, "source": staged, "before": hashlib.sha256(original).hexdigest() if original else None})
    # Record the original digest so a later install cannot overwrite another editor's intervening work.

def replace_once(text, old, new):
    if text.count(old) != 1:
        raise ValueError(f"Expected one patch location: {old[:90]}")
    return text.replace(old, new, 1)

def notifications(text):
    text = replace_once(text, "import webpush from 'web-push';", "import webpush from 'web-push';\nimport {createLittlepottchiBridge} from './littlepottchi-bridge.mjs';")
    text = replace_once(text, " const messages=createNotificationMessages", " const littlepottchi=createLittlepottchiBridge(db,{configured,send,localBlock,...options.littlepottchi});\n const messages=createNotificationMessages")
    text = replace_once(text, "  if(!configured||running)return;running=true;const started=Date.now();", "  if(running)return;\n  await littlepottchi.tick(now); // Synchronize saved AI counts even when push delivery is not configured.\n  if(!configured||running)return;running=true;const started=Date.now();")
    return replace_once(text, "return {status,save,remove,tick,messages,community};", "return {status,save,remove,tick,messages,community,littlepottchi};")

def worker(text):
    text = text.replace("little-log-v90-social-profiles-", "little-log-v93-pet-cleanup-")
    insertion = """ const petMessages={wet:'Your Littlepottchi has a wet diaper.',mess:'Your Littlepottchi has a messy diaper and needs a fresh change.',leak:'Your Littlepottchi is leaking and needs a fresh diaper.',cleanup:'Your Littlepottchi needs a baby wipe before a fresh diaper.',feed:'Your Littlepottchi is ready for food.',water:'Your Littlepottchi is ready for water.',play:'Your Littlepottchi would like some playtime.',rest:'Your Littlepottchi is ready for a rest.',complete:'Your Littlepottchi finished a timed activity.'};
 if(data?.kind==='littlepottchi') {
  if(!Object.prototype.hasOwnProperty.call(petMessages,data.need))return;
  event.waitUntil(self.registration.showNotification('Littlepottchi',{body:petMessages[data.need],icon:new URL('./icons/notification-icon.png',self.registration.scope).href,badge:new URL('./icons/notification-badge.png',self.registration.scope).href,data:{pet:true},tag:typeof data.tag==='string'?data.tag.slice(0,80):'littlepottchi'}));return;
 } // Only fixed pet messages are displayed; no supplied URL or personal record is rendered.
"""
    text = replace_once(text, " const adminMessage=data?.kind", insertion + " const adminMessage=data?.kind")
    return replace_once(text, "event.notification.data?.activity?'./#activity':'./#overview'", "event.notification.data?.pet?'./#games':event.notification.data?.activity?'./#activity':'./#overview'")

def page(text):
    marker = '          <article class="card game-card"><div class="game-art game-art-hangman"'
    cards = '''          <article class="card game-card"><div class="game-art game-art-diapers" aria-hidden="true">&#9825;</div><p class="eyebrow">DRESS &amp; CARE</p><h2>Littlepottchi</h2><p>Dress your doll, bring food and water, and make time for play, rest and fresh diapers. Turn on pet reminders in the game to receive them here.</p><p class="game-price"><strong>Free</strong> care and dressing</p><a class="button primary" data-game-link href="./games/littlepottchi" target="_blank" rel="noopener noreferrer">Open Littlepottchi &#8599;</a></article>
          <article class="card game-card"><div class="game-art game-art-diapers" aria-hidden="true">&#10047;</div><p class="eyebrow">COLLECT YOUR WARDROBE</p><h2>Clothes Emporium</h2><p>Roll for individual clothing pieces and dress your Littlepottchi from a collection of hundreds of designs.</p><p class="game-price">See current roll prices in the game</p><a class="button primary" data-game-link href="./games/clothes" target="_blank" rel="noopener noreferrer">Open Clothes Emporium &#8599;</a></article>
'''
    return replace_once(text, marker, cards + marker)

stage("server/notifications.mjs", notifications)
stage("sw.js", worker)
stage("index.html", page)
stage("server/games.mjs", lambda text: replace_once(text, "['diapers','hangman','touhou','balldrop']", "['diapers','hangman','touhou','balldrop','clothes','littlepottchi']"))
stage("tests/games.test.mjs", lambda text: text.replace("['diapers','hangman','touhou','balldrop']", "['diapers','hangman','touhou','balldrop','clothes','littlepottchi']").replace("all four separate tabs", "all six separate tabs"))
stage("server/littlepottchi-bridge.mjs", lambda _: (ROOT / "integrations/little-log/littlepottchi-bridge.mjs").read_text(encoding="utf-8"))
stage("tests/littlepottchi-bridge.test.mjs", lambda _: (ROOT / "test/little-log-bridge.test.js").read_text(encoding="utf-8").replace("../integrations/little-log/littlepottchi-bridge.mjs", "../server/littlepottchi-bridge.mjs"))
stage("LITTLEPOTTCHI_API.md", lambda _: (ROOT / "LITTLEPOTTCHI_API.md").read_text(encoding="utf-8"))
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
print(f"Staged {len(manifest)} files in {OUT}")

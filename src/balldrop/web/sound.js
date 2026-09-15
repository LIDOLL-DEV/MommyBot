const prismSound = (() => {
  const button = document.getElementById("sound"), Audio = window.AudioContext || window.webkitAudioContext;
  let enabled = true, context = null, master = null, unavailable = !Audio;
  const voices = new Set();
  try { enabled = localStorage.getItem("prism-sound") !== "off"; } catch { /* Sound still works when browser storage is blocked. */ }

  function label() {
    button.textContent = unavailable ? "Sound unavailable" : enabled ? "Sound: on" : "Sound: off";
    button.setAttribute("aria-pressed", String(enabled && !unavailable)); button.disabled = unavailable;
    button.title = unavailable ? "This browser cannot play game sounds." : enabled ? "Mute game sounds" : "Enable game sounds";
  } // Keep the native toggle's visible state and screen-reader state in agreement.

  function stop() {
    for (const voice of voices) {
      try { voice.source.stop(); } catch { /* A short note may already have finished. */ }
      try { voice.source.disconnect(); voice.gain.disconnect(); } catch { /* A closed device must not interfere with gameplay. */ }
    }
    voices.clear();
  } // Stop both current notes and scheduled fanfare notes when muted or backgrounded.

  function unlock() {
    if (!enabled || unavailable || document.hidden) return;
    try {
      if (!context) {
        context = new Audio(); master = context.createGain(); master.gain.value = .32; master.connect(context.destination);
      }
      if (context.state === "suspended") void context.resume().catch(() => {});
    } catch { unavailable = true; label(); }
  } // Create/resume audio only inside a player gesture; audio failures never interrupt a wager.

  function tone(frequency, duration = .12, delay = 0, volume = .22, type = "sine", end = frequency) {
    if (voices.size >= 32) return;
    const source = context.createOscillator(), gain = context.createGain(), start = context.currentTime + delay;
    source.type = type; source.frequency.setValueAtTime(frequency, start);
    source.frequency.exponentialRampToValueAtTime(end, start + duration);
    gain.gain.setValueAtTime(.0001, start); gain.gain.exponentialRampToValueAtTime(volume, start + .006);
    gain.gain.exponentialRampToValueAtTime(.0001, start + duration);
    source.connect(gain); gain.connect(master);
    const voice = { source, gain }; voices.add(voice);
    source.onended = () => { source.disconnect(); gain.disconnect(); voices.delete(voice); };
    source.start(start); source.stop(start + duration + .015);
  } // Shape short, click-free notes with capped polyphony and release every finished audio node.

  function play(kind, detail = {}) {
    if (!enabled || unavailable || document.hidden || context?.state !== "running") return;
    try {
      if (kind === "drop") { tone(880, .24, 0, .2, "sine", 220); tone(1320, .18, .04, .1, "sine", 440); }
      else if (kind === "peg") tone([523.25, 587.33, 659.25, 783.99, 880][Math.max(0, (detail.column || 1) - 1) % 5], .085, 0, .13);
      else if (kind === "block") { tone(190, .11, 0, .28, "triangle", 95); tone(380, .07, 0, .08); }
      else if (kind === "bomb") { tone(155, .34, 0, .42, "triangle", 35); tone(510, .17, 0, .12, "sawtooth", 65); tone(240, .22, .05, .16, "sine", 55); }
      else if (kind === "coin") { tone(1046.5, .15, 0, .22); tone(1568, .23, .065, .18); }
      else if (kind === "landing") {
        const distance = Math.abs(detail.guess - detail.landing);
        const notes = detail.state === "credit" ? [392, 523.25] : distance === 0 ? [523.25, 659.25, 783.99, 1046.5] : distance === 1 ? [523.25, 659.25, 880] : distance === 2 ? [523.25, 659.25] : [392, 293.66];
        notes.forEach((note, index) => tone(note, .25, index * .105, .2, "triangle"));
      }
    } catch { stop(); } // A missing device or interrupted audio context must leave the game and wallet controls usable.
  } // Synthesize original arcade cues locally; saved collisions choose sounds, never outcomes or payouts.

  button.addEventListener("click", () => {
    enabled = !enabled;
    try { localStorage.setItem("prism-sound", enabled ? "on" : "off"); } catch { /* Retain the preference in this tab if it cannot be saved. */ }
    if (!enabled) stop();
    if (master) master.gain.value = enabled ? .32 : 0;
    label(); if (enabled) unlock();
  }); // Muting remains available during a drop and affects only this browser's audio preference.
  document.addEventListener("visibilitychange", () => { if (document.hidden) stop(); });
  window.addEventListener("pagehide", stop);
  label();
  return { unlock, play, stop };
})(); // Keep one lazy audio context for the page; loading or refreshing a saved result stays silent.

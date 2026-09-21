/* fakecall.js — simulated incoming call, the classic "get out of a bad
   situation" tool popularized by bSafe/UrSafe. Ring → accept → timed call
   with scripted prompts. All local, nothing is actually dialed. */
"use strict";

const FakeCall = (() => {
  let ringTimer = null, callTimer = null, audio = null, seconds = 0;

  const SCRIPTS = [
    "Say: “I’m almost there — five minutes.”",
    "Say: “I can see the building, stay on the line.”",
    "Say: “Yeah, I’ll text you the moment I’m inside.”",
    "Say: “There are people around, I’m fine.”",
    "Say: “Okay — see you at the door in a sec.”",
  ];

  /* classic double-ring via WebAudio — needs a prior user gesture */
  function startRing() {
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      const osc = audio.createOscillator(), gain = audio.createGain();
      osc.type = "sine"; osc.frequency.value = 440;
      gain.gain.value = 0;
      osc.connect(gain).connect(audio.destination);
      osc.start();
      let on = false;
      ringTimer = setInterval(() => {
        on = !on;
        gain.gain.setTargetAtTime(on ? 0.08 : 0, audio.currentTime, 0.02);
        osc.frequency.setValueAtTime(on ? 440 : 480, audio.currentTime);
      }, 700);
      navigator.vibrate?.([500, 300, 500, 900]);
    } catch (e) { /* audio optional */ }
  }

  function stopRing() {
    clearInterval(ringTimer);
    navigator.vibrate?.(0);
  }

  function show(id) {
    document.getElementById("fakeCall").hidden = false;
    document.getElementById("fcIncoming").hidden = id !== "fcIncoming";
    document.getElementById("fcInCall").hidden = id !== "fcInCall";
  }

  function start() {
    show("fcIncoming");
    startRing();
  }

  function accept() {
    stopRing();
    show("fcInCall");
    seconds = 0;
    const timer = document.getElementById("fcTimer");
    const script = document.getElementById("fcScript");
    let si = 0;
    callTimer = setInterval(() => {
      seconds++;
      timer.textContent = String(Math.floor(seconds / 60)).padStart(2, "0") + ":" +
                          String(seconds % 60).padStart(2, "0");
      if (seconds % 12 === 0) script.textContent = SCRIPTS[++si % SCRIPTS.length];
    }, 1000);
  }

  function end() {
    stopRing(); clearInterval(callTimer);
    document.getElementById("fakeCall").hidden = true;
  }

  function init() {
    document.getElementById("fcAccept").onclick = accept;
    document.getElementById("fcDecline").onclick = end;
    document.getElementById("fcEnd").onclick = end;
  }

  return { init, start, end, isRinging: () => !!ringTimer };
})();

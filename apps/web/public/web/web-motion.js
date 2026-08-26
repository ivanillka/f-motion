/**
 * F-Motion marketing motion — GSAP + distinct per-logo glitch modes.
 * Modes (each unique): rgb-split | scramble-cascade | slice-tear | flip-corrupt | pulse-shard
 * Logos: continuous random letter glitch (respects prefers-reduced-motion).
 */
(function () {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const GLYPHS = "ABCDEFGHJKLMNPQRSTUVWXYZ0123456789#@$%&*<>/\\|";
  const cleanups = [];

  function onCleanup(fn) {
    cleanups.push(fn);
  }

  function letterize(root) {
    const raw = (root.getAttribute("data-text") || root.textContent || "F-MOTION").trim();
    root.setAttribute("data-text", raw);
    if (!root.getAttribute("aria-label")) root.setAttribute("aria-label", "F-Motion");
    root.replaceChildren();
    const track = document.createElement("span");
    track.className = "glitch-track";
    track.setAttribute("aria-hidden", "true");
    for (const ch of raw) {
      const span = document.createElement("span");
      if (ch === "-" || ch === " ") {
        span.className = "glitch-sep";
        span.textContent = ch;
      } else {
        span.className = "glitch-char";
        span.dataset.char = ch;
        span.textContent = ch;
      }
      track.appendChild(span);
    }
    root.appendChild(track);
    return root.querySelectorAll(".glitch-char");
  }

  function randomGlyph() {
    return GLYPHS[Math.floor(Math.random() * GLYPHS.length)];
  }

  function pickChars(chars, count) {
    const list = Array.from(chars);
    if (!list.length) return [];
    const n = Math.min(count, list.length);
    const copy = list.slice();
    const out = [];
    for (let i = 0; i < n; i++) {
      const idx = Math.floor(Math.random() * copy.length);
      out.push(copy.splice(idx, 1)[0]);
    }
    return out;
  }

  /** Random idle ticks + hover/focus; cleaned on pagehide. */
  function scheduleIdle(gsap, tick, minSec, maxSec) {
    let call;
    const loop = () => {
      tick();
      call = gsap.delayedCall(gsap.utils.random(minSec, maxSec), loop);
    };
    call = gsap.delayedCall(gsap.utils.random(0.35, 1.1), loop);
    const onEnter = () => tick();
    return { call, onEnter, kill: () => call && call.kill() };
  }

  function bindGlitch(el, gsap, tick, minSec, maxSec) {
    const idle = scheduleIdle(gsap, tick, minSec, maxSec);
    el.addEventListener("pointerenter", idle.onEnter);
    el.addEventListener("focusin", idle.onEnter);
    onCleanup(() => {
      idle.kill();
      el.removeEventListener("pointerenter", idle.onEnter);
      el.removeEventListener("focusin", idle.onEnter);
    });
  }

  function initRgbSplit(el, chars, gsap) {
    el.classList.add("glitch-rgb");
    const tick = () => {
      pickChars(chars, 1 + Math.floor(Math.random() * 3)).forEach((ch) => {
        gsap.fromTo(
          ch,
          {
            x: gsap.utils.random(-3, 3),
            y: gsap.utils.random(-2, 2),
            textShadow: "-2px 0 #00e5ff, 2px 0 #ff00cc",
            color: "#d989a0"
          },
          {
            x: 0,
            y: 0,
            textShadow: "none",
            color: "",
            duration: 0.22,
            ease: "power2.out"
          }
        );
      });
    };
    bindGlitch(el, gsap, tick, 0.9, 2.4);
  }

  function initScrambleCascade(el, chars, gsap) {
    // Per-letter cascade — keeps .glitch-char structure (no ScrambleText wipe).
    const order = Array.from(chars);
    gsap.from(order, {
      autoAlpha: 0,
      y: 18,
      rotateX: -50,
      stagger: { each: 0.05, from: "start" },
      duration: 0.55,
      ease: "power3.out"
    });
    const cascade = () => {
      const wave = gsap.utils.shuffle(order.slice());
      wave.forEach((ch, i) => {
        const original = ch.dataset.char;
        gsap.delayedCall(i * 0.04, () => {
          ch.textContent = randomGlyph();
          ch.style.color = i % 2 ? "#00e5ff" : "#d989a0";
          gsap.delayedCall(0.12 + Math.random() * 0.1, () => {
            ch.textContent = original;
            ch.style.color = "";
          });
        });
      });
    };
    gsap.delayedCall(0.6, cascade);
    bindGlitch(el, gsap, cascade, 2.2, 4.5);
  }

  function initSliceTear(el, chars, gsap) {
    el.classList.add("glitch-slice");
    const tear = () => {
      pickChars(chars, 2 + Math.floor(Math.random() * 2)).forEach((ch, i) => {
        const dir = i % 2 === 0 ? 1 : -1;
        const original = ch.dataset.char;
        ch.textContent = randomGlyph();
        gsap.fromTo(
          ch,
          {
            x: dir * gsap.utils.random(5, 12),
            clipPath: "inset(35% 0 40% 0)",
            opacity: 0.5
          },
          {
            x: 0,
            clipPath: "inset(0% 0 0% 0)",
            opacity: 1,
            duration: 0.3,
            ease: "steps(4)",
            onComplete: () => {
              ch.textContent = original;
            }
          }
        );
      });
    };
    bindGlitch(el, gsap, tear, 1.1, 2.8);
  }

  function initFlipCorrupt(el, chars, gsap) {
    gsap.set(el, { transformPerspective: 400 });
    const flip = () => {
      pickChars(chars, 1 + Math.floor(Math.random() * 2)).forEach((ch) => {
        const original = ch.dataset.char;
        const tl = gsap.timeline();
        tl.to(ch, { rotateY: 90, duration: 0.12, ease: "power1.in" })
          .add(() => {
            ch.textContent = randomGlyph();
            ch.style.color = "#00e5ff";
          })
          .to(ch, { rotateY: 0, duration: 0.14, ease: "power1.out" })
          .to(ch, { rotateY: 90, duration: 0.12, ease: "power1.in", delay: 0.05 })
          .add(() => {
            ch.textContent = original;
            ch.style.color = "";
          })
          .to(ch, { rotateY: 0, duration: 0.14, ease: "power1.out" });
      });
    };
    bindGlitch(el, gsap, flip, 1.0, 2.6);
  }

  function initPulseShard(el, chars, gsap) {
    const shard = () => {
      pickChars(chars, 2 + Math.floor(Math.random() * 2)).forEach((ch) => {
        const original = ch.dataset.char;
        ch.textContent = randomGlyph();
        gsap.fromTo(
          ch,
          { scale: 1.4, autoAlpha: 0.3, filter: "blur(1.5px)", color: "#a54d67" },
          {
            scale: 1,
            autoAlpha: 1,
            filter: "blur(0px)",
            color: "",
            duration: 0.38,
            ease: "back.out(2.2)",
            onComplete: () => {
              ch.textContent = original;
            }
          }
        );
      });
    };
    bindGlitch(el, gsap, shard, 1.0, 2.7);
  }

  function bootLogos(gsap) {
    document.querySelectorAll(".glitch-logo").forEach((el) => {
      const mode = el.getAttribute("data-glitch") || "rgb-split";
      const chars = letterize(el);
      if (reduce) return;
      if (mode === "rgb-split") initRgbSplit(el, chars, gsap);
      else if (mode === "scramble-cascade") initScrambleCascade(el, chars, gsap);
      else if (mode === "slice-tear") initSliceTear(el, chars, gsap);
      else if (mode === "flip-corrupt") initFlipCorrupt(el, chars, gsap);
      else if (mode === "pulse-shard") initPulseShard(el, chars, gsap);
    });
  }

  function bootPageMotion(gsap, ScrollTrigger) {
    if (reduce || !ScrollTrigger) return;
    gsap.registerPlugin(ScrollTrigger);
    const ctx = gsap.context(() => {
      const hero = document.querySelector(".hero, .page-hero");
      if (hero) {
        const tl = gsap.timeline({ defaults: { ease: "power2.out" } });
        tl.from(hero.querySelector("h1"), { autoAlpha: 0, y: 28, duration: 0.7 }, 0.15)
          .from(hero.querySelector(".eyebrow, .live-pill"), { autoAlpha: 0, y: 12, duration: 0.45 }, "-=0.35")
          .from(hero.querySelector(".cta-row"), { autoAlpha: 0, y: 16, duration: 0.5 }, "-=0.25")
          .from(hero.querySelector(".hero-plane"), { autoAlpha: 0, y: 40, scale: 1.02, duration: 0.85 }, "-=0.2");
      }
      gsap.utils.toArray(".section").forEach((section) => {
        gsap.from(section.querySelectorAll("h2, .lede, .step, .keys-copy, .recipe, .dx > *"), {
          autoAlpha: 0,
          y: 24,
          duration: 0.55,
          stagger: 0.06,
          ease: "power2.out",
          scrollTrigger: {
            trigger: section,
            start: "top 92%",
            once: true
          }
        });
      });
      const finalCta = document.querySelector(".final-cta");
      if (finalCta) {
        gsap.from(finalCta.children, {
          autoAlpha: 0,
          y: 20,
          stagger: 0.1,
          duration: 0.55,
          scrollTrigger: { trigger: finalCta, start: "top 85%", once: true }
        });
      }
    });
    onCleanup(() => ctx.revert());
  }

  function teardown() {
    while (cleanups.length) {
      try {
        cleanups.pop()();
      } catch {
        /* ignore */
      }
    }
    if (window.gsap) window.gsap.globalTimeline.clear();
  }

  function start() {
    const gsap = window.gsap;
    if (!gsap) return;
    bootLogos(gsap);
    bootPageMotion(gsap, window.ScrollTrigger);
    window.addEventListener("pagehide", teardown, { once: true });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();

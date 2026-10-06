/* Soft-launch constellation sky — sparse side nodes + hairline links. */
(function () {
  var canvas = document.querySelector(".launch-sky");
  if (!canvas || !canvas.getContext) return;

  var ctx = canvas.getContext("2d", { alpha: true });
  if (!ctx) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  var width = 0;
  var height = 0;
  var frame = 0;
  var clock = 0;
  var last = performance.now();
  var stars = seed(72);
  var links = linkStars(stars);

  function seed(count) {
    var out = [];
    for (var i = 0; i < count; i++) {
      var left = Math.random() < 0.5;
      var roll = Math.random();
      out.push({
        x: left ? Math.random() * 0.34 : 0.66 + Math.random() * 0.34,
        y: Math.random(),
        r: 0.3 + Math.random() * 1.05,
        a: 0.22 + Math.random() * 0.42,
        speed: 0.01 + Math.random() * 0.016,
        tw: Math.random() * Math.PI * 2,
        side: left ? "L" : "R",
        tint: roll < 0.08 ? "cyan" : roll < 0.18 ? "rose" : "white"
      });
    }
    return out;
  }

  function linkStars(nodes) {
    var edges = [];
    var maxDist = 0.18;
    for (var i = 0; i < nodes.length; i++) {
      var a = nodes[i];
      var near = [];
      for (var j = i + 1; j < nodes.length; j++) {
        var b = nodes[j];
        if (a.side !== b.side) continue;
        var dx = a.x - b.x;
        var dy = a.y - b.y;
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d > maxDist) continue;
        near.push({ j: j, d: d });
      }
      near.sort(function (u, v) { return u.d - v.d; });
      for (var k = 0; k < Math.min(2, near.length); k++) {
        if (Math.random() > 0.55) continue;
        edges.push({
          i: i,
          j: near[k].j,
          cyan: a.tint === "cyan" || nodes[near[k].j].tint === "cyan"
        });
      }
    }
    return edges;
  }

  function size() {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = canvas.clientWidth;
    height = canvas.clientHeight;
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function starY(star, t) {
    return ((star.y + t * star.speed) % 1 + 1) % 1;
  }

  function paint(t) {
    ctx.clearRect(0, 0, width, height);

    // Far rose fog — left and right only, never a full-bleed wash.
    var fogReach = Math.max(width, height) * 0.42;
    var fogs = [
      { x: 0.06, y: 0.4, rose: true },
      { x: 0.94, y: 0.58, rose: false }
    ];
    for (var f = 0; f < fogs.length; f++) {
      var cloud = fogs[f];
      var gx = cloud.x * width;
      var gy = cloud.y * height;
      var fog = ctx.createRadialGradient(gx, gy, fogReach * 0.1, gx, gy, fogReach);
      if (cloud.rose) {
        fog.addColorStop(0, "rgba(165, 77, 103, 0.12)");
        fog.addColorStop(0.55, "rgba(180, 40, 70, 0.03)");
      } else {
        fog.addColorStop(0, "rgba(70, 88, 110, 0.1)");
        fog.addColorStop(0.55, "rgba(0, 180, 210, 0.025)");
      }
      fog.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = fog;
      ctx.fillRect(0, 0, width, height);
    }

    var pulse = reduce.matches ? 1 : 0.55 + 0.45 * Math.sin(t * 0.35);

    for (var e = 0; e < links.length; e++) {
      var edge = links[e];
      var a = stars[edge.i];
      var b = stars[edge.j];
      var ay = starY(a, t);
      var by = starY(b, t);
      var alpha = (edge.cyan ? 0.1 : 0.07) * pulse;
      ctx.beginPath();
      ctx.moveTo(a.x * width, ay * height);
      ctx.lineTo(b.x * width, by * height);
      ctx.strokeStyle = edge.cyan
        ? "rgba(0, 229, 255, " + alpha + ")"
        : "rgba(241, 242, 243, " + alpha + ")";
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    for (var s = 0; s < stars.length; s++) {
      var star = stars[s];
      var y = starY(star, t);
      var twinkle = reduce.matches ? 1 : 0.72 + 0.28 * Math.sin(t * 0.55 + star.tw);
      var alpha = star.a * twinkle;
      ctx.beginPath();
      ctx.arc(star.x * width, y * height, star.r, 0, Math.PI * 2);
      ctx.fillStyle = star.tint === "cyan"
        ? "rgba(0, 229, 255, " + alpha + ")"
        : star.tint === "rose"
          ? "rgba(255, 177, 196, " + alpha + ")"
          : "rgba(241, 242, 243, " + alpha + ")";
      ctx.fill();
    }
  }

  size();
  var watch = new ResizeObserver(function () {
    size();
    if (reduce.matches) paint(0);
  });
  watch.observe(canvas);

  if (reduce.matches) {
    paint(0);
    reduce.addEventListener("change", function () {
      if (reduce.matches) {
        cancelAnimationFrame(frame);
        paint(0);
      }
    });
    return;
  }

  function tick(ms) {
    var dt = Math.min(0.05, (ms - last) / 1000);
    last = ms;
    if (!document.hidden) {
      clock += dt;
      paint(clock);
    }
    frame = requestAnimationFrame(tick);
  }
  frame = requestAnimationFrame(tick);
})();

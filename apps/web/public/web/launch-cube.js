(function () {
  var scene = document.querySelector(".launch-scene");
  var tilt = document.querySelector(".launch-tilt");
  if (!scene || !tilt) return;

  var reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
  if (reduce.matches) return;

  var max = 6;

  function clamp(v) {
    return v < -max ? -max : v > max ? max : v;
  }

  function paint(yaw, pitch) {
    tilt.style.transition = "none";
    tilt.style.transform = "rotateX(" + pitch.toFixed(2) + "deg) rotateY(" + yaw.toFixed(2) + "deg)";
  }

  function release() {
    drag = null;
    tilt.style.transition = "";
    tilt.style.transform = "rotateX(0deg) rotateY(0deg)";
  }

  var drag = null;

  scene.addEventListener("pointerdown", function (e) {
    if (e.pointerType !== "touch") return;
    scene.setPointerCapture(e.pointerId);
    drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
  });

  scene.addEventListener("pointermove", function (e) {
    if (drag && e.pointerId === drag.id) {
      paint(clamp((e.clientX - drag.x) * 0.08), clamp((drag.y - e.clientY) * 0.08));
      return;
    }
    if (e.pointerType === "touch" || drag) return;
    var rect = scene.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    var px = (e.clientX - rect.left) / rect.width - 0.5;
    var py = (e.clientY - rect.top) / rect.height - 0.5;
    paint(clamp(px * 2 * max), clamp(py * -2 * max));
  });

  scene.addEventListener("pointerup", function (e) {
    if (drag && e.pointerId === drag.id) release();
  });

  scene.addEventListener("pointercancel", function (e) {
    if (drag && e.pointerId === drag.id) release();
  });

  scene.addEventListener("pointerleave", function (e) {
    if (drag || e.pointerType === "touch") return;
    release();
  });

  reduce.addEventListener("change", function () {
    if (!reduce.matches) return;
    tilt.style.transition = "none";
    tilt.style.transform = "";
  });
})();

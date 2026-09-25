(function () {
  var video = document.getElementById("demo-reel");
  if (!video || !window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  video.removeAttribute("autoplay");
  video.pause();
  video.preload = "none";
  var sources = video.querySelectorAll("source");
  for (var i = 0; i < sources.length; i++) sources[i].remove();
  video.removeAttribute("src");
  video.load();
})();

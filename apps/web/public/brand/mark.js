const frame = new URLSearchParams(location.search).get("t");
if (frame !== null && Number.isFinite(Number(frame))) {
  document.documentElement.classList.add("is-frame");
  document.documentElement.style.setProperty("--frame", frame);
}

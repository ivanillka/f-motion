(function () {
  var params = new URLSearchParams(location.search);
  var hash = new URLSearchParams(location.hash.replace(/^#/, ""));
  var id = params.get("project") || "";
  var code = params.get("code") || "";
  var error = params.get("error_code") || params.get("error") || hash.get("error_code") || hash.get("error") || "";
  if (!/^[0-9a-f-]{36}$/i.test(id) && !code && !error) return;
  var next = new URL("/app/", location.origin);
  if (/^[0-9a-f-]{36}$/i.test(id)) next.searchParams.set("project", id);
  if (code) next.searchParams.set("code", code);
  if (error) next.searchParams.set("error_code", error);
  location.replace(next.pathname + next.search + location.hash);
})();

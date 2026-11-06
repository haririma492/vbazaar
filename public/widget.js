/*
 * The Virtual Bazaar's store widget — https://vbazaar.app
 * Place on the store's site:  <div data-vbazaar-store="<store>"></div><script src="https://vbazaar.app/widget.js" async></script>
 * It shows a short preview of the store in the Virtual Bazaar; the visit itself opens on vbazaar.app.
 * Optional: data-width="420" (pixels, the widget's widest), data-lang="fa" or "en".
 */
(function () {
  var ORIGIN = "https://vbazaar.app";
  try { var me = document.currentScript && document.currentScript.src; if (me) ORIGIN = new URL(me).origin; } catch (e) {}
  function mount(box) {
    if (box.getAttribute("data-vbazaar-ready")) return;
    var slug = (box.getAttribute("data-vbazaar-store") || "").replace(/[^a-z0-9-]/g, "");
    if (!slug) return;
    box.setAttribute("data-vbazaar-ready", "1");
    var max = parseInt(box.getAttribute("data-width") || "480", 10) || 480;
    var lang = box.getAttribute("data-lang") === "en" ? "en" : "fa";
    var wrap = document.createElement("div");
    wrap.style.cssText = "position:relative;width:100%;max-width:" + max + "px;aspect-ratio:4/3;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.18)";
    var f = document.createElement("iframe");
    f.src = ORIGIN + "/w/" + slug + "?lang=" + lang + "&from=" + encodeURIComponent(location.hostname);
    f.title = "Virtual Bazaar · بازار مجازی";
    f.loading = "lazy";
    f.setAttribute("allow", "autoplay");
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
    wrap.appendChild(f);
    box.innerHTML = "";
    box.appendChild(wrap);
  }
  function all() { var l = document.querySelectorAll("[data-vbazaar-store]"); for (var i = 0; i < l.length; i++) mount(l[i]); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
})();

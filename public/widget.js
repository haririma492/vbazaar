/*
 * The Virtual Bazaar's store widget — https://vbazaar.app
 * Place on the store's site:  <div data-vbazaar-store="<store>"></div><script src="https://vbazaar.app/widget.js" async></script>
 * It shows the store's Free Tour in the Virtual Bazaar; the arch at its top left opens the store on vbazaar.app.
 * Where: at the TOP of the page (under the site's header), wherever the two lines were pasted. data-place="here" on
 * the <div> keeps it where the <div> is. Optional: data-width="420" (pixels, the widget's widest), data-lang="fa" or "en".
 */
(function () {
  var ORIGIN = "https://vbazaar.app";
  try { var me = document.currentScript && document.currentScript.src; if (me) ORIGIN = new URL(me).origin; } catch (e) {}
  var made = []; // { box, wrap, top }
  function frame(box, slug) {
    var max = parseInt(box.getAttribute("data-width") || "480", 10) || 480;
    var lang = box.getAttribute("data-lang") === "en" ? "en" : "fa";
    var wrap = document.createElement("div");
    wrap.setAttribute("data-vbazaar-widget", slug);
    wrap.style.cssText = "position:relative;width:100%;max-width:" + max + "px;aspect-ratio:4/3;border-radius:14px;overflow:hidden;box-shadow:0 4px 18px rgba(0,0,0,.18)";
    var f = document.createElement("iframe");
    f.src = ORIGIN + "/w/" + slug + "?lang=" + lang + "&from=" + encodeURIComponent(location.hostname);
    f.title = "Virtual Bazaar · بازار مجازی";
    f.setAttribute("allow", "autoplay");
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
    wrap.appendChild(f);
    return wrap;
  }
  // The top of the page: under the site's own header (the last <header> that is not part of an article, a section,
  // the main content or the footer), else the very start of the page. The store's own <div> is left where it is and
  // hidden: a site drawn by a script (React and the like) owns that <div>, and moving it would break the site.
  function putOnTop(wrap) {
    var hs = document.querySelectorAll("header"), under = null;
    for (var i = 0; i < hs.length; i++) if (!hs[i].closest("main,article,section,footer,[data-vbazaar-widget]")) under = hs[i];
    wrap.style.margin = "12px auto";
    if (under && under.parentNode) under.parentNode.insertBefore(wrap, under.nextSibling);
    else document.body.insertBefore(wrap, document.body.firstChild);
  }
  function mount(box) {
    if (box.getAttribute("data-vbazaar-ready")) return;
    var slug = (box.getAttribute("data-vbazaar-store") || "").replace(/[^a-z0-9-]/g, "");
    if (!slug) return;
    box.setAttribute("data-vbazaar-ready", "1");
    var wrap = frame(box, slug);
    var top = box.getAttribute("data-place") !== "here";
    if (top) {
      // One widget a store at the top, even when the site draws the <div> again (a new page of a one-page site).
      for (var i = 0; i < made.length; i++) if (made[i].top && made[i].slug === slug) { box.style.display = "none"; return; }
      box.style.display = "none";
      putOnTop(wrap);
    } else {
      box.innerHTML = "";
      box.appendChild(wrap);
    }
    made.push({ slug: slug, wrap: wrap, top: top });
  }
  function all() {
    if (!document.body) return;
    var l = document.querySelectorAll("[data-vbazaar-store]");
    for (var i = 0; i < l.length; i++) mount(l[i]);
    // A site that draws itself again can drop our frame from the top: it is put back.
    for (var k = 0; k < made.length; k++) if (made[k].top && !made[k].wrap.isConnected) putOnTop(made[k].wrap);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
  // A site drawn by a script adds the <div> after this file has run: looked for again, lightly.
  setInterval(all, 1500);
})();

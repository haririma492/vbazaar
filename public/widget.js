/*
 * The Virtual Bazaar's store widget — https://vbazaar.app
 * On the store's site, ONCE, anywhere in the page, never changed again:
 *   <script async src="https://vbazaar.app/widget.js" data-vbazaar-store="<store>"></script>
 * (The older two lines, a <div data-vbazaar-store="<store>"> and then this script, work the same.)
 * It shows the store's Free Tour in the Virtual Bazaar; the arch at its top left opens the store on vbazaar.app.
 * By default it is a window in the page, under the site's header, at the right, with the page's content beside it.
 * Everything about it (shown or not, where, which side, how wide, the language) is set on vbazaar.app, on the
 * store's page there, and asked for here each time (/api/w/<store>). Attributes on the <div> (data-place="here",
 * data-width, data-lang) are used only if that answer cannot be had.
 */
(function () {
  if (window.__vbazaarWidget) return; // the two lines pasted twice: one script works for the page
  window.__vbazaarWidget = true;
  var ORIGIN = "https://vbazaar.app";
  try { var me = document.currentScript && document.currentScript.src; if (me) ORIGIN = new URL(me).origin; } catch (e) {}
  var made = [];   // { slug, wrap, top }
  var asked = {};  // slug -> settings, or "wait" while they are asked for
  function fromDiv(box) {
    return {
      on: true,
      place: box.getAttribute("data-place") === "here" ? "here" : "top",
      side: "right",
      corner: "br",
      width: parseInt(box.getAttribute("data-width") || "480", 10) || 480,
      lang: box.getAttribute("data-lang") === "en" ? "en" : "fa"
    };
  }
  function frame(slug, set) {
    var wrap = document.createElement("div");
    wrap.setAttribute("data-vbazaar-widget", slug);
    wrap.style.cssText = "position:relative;box-sizing:border-box;width:100%;max-width:" + set.width + "px;border-radius:14px;overflow:hidden;background:#0f2a1f;box-shadow:0 4px 18px rgba(0,0,0,.18)";
    var inner = document.createElement("div");
    inner.style.cssText = "position:relative;width:100%;aspect-ratio:4/3";
    var f = document.createElement("iframe");
    f.src = ORIGIN + "/w/" + slug + "?lang=" + set.lang + "&from=" + encodeURIComponent(location.hostname);
    f.title = "Virtual Bazaar · بازار مجازی";
    f.setAttribute("allow", "autoplay");
    f.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0";
    inner.appendChild(f);
    if (set.movable !== false) movable(wrap, slug);
    wrap.appendChild(inner);
    if (set.movable !== false) sizable(wrap, slug);
    return wrap;
  }
  // ── THE VISITOR MOVES AND RESIZES THE WINDOW (owner, 2026-11-11: "users on each website should be able to resize
  // the window and also move the location of the window around"). A bar on top to drag it by, a corner at the bottom
  // right to pull its size (always 4:3). The first drag or pull lifts it out of the page's rows onto the page itself
  // (it still scrolls with the page; a hovering window stays hovering), and the site's own row takes its room back.
  // Where and how big is kept on the visitor's device for this site; a double click on the bar puts it back.
  var POS = "vbazaar-widget-pos-";
  function keep(slug, wrap) { try { localStorage.setItem(POS + slug, JSON.stringify({ x: parseFloat(wrap.style.left), y: parseFloat(wrap.style.top), w: parseFloat(wrap.style.width), fixed: wrap.style.position === "fixed" })); } catch (e) {} }
  function kept(slug) { try { var k = JSON.parse(localStorage.getItem(POS + slug) || "null"); return k && isFinite(k.x) && isFinite(k.y) && isFinite(k.w) ? k : null; } catch (e) { return null; } }
  function pageW() { return document.documentElement.clientWidth || window.innerWidth; }
  function lift(wrap) {
    if (wrap._lifted) return;
    var r = wrap.getBoundingClientRect(), fixed = wrap.style.position === "fixed";
    wrap._lifted = true;
    wrap.style.cssFloat = "none"; wrap.style.margin = "0"; wrap.style.maxWidth = "none";
    wrap.style.right = "auto"; wrap.style.bottom = "auto";
    wrap.style.position = fixed ? "fixed" : "absolute";
    wrap.style.left = (r.left + (fixed ? 0 : window.pageXOffset)) + "px";
    wrap.style.top = (r.top + (fixed ? 0 : window.pageYOffset)) + "px";
    wrap.style.width = r.width + "px";
    if (!fixed) wrap.style.zIndex = "2147482000";
    if (wrap.parentNode !== document.body) document.body.appendChild(wrap);
  }
  function place(wrap, x, y, w) {
    var W = pageW();
    w = Math.max(220, Math.min(w, W - 8));
    wrap.style.width = w + "px";
    wrap.style.left = Math.max(0, Math.min(x, W - w)) + "px";
    wrap.style.top = Math.max(0, y) + "px";
  }
  function grab(el, wrap, slug, move) {
    el.style.touchAction = "none";
    el.addEventListener("pointerdown", function (e) {
      if (e.button) return;
      e.preventDefault();
      lift(wrap);
      var from = { px: e.clientX, py: e.clientY, x: parseFloat(wrap.style.left), y: parseFloat(wrap.style.top), w: parseFloat(wrap.style.width) };
      try { el.setPointerCapture(e.pointerId); } catch (x) {}
      var on = function (m) { move(from, m.clientX - from.px, m.clientY - from.py); };
      var off = function () { el.removeEventListener("pointermove", on); el.removeEventListener("pointerup", off); el.removeEventListener("pointercancel", off); keep(slug, wrap); };
      el.addEventListener("pointermove", on); el.addEventListener("pointerup", off); el.addEventListener("pointercancel", off);
    });
  }
  function movable(wrap, slug) {
    var bar = document.createElement("div");
    bar.title = "Drag to move · double click to put back";
    bar.style.cssText = "height:20px;cursor:move;background:#0f2a1f;display:flex;align-items:center;justify-content:center;user-select:none;-webkit-user-select:none";
    bar.innerHTML = '<span style="display:block;width:44px;height:4px;border-radius:2px;background:rgba(255,249,238,.55)"></span>';
    grab(bar, wrap, slug, function (f, dx, dy) { place(wrap, f.x + dx, f.y + dy, f.w); });
    bar.addEventListener("dblclick", function () { try { localStorage.removeItem(POS + slug); } catch (e) {} location.reload(); });
    wrap.appendChild(bar);
  }
  function sizable(wrap, slug) {
    var c = document.createElement("div");
    c.title = "Drag to resize";
    c.style.cssText = "position:absolute;right:0;bottom:0;width:20px;height:20px;cursor:nwse-resize;z-index:3;background:linear-gradient(135deg,transparent 50%,rgba(255,249,238,.75) 50%,rgba(255,249,238,.75) 58%,transparent 58%,transparent 70%,rgba(255,249,238,.75) 70%,rgba(255,249,238,.75) 78%,transparent 78%)";
    grab(c, wrap, slug, function (f, dx) { place(wrap, f.x, f.y, f.w + dx); });
    wrap.appendChild(c);
  }
  // A visitor who moved or resized it before finds it where they left it.
  function restore(wrap, slug) {
    var k = kept(slug);
    if (!k) return;
    if (k.fixed !== (wrap.style.position === "fixed")) return;
    lift(wrap); place(wrap, k.x, k.y, k.w);
  }
  // The top of the page: under the site's own header (the last <header> that is not part of an article, a section,
  // the main content or the footer), else the very start of the page. The store's own <div> is left where it is and
  // hidden: a site drawn by a script (React and the like) owns that <div>, and moving it would break the site.
  // In the page as a WINDOW, not a stripe: it stands at one side and the page's own content runs beside it, so no
  // empty lane is left to its left and right. "center": alone on its row, in the middle (a stripe; only if chosen).
  function beside(wrap, set) {
    var side = set.side === "left" ? "left" : set.side === "center" ? "" : "right";
    wrap.style.maxWidth = "none";
    if (!side) { wrap.style.width = "min(" + set.width + "px, 100%)"; wrap.style.margin = "12px auto"; return; }
    wrap.style.width = "min(" + set.width + "px, calc(100% - 28px))"; // its margins fit on a phone too
    wrap.style.cssFloat = side;
    wrap.style.margin = side === "right" ? "12px 12px 12px 16px" : "12px 16px 12px 12px";
    wrap.style.zIndex = "5";
  }
  function putOnTop(wrap, set) {
    var hs = document.querySelectorAll("header"), under = null;
    for (var i = 0; i < hs.length; i++) if (!hs[i].closest("main,article,section,footer,[data-vbazaar-widget]")) under = hs[i];
    beside(wrap, set);
    if (under && under.parentNode) under.parentNode.insertBefore(wrap, under.nextSibling);
    else document.body.insertBefore(wrap, document.body.firstChild);
  }
  // A window of its own over a corner of the page: it takes no room in the page (no empty lane beside it), stays in
  // view as the page scrolls, is never wider than the screen, and has a × that closes it for this visit.
  function floatIt(wrap, set, slug) {
    var c = set.corner || "br";
    wrap.style.position = "fixed";
    wrap.style.zIndex = "2147483000";
    wrap.style.width = "min(" + set.width + "px, calc(100vw - 24px))";
    wrap.style.maxWidth = "none";
    wrap.style[c.charAt(0) === "t" ? "top" : "bottom"] = "12px";
    wrap.style[c.charAt(1) === "l" ? "left" : "right"] = "12px";
    wrap.style.boxShadow = "0 8px 30px rgba(0,0,0,.35)";
    var x = document.createElement("button");
    x.type = "button";
    x.setAttribute("aria-label", "Close");
    x.textContent = "\u00d7";
    x.style.cssText = "position:absolute;top:" + (set.movable !== false ? 26 : 6) + "px;right:6px;z-index:2;width:28px;height:28px;border:0;border-radius:50%;background:rgba(0,0,0,.65);color:#fff;font:700 18px/28px system-ui,sans-serif;padding:0;cursor:pointer";
    x.onclick = function () { closed[slug] = true; try { sessionStorage.setItem("vbazaar-widget-closed-" + slug, "1"); } catch (e) {} if (wrap.parentNode) wrap.parentNode.removeChild(wrap); };
    wrap.appendChild(x);
    document.body.appendChild(wrap);
  }
  var closed = {};
  function isClosed(slug) { if (closed[slug]) return true; try { return sessionStorage.getItem("vbazaar-widget-closed-" + slug) === "1"; } catch (e) { return false; } }
  function draw(box, slug, set) {
    box.setAttribute("data-vbazaar-ready", "1");
    if (!set.on) { if (box.tagName !== "SCRIPT") box.style.display = "none"; return; }
    if (set.place !== "here") {
      if (box.tagName !== "SCRIPT") box.style.display = "none";
      // One widget a store, even when the site draws the <div> again (a new page of a one-page site).
      for (var i = 0; i < made.length; i++) if (made[i].top && made[i].slug === slug) return;
      if (set.place === "float" && isClosed(slug)) return;
      var wrap = frame(slug, set);
      made.push({ slug: slug, wrap: wrap, top: true, float: set.place === "float", set: set });
      if (set.place === "float") floatIt(wrap, set, slug); else putOnTop(wrap, set);
      if (set.movable !== false) restore(wrap, slug);
    } else {
      var w = frame(slug, set);
      // "Here": inside the store's <div>, or right after the one line of script when that is all there is.
      beside(w, set);
      if (box.tagName === "SCRIPT") box.parentNode.insertBefore(w, box.nextSibling);
      else { box.innerHTML = ""; box.appendChild(w); }
      if (set.movable !== false) restore(w, slug);
      made.push({ slug: slug, wrap: w, top: false });
    }
  }
  function mount(box) {
    if (box.getAttribute("data-vbazaar-ready")) return;
    var slug = (box.getAttribute("data-vbazaar-store") || "").replace(/[^a-z0-9-]/g, "");
    if (!slug) return;
    var set = asked[slug];
    if (set === "wait") return;                 // asked for: drawn at the next look
    if (set) { draw(box, slug, set); return; }
    asked[slug] = "wait";
    var done = function (s) { asked[slug] = s || fromDiv(box); all(); };
    try {
      var x = new XMLHttpRequest();
      x.open("GET", ORIGIN + "/api/w/" + slug);
      x.timeout = 6000;
      x.onload = function () { var j = null; try { j = JSON.parse(x.responseText); } catch (e) {} done(j && j.ok ? { on: j.on !== false, place: j.place === "here" ? "here" : j.place === "float" ? "float" : "top", side: j.side || "right", corner: j.corner || "br", width: +j.width || 480, lang: j.lang === "en" ? "en" : "fa", movable: j.movable !== false } : null); };
      x.onerror = x.ontimeout = function () { done(null); };
      x.send();
    } catch (e) { done(null); }
  }
  function all() {
    if (!document.body) return;
    var l = document.querySelectorAll("[data-vbazaar-store]");
    for (var i = 0; i < l.length; i++) mount(l[i]);
    // A site that draws itself again can drop our frame from the top: it is put back.
    for (var k = 0; k < made.length; k++) if (made[k].top && !made[k].wrap.isConnected && !closed[made[k].slug]) { if (made[k].float || made[k].wrap._lifted) document.body.appendChild(made[k].wrap); else putOnTop(made[k].wrap, made[k].set); }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", all); else all();
  // A site drawn by a script adds the <div> after this file has run: looked for again, lightly.
  setInterval(all, 1500);
})();

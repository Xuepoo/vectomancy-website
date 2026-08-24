// Vectomancy i18n glue (plain browser script, no build step).
//
// Responsibilities:
//   1. Resolve the current language from the server-rendered <html lang>.
//   2. Auto-redirect visitors from mainland China (Cloudflare `loc=CN`) to the
//      /zh/ variant once per session, unless they picked a language manually.
//   3. Wire the [data-lang-switch] buttons: clicking stores a persistent
//      override in localStorage so the auto-redirect never fights the user.
//   4. Expose window.t8(en, zh) as the shared string helper for all page JS.

(function () {
  "use strict";

  var OVERRIDE_KEY = "vectomancy_lang_override";
  var REDIRECTED_KEY = "vectomancy_lang_redirected";

  var LANG = document.documentElement.lang === "zh-CN" ? "zh" : "en";

  // Shared helper for all later page scripts: t8("English", "中文")
  window.t8 = function (en, zh) {
    return LANG === "zh" ? zh : en;
  };

  // Persist the user's explicit choice, then follow the link they clicked.
  document.querySelectorAll("[data-lang-switch]").forEach(function (el) {
    el.addEventListener("click", function (event) {
      event.preventDefault();
      try {
        localStorage.setItem(OVERRIDE_KEY, el.getAttribute("data-lang-switch"));
      } catch {
        // Storage unavailable (private mode etc.) — still navigate.
      }
      window.location.assign(el.href);
    });
  });

  // Geo auto-redirect: CN edge visitors land on /zh/ exactly once per session.
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", maybeRedirect);
  } else {
    maybeRedirect();
  }

  function alreadyZh() {
    return location.pathname === "/zh" || location.pathname.indexOf("/zh/") === 0;
  }

  function maybeRedirect() {
    try {
      if (localStorage.getItem(OVERRIDE_KEY)) return;
    } catch {
      return;
    }
    if (LANG === "zh" || alreadyZh()) return;
    if (sessionStorage.getItem(REDIRECTED_KEY)) return;

    fetchTrace(function (loc) {
      if (loc !== "CN") return;
      if (alreadyZh()) return;
      try {
        sessionStorage.setItem(REDIRECTED_KEY, "1");
      } catch {
        return;
      }
      location.assign("/zh" + location.pathname + location.search);
    });
  }

  // Fetch /cdn-cgi/trace (same-origin, injected by Cloudflare's edge) and
  // hand the parsed `loc=` value to callback. Tolerant to failure/timeout:
  // on any problem we simply never redirect.
  function fetchTrace(callback) {
    var finished = false;
    var controller = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = setTimeout(function () {
      if (!finished) {
        finished = true;
        if (controller) controller.abort();
      }
    }, 2000);

    fetch("/cdn-cgi/trace", { signal: controller ? controller.signal : undefined })
      .then(function (res) {
        return res.text();
      })
      .then(function (text) {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        var match = text.match(/^loc=(.*)$/m);
        callback(match ? match[1].trim() : "");
      })
      .catch(function () {
        if (!finished) {
          finished = true;
          clearTimeout(timer);
        }
      });
  }
})();

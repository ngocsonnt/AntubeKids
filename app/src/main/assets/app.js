/* =========================================================================
   Antube Kids — logic
   - Loads the list from a Google Sheet (via the native bridge to avoid CORS)
   - Builds a thumbnail grid, controllable by touch + remote (arrow keys)
   - Lists the spreadsheet's tabs as playlists on the right
   - Plays YouTube via the IFrame Player API, auto-advancing to the next video
   ========================================================================= */

(function () {
  "use strict";

  // ---- State ----
  var videos = [];          // { id, title }
  var selected = 0;         // selected tile index on the grid
  var current = -1;         // index currently playing
  var player = null;        // YT.Player instance
  var ytApiReady = false;
  var pendingPlay = null;   // index queued before the API finished loading
  var isPlaying = false;    // current play/pause state
  var hideTimer = null;     // auto-hide timer for the controls bar
  var zone = "grid";        // navigation focus: "grid", "header" or "sheets"
  var headerSel = 1;        // header buttons: 0 = reload (🔄), 1 = settings (⚙️)
  var screenW = 0, screenH = 0; // logical (CSS px) size from the projector's real resolution

  var spreadsheetId = "";   // current spreadsheet id
  var sheets = [];          // [{ name, gid }] tabs in the spreadsheet
  var currentGid = null;    // gid of the tab currently shown
  var sheetSel = 0;         // selected tab index when navigating the panel

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var gridScreen = $("grid-screen");
  var playerScreen = $("player-screen");
  var settingsScreen = $("settings-screen");
  var mainEl = $("main");
  var gridEl = $("grid");
  var sheetPanel = $("sheet-panel");
  var sheetListEl = $("sheet-list");
  var statusEl = $("status");
  var nowPlayingEl = $("now-playing");
  var controlsEl = $("controls");
  var playPauseBtn = $("play-pause");
  var reloadBtn = $("reload-btn");
  var settingsBtn = $("settings-btn");
  var sheetInput = $("sheet-input");
  var settingsMsg = $("settings-msg");
  var versionEl = $("app-version");

  var hasNative = typeof window.Native !== "undefined";

  // Default Google Sheet — used on first launch so nothing needs to be typed
  // on the projector. Manage videos by editing this sheet on your phone, then
  // pressing 🔄 on the projector.
  var DEFAULT_SHEET_URL = "https://docs.google.com/spreadsheets/d/1bqqdtQWj7kUGUZ2mw6UoreMN-5rAR2x60622cUbZbaA/edit?usp=sharing";

  // =======================================================================
  // Sheet URL helpers
  // =======================================================================
  function getSavedUrl() {
    var u = "";
    if (hasNative) { try { u = window.Native.getSheetUrl() || ""; } catch (e) {} }
    if (!u) u = localStorage.getItem("sheetUrl") || "";
    if (!u) u = DEFAULT_SHEET_URL; // chưa cấu hình -> dùng link mặc định
    return u;
  }
  function saveUrl(url) {
    if (hasNative) { try { window.Native.saveSheetUrl(url); } catch (e) {} }
    localStorage.setItem("sheetUrl", url);
  }

  // Turn whatever the user pasted into a CSV-export endpoint.
  function toCsvUrl(raw) {
    raw = (raw || "").trim();
    if (!raw) return "";
    // Already an export/CSV link
    if (raw.indexOf("output=csv") >= 0 || raw.indexOf("tqx=out:csv") >= 0) return raw;

    var id = null, gid = null;
    var mId = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (mId) id = mId[1];
    else if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) id = raw; // bare id

    var mGid = raw.match(/[#?&]gid=([0-9]+)/);
    if (mGid) gid = mGid[1];

    if (!id) return raw; // give it to the fetcher as-is, may still work
    var url = "https://docs.google.com/spreadsheets/d/" + id + "/gviz/tq?tqx=out:csv";
    if (gid) url += "&gid=" + gid;
    return url;
  }

  function extractId(raw) {
    raw = (raw || "").trim();
    var m = raw.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    if (m) return m[1];
    if (/^[a-zA-Z0-9-_]{20,}$/.test(raw)) return raw;
    return "";
  }
  function gidFromUrl(raw) {
    var m = (raw || "").match(/[#?&]gid=([0-9]+)/);
    return m ? m[1] : null;
  }
  function csvUrlForGid(gid) {
    var url = "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/gviz/tq?tqx=out:csv";
    if (gid != null && gid !== "") url += "&gid=" + gid;
    return url;
  }
  function htmlviewUrl() {
    return "https://docs.google.com/spreadsheets/d/" + spreadsheetId + "/htmlview";
  }

  // =======================================================================
  // CSV parsing (handles quotes, commas and newlines inside quotes)
  // =======================================================================
  function parseCsv(text) {
    var rows = [], row = [], field = "", i = 0, inQuotes = false;
    while (i < text.length) {
      var c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          inQuotes = false; i++; continue;
        }
        field += c; i++; continue;
      }
      if (c === '"') { inQuotes = true; i++; continue; }
      if (c === ",") { row.push(field); field = ""; i++; continue; }
      if (c === "\r") { i++; continue; }
      if (c === "\n") { row.push(field); rows.push(row); row = []; field = ""; i++; continue; }
      field += c; i++;
    }
    if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
    return rows;
  }

  function extractYouTubeId(text) {
    if (!text) return null;
    var m = text.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|[?&]v=)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    var bare = text.trim().match(/^[A-Za-z0-9_-]{11}$/);
    if (bare) return bare[0];
    return null;
  }

  function rowsToVideos(rows) {
    var out = [];
    for (var r = 0; r < rows.length; r++) {
      var cells = rows[r];
      var id = null, idCell = -1;
      for (var c = 0; c < cells.length; c++) {
        var got = extractYouTubeId(cells[c]);
        if (got) { id = got; idCell = c; break; }
      }
      if (!id) continue; // header row or empty row -> skipped
      var title = "";
      for (var k = 0; k < cells.length; k++) {
        if (k === idCell) continue;
        var t = (cells[k] || "").trim();
        if (t) { title = t; break; }
      }
      if (!title) title = "Video " + (out.length + 1);
      out.push({ id: id, title: title });
    }
    return out;
  }

  // =======================================================================
  // Loading
  // =======================================================================
  function setStatus(msg) { statusEl.textContent = msg || ""; }

  function loadVideos() {
    var saved = getSavedUrl();
    spreadsheetId = extractId(saved);
    if (currentGid == null) currentGid = gidFromUrl(saved);
    var url = spreadsheetId ? csvUrlForGid(currentGid) : toCsvUrl(saved);
    setStatus("Loading videos…");
    if (spreadsheetId) loadSheets();   // discover the spreadsheet's tabs
    fetchCsv(url);
  }

  function fetchCsv(url) {
    if (hasNative) {
      try { window.Native.fetchCsv(url); return; } catch (e) {}
    }
    // Browser fallback (preview only)
    fetch(url).then(function (r) { return r.text(); })
      .then(function (t) { window.onCsvLoaded(t); })
      .catch(function (e) { window.onCsvError(String(e)); });
  }

  // ----- Tabs / playlists -----
  function loadSheets() {
    if (!spreadsheetId) return;
    if (hasNative) {
      try { window.Native.fetchSheets(htmlviewUrl()); return; } catch (e) {}
    }
    fetch(htmlviewUrl()).then(function (r) { return r.text(); })
      .then(function (t) { window.onSheetsHtml(t); })
      .catch(function () {});
  }

  window.onSheetsHtml = function (html) {
    var list = [], re = /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"[^"]*?gid\\?=(\d+)/g, m;
    while ((m = re.exec(html)) !== null) {
      list.push({ name: m[1].replace(/\\(.)/g, "$1"), gid: m[2] });
    }
    sheets = list;
    if (currentGid == null && sheets.length) currentGid = sheets[0].gid;
    renderSheetPanel();
  };
  window.onSheetsError = function () { sheets = []; renderSheetPanel(); };

  function selectSheet(i) {
    if (i < 0 || i >= sheets.length) return;
    sheetSel = i;
    currentGid = sheets[i].gid;
    selected = 0;
    zone = "grid";
    setStatus("Loading videos…");
    fetchCsv(csvUrlForGid(currentGid));
    renderSheetPanel();
  }

  function showCachedOrSettings() {
    var cached = localStorage.getItem("videosCache");
    if (cached) {
      try { videos = JSON.parse(cached); } catch (e) { videos = []; }
    }
    if (videos.length) { renderGrid(); setStatus("No sheet configured — showing the saved list."); }
    else { openSettings("Paste your Google Sheet link to get started."); }
  }

  // Called from native (or fetch fallback)
  window.onCsvLoaded = function (csv) {
    var parsed = rowsToVideos(parseCsv(csv || ""));
    if (!parsed.length) {
      setStatus("");
      if (videos.length) { renderGrid(); }
      openSettings("No videos found in this sheet. Make sure column B has YouTube links and the sheet is shared publicly.");
      return;
    }
    videos = parsed;
    localStorage.setItem("videosCache", JSON.stringify(videos));
    setStatus("");
    renderGrid();
  };

  window.onCsvError = function (msg) {
    setStatus("");
    var cached = localStorage.getItem("videosCache");
    if (cached && !videos.length) { try { videos = JSON.parse(cached); } catch (e) {} }
    if (videos.length) {
      renderGrid();
      setStatus("Network error — showing the saved list.");
    } else {
      openSettings("Load error: " + (msg || "") + "\nCheck your network and the sheet's sharing permission.");
    }
  };

  // =======================================================================
  // Grid
  // =======================================================================
  function renderGrid() {
    gridEl.innerHTML = "";
    for (var i = 0; i < videos.length; i++) {
      (function (i) {
        var v = videos[i];
        var tile = document.createElement("div");
        tile.className = "tile";
        tile.tabIndex = 0;
        tile.setAttribute("data-index", i);

        var img = document.createElement("img");
        img.className = "thumb";
        img.src = "https://i.ytimg.com/vi/" + v.id + "/hqdefault.jpg";
        img.onerror = function () { img.src = "https://img.youtube.com/vi/" + v.id + "/0.jpg"; };

        var label = document.createElement("div");
        label.className = "label";
        var num = document.createElement("span");
        num.className = "num";
        num.textContent = (i + 1);
        var txt = document.createElement("span");
        txt.className = "txt";
        txt.textContent = v.title;
        label.appendChild(num);
        label.appendChild(txt);

        tile.appendChild(img);
        tile.appendChild(label);
        tile.addEventListener("click", function () { selected = i; play(i); });
        gridEl.appendChild(tile);
      })(i);
    }
    if (selected >= videos.length) selected = 0;
    updateSelection();
  }

  function tiles() { return gridEl.querySelectorAll(".tile"); }

  function updateSelection() {
    var t = tiles();
    for (var i = 0; i < t.length; i++) t[i].classList.toggle("selected", i === selected);
    if (zone !== "grid") return;
    if (t[selected]) {
      t[selected].focus();
      t[selected].scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }

  // Move focus between the header buttons (🔄 / ⚙️) and back to the grid.
  function focusHeader(i) {
    headerSel = i;
    (i === 0 ? reloadBtn : settingsBtn).focus();
  }
  function setZoneHeader() { zone = "header"; focusHeader(headerSel); }
  function setZoneGrid() { zone = "grid"; updateSheetSelection(); updateSelection(); }

  // ----- Playlists side panel -----
  function renderSheetPanel() {
    sheetListEl.innerHTML = "";
    if (sheets.length <= 1) { mainEl.classList.remove("show-panel"); return; }
    mainEl.classList.add("show-panel");
    for (var i = 0; i < sheets.length; i++) {
      (function (i) {
        var s = sheets[i];
        var b = document.createElement("button");
        b.className = "sheet-item" + (s.gid === currentGid ? " current" : "");
        b.textContent = s.name;
        b.tabIndex = 0;
        b.addEventListener("click", function () { selectSheet(i); });
        sheetListEl.appendChild(b);
      })(i);
    }
    for (var k = 0; k < sheets.length; k++) if (sheets[k].gid === currentGid) sheetSel = k;
    updateSheetSelection();
  }

  function sheetItems() { return sheetListEl.querySelectorAll(".sheet-item"); }

  function updateSheetSelection() {
    var it = sheetItems();
    for (var i = 0; i < it.length; i++) {
      it[i].classList.toggle("sel", i === sheetSel && zone === "sheets");
    }
    if (zone === "sheets" && it[sheetSel]) {
      it[sheetSel].focus();
      it[sheetSel].scrollIntoView({ block: "nearest" });
    }
  }

  function setZoneSheets() {
    if (sheets.length <= 1) return;
    zone = "sheets";
    for (var k = 0; k < sheets.length; k++) if (sheets[k].gid === currentGid) sheetSel = k;
    updateSheetSelection();
  }

  function columnsCount() {
    var t = tiles();
    if (t.length < 2) return 1;
    var top0 = t[0].offsetTop, n = 1;
    for (var i = 1; i < t.length; i++) {
      if (t[i].offsetTop === top0) n++; else break;
    }
    return n || 1;
  }

  function moveSelection(dx, dy) {
    var cols = columnsCount();
    var n = videos.length;
    if (!n) return;
    var idx = selected;
    if (dx) idx += dx;
    if (dy) idx += dy * cols;
    if (idx < 0) idx = 0;
    if (idx >= n) idx = n - 1;
    selected = idx;
    updateSelection();
  }

  // =======================================================================
  // YouTube player
  // =======================================================================
  function loadYouTubeApi() {
    if (window.YT && window.YT.Player) { ytApiReady = true; return; }
    if (document.getElementById("yt-api")) return;
    var tag = document.createElement("script");
    tag.id = "yt-api";
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  }

  window.onYouTubeIframeAPIReady = function () {
    ytApiReady = true;
    if (pendingPlay !== null) {
      var idx = pendingPlay; pendingPlay = null; play(idx);
    }
  };

  // Called from native (MainActivity) with the projector's REAL resolution.
  // We size everything in CSS pixels (= real px / density) so the page fills
  // the screen exactly, instead of relying on hard-coded sizes.
  window.applyScreen = function (wPx, hPx, density) {
    if (!density || density <= 0) density = 1;
    screenW = Math.round(wPx / density);
    screenH = Math.round(hPx / density);
    var css =
      "html,body{width:" + screenW + "px;height:" + screenH + "px;overflow:hidden;}" +
      "#player-screen,#player,#player iframe,#tap-layer{" +
      "width:" + screenW + "px!important;height:" + screenH + "px!important;left:0!important;top:0!important;}";
    var el = document.getElementById("screen-fit");
    if (!el) { el = document.createElement("style"); el.id = "screen-fit"; document.head.appendChild(el); }
    el.textContent = css;
    if (player && player.setSize) { try { player.setSize(screenW, screenH); } catch (e) {} }
  };

  function showScreen(which) {
    gridScreen.classList.toggle("active", which === "grid");
    playerScreen.classList.toggle("active", which === "player");
  }

  function play(index) {
    if (index < 0 || index >= videos.length) return;
    current = index;
    showScreen("player");
    nowPlayingEl.textContent = videos[index].title;
    isPlaying = true;
    playPauseBtn.textContent = "⏸";
    showControls();

    if (!ytApiReady) { pendingPlay = index; loadYouTubeApi(); return; }

    var vars = {
      autoplay: 1, rel: 0, modestbranding: 1, fs: 1,
      playsinline: 1, controls: 0, iv_load_policy: 3,
      origin: window.location.origin,
      widget_referrer: window.location.href
    };
    if (!player) {
      player = new YT.Player("player", {
        width: "100%", height: "100%",
        videoId: videos[index].id,
        playerVars: vars,
        events: {
          onReady: function (e) {
            if (screenW) { try { e.target.setSize(screenW, screenH); } catch (er) {} }
            e.target.playVideo();
          },
          onStateChange: onPlayerState,
          onError: onPlayerError
        }
      });
    } else {
      player.loadVideoById(videos[index].id);
    }
  }

  function onPlayerState(e) {
    if (e.data === YT.PlayerState.PLAYING) {
      isPlaying = true; playPauseBtn.textContent = "⏸";
    } else if (e.data === YT.PlayerState.PAUSED) {
      isPlaying = false; playPauseBtn.textContent = "▶";
    }
    if (e.data === YT.PlayerState.ENDED) {
      if (current + 1 < videos.length) play(current + 1);
      else returnToGrid();
    }
  }

  // ----- Custom player controls -----
  function showControls() {
    controlsEl.classList.remove("hidden");
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(function () { controlsEl.classList.add("hidden"); }, 4500);
  }
  function togglePlay() {
    if (!player) return;
    if (isPlaying) { try { player.pauseVideo(); } catch (e) {} }
    else { try { player.playVideo(); } catch (e) {} }
    showControls();
  }
  function seek(delta) {
    if (!player || !player.getCurrentTime) return;
    var t = player.getCurrentTime() + delta;
    if (t < 0) t = 0;
    try { player.seekTo(t, true); } catch (e) {}
    showControls();
  }
  function doAction(act) {
    switch (act) {
      case "prev": if (current - 1 >= 0) play(current - 1); break;
      case "next": if (current + 1 < videos.length) play(current + 1); break;
      case "back10": seek(-10); break;
      case "fwd10": seek(10); break;
      case "playpause": togglePlay(); break;
    }
    showControls();
  }

  function onPlayerError() {
    // Video can't be embedded / removed -> skip to the next one.
    if (current + 1 < videos.length) {
      nowPlayingEl.textContent = "Skipping a video that can't play…";
      setTimeout(function () { play(current + 1); }, 1200);
    } else {
      returnToGrid();
    }
  }

  function returnToGrid() {
    if (player) { try { player.stopVideo(); } catch (e) {} }
    if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
    current = -1;
    showScreen("grid");
    zone = "grid";
    updateSelection();
  }

  // =======================================================================
  // Settings
  // =======================================================================
  function openSettings(msg) {
    sheetInput.value = getSavedUrl();
    settingsMsg.textContent = msg || "";
    if (versionEl) {
      var ver = "";
      if (hasNative) { try { ver = window.Native.getAppVersion() || ""; } catch (e) {} }
      versionEl.textContent = ver ? ("Version " + ver) : "";
    }
    settingsScreen.classList.add("active");
    setTimeout(function () { sheetInput.focus(); }, 50);
  }
  function closeSettings() {
    settingsScreen.classList.remove("active");
    if (gridScreen.classList.contains("active")) { zone = "grid"; updateSelection(); }
  }

  function saveSettings() {
    var val = sheetInput.value.trim();
    if (!val) { settingsMsg.textContent = "Please paste the sheet link."; return; }
    saveUrl(val);
    currentGid = null;   // new spreadsheet -> re-derive the tab
    sheets = [];
    renderSheetPanel();
    closeSettings();
    loadVideos();
  }

  // Exposed for the Menu key (from MainActivity)
  window.appOpenSettings = function () { openSettings(""); };

  // =======================================================================
  // Back handling (called from MainActivity.onBackPressed)
  // Returns true if handled by the web layer.
  // =======================================================================
  window.appHandleBack = function () {
    if (settingsScreen.classList.contains("active")) { closeSettings(); return true; }
    if (playerScreen.classList.contains("active")) { returnToGrid(); return true; }
    if (zone !== "grid") { setZoneGrid(); return true; }
    return false; // on the grid -> let the app go to background
  };

  window.appPause = function () {
    if (player && playerScreen.classList.contains("active")) {
      try { player.pauseVideo(); } catch (e) {}
    }
  };

  // =======================================================================
  // Keyboard / remote (D-pad) navigation
  // =======================================================================
  document.addEventListener("keydown", function (ev) {
    var key = ev.key;

    // Settings overlay: let typing happen, only intercept Enter/Escape
    if (settingsScreen.classList.contains("active")) {
      if (key === "Enter") { ev.preventDefault(); saveSettings(); }
      else if (key === "Escape" || key === "GoBack") { ev.preventDefault(); closeSettings(); }
      return;
    }

    // Player screen
    if (playerScreen.classList.contains("active")) {
      showControls();
      switch (key) {
        case "Escape": case "Backspace": case "GoBack":
          ev.preventDefault(); returnToGrid(); break;
        case "Enter": case " ":
        case "MediaPlayPause": case "MediaPlay": case "MediaPause":
          ev.preventDefault(); togglePlay(); break;
        case "ArrowLeft":  ev.preventDefault(); seek(-10); break;
        case "ArrowRight": ev.preventDefault(); seek(10); break;
        case "ArrowUp":    ev.preventDefault(); doAction("prev"); break;
        case "ArrowDown":  ev.preventDefault(); doAction("next"); break;
        case "MediaTrackNext":     doAction("next"); break;
        case "MediaTrackPrevious": doAction("prev"); break;
      }
      return;
    }

    // Header zone (the 🔄 / ⚙️ buttons)
    if (zone === "header") {
      switch (key) {
        case "ArrowLeft":  ev.preventDefault(); focusHeader(0); break;
        case "ArrowRight": ev.preventDefault(); focusHeader(1); break;
        case "ArrowDown":  ev.preventDefault(); setZoneGrid(); break;
        case "Enter": case " ":
          ev.preventDefault();
          (headerSel === 0 ? reloadBtn : settingsBtn).click();
          break;
      }
      return;
    }

    // Playlists panel zone
    if (zone === "sheets") {
      switch (key) {
        case "ArrowUp":   ev.preventDefault(); sheetSel = Math.max(0, sheetSel - 1); updateSheetSelection(); break;
        case "ArrowDown": ev.preventDefault(); sheetSel = Math.min(sheets.length - 1, sheetSel + 1); updateSheetSelection(); break;
        case "ArrowLeft": ev.preventDefault(); setZoneGrid(); break;
        case "Enter": case " ": ev.preventDefault(); selectSheet(sheetSel); break;
      }
      return;
    }

    // Grid zone
    var cols = columnsCount();
    switch (key) {
      case "ArrowRight":
        ev.preventDefault();
        if (sheets.length > 1 && (selected % cols === cols - 1 || selected === videos.length - 1)) {
          setZoneSheets();              // right edge -> playlists panel
        } else moveSelection(1, 0);
        break;
      case "ArrowLeft":  ev.preventDefault(); moveSelection(-1, 0); break;
      case "ArrowDown":  ev.preventDefault(); moveSelection(0, 1); break;
      case "ArrowUp":
        ev.preventDefault();
        if (selected < cols) setZoneHeader();  // top row -> header
        else moveSelection(0, -1);
        break;
      case "Enter":
      case " ":
        ev.preventDefault();
        if (videos.length) play(selected);
        break;
    }
  });

  // =======================================================================
  // Wire up buttons
  // =======================================================================
  $("settings-btn").addEventListener("click", function () { openSettings(""); });
  $("reload-btn").addEventListener("click", function () { loadVideos(); });
  $("back-btn").addEventListener("click", returnToGrid);
  $("settings-save").addEventListener("click", saveSettings);
  $("settings-cancel").addEventListener("click", closeSettings);

  // Player control bar
  var ctrlBtns = controlsEl.querySelectorAll(".ctrl-btn");
  for (var ci = 0; ci < ctrlBtns.length; ci++) {
    (function (b) {
      b.addEventListener("click", function () { doAction(b.getAttribute("data-act")); });
    })(ctrlBtns[ci]);
  }
  // Keep header zone state in sync when navigating by touch/focus
  reloadBtn.addEventListener("focus", function () { zone = "header"; headerSel = 0; });
  settingsBtn.addEventListener("focus", function () { zone = "header"; headerSel = 1; });

  // Touch on the video: reveal controls, tap again to play/pause
  $("tap-layer").addEventListener("click", function () {
    if (controlsEl.classList.contains("hidden")) showControls();
    else togglePlay();
  });

  // =======================================================================
  // Start
  // =======================================================================
  loadYouTubeApi();
  loadVideos();

})();

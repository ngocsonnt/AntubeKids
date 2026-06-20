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
  var isPlaying = false;    // current play/pause state (for remote toggle)
  var captionsOn = false;   // show YouTube captions (CC) by default
  var playerCcOn = false;   // the cc state the current player was built with
  var progressTimer = null; // ticks while a video plays to update time/progress
  var zone = "grid";        // navigation focus: "grid", "header" or "sheets"
  var headerSel = 1;        // header buttons: 0 = reload (🔄), 1 = settings (⚙️)
  var screenW = 0, screenH = 0; // logical (CSS px) size from the projector's real resolution

  var durations = {};       // { videoId: seconds } — cached clip durations
  var spreadsheetId = "";   // current spreadsheet id
  var sheets = [];          // [{ name, gid }] tabs in the spreadsheet
  var currentGid = null;    // gid of the tab currently shown
  var sheetSel = 0;         // selected tab index when navigating the panel
  var scheduleGid = null;   // gid of the hidden "Schedule" tab (if any)
  var scheduleWindows = []; // [{ days:[0..6], start:min, end:min }] allowed watching times
  var scheduleTicker = null; // periodic schedule re-check + countdown refresh

  // ---- DOM ----
  var $ = function (id) { return document.getElementById(id); };
  var gridScreen = $("grid-screen");
  var playerScreen = $("player-screen");
  var settingsScreen = $("settings-screen");
  var phoneScreen = $("phone-screen");
  var phoneUrlEl = $("phone-url");
  var phoneStatusEl = $("phone-status");
  var blockedScreen = $("blocked-screen");
  var blockedMsg = $("blocked-msg");
  var countdownEl = $("countdown");
  var mainEl = $("main");
  var gridEl = $("grid");
  var sheetPanel = $("sheet-panel");
  var sheetListEl = $("sheet-list");
  var statusEl = $("status");
  var nowPlayingEl = $("now-playing");
  var timeEl = $("time");
  var progressFill = $("progress-fill");
  var reloadBtn = $("reload-btn");
  var settingsBtn = $("settings-btn");
  var sheetInput = $("sheet-input");
  var settingsMsg = $("settings-msg");
  var versionEl = $("app-version");
  var updateBanner = $("update-banner");
  var updateText = $("update-text");
  var updateBtn = $("update-btn");
  var updateInfo = null;

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
    setStatus("Loading…");
    if (!spreadsheetId) { fetchCsv(toCsvUrl(saved)); return; }
    loadSheets();                                                 // resolves tabs (excludes Schedule) then loads the right tab
    if (currentGid != null) fetchCsv(csvUrlForGid(currentGid));   // a known tab -> load now for speed
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
    var all = [], re = /items\.push\(\{name:\s*"((?:[^"\\]|\\.)*)",\s*pageUrl:\s*"[^"]*?gid\\?=(\d+)/g, m;
    while ((m = re.exec(html)) !== null) {
      all.push({ name: m[1].replace(/\\(.)/g, "$1"), gid: m[2] });
    }
    // Pull out the hidden "Schedule" tab; the rest are playlists.
    scheduleGid = null;
    sheets = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].name.trim().toLowerCase() === "schedule") scheduleGid = all[i].gid;
      else sheets.push(all[i]);
    }
    // Make sure the shown tab is a real (non-schedule) playlist.
    var ok = false;
    for (var k = 0; k < sheets.length; k++) if (sheets[k].gid === currentGid) ok = true;
    if (!ok) currentGid = sheets.length ? sheets[0].gid : null;
    renderSheetPanel();
    if (currentGid != null) { setStatus("Loading…"); fetchCsv(csvUrlForGid(currentGid)); }

    // Load (or clear) the watching-time schedule.
    if (scheduleGid != null && hasNative) {
      try { window.Native.fetchSchedule(csvUrlForGid(scheduleGid)); } catch (e) {}
    } else {
      scheduleWindows = [];
      enforceSchedule();
    }
  };
  window.onSheetsError = function () {
    sheets = []; scheduleGid = null; renderSheetPanel();
    if (spreadsheetId && !videos.length) fetchCsv(csvUrlForGid(currentGid));
  };

  // ----- Watching-time schedule (hidden "Schedule" tab) -----
  window.onScheduleCsv = function (csv) {
    scheduleWindows = parseSchedule(parseCsv(csv || ""));
    enforceSchedule();
  };
  window.onScheduleError = function () { scheduleWindows = []; enforceSchedule(); };

  function parseHM(s) {
    s = (s || "").trim().toLowerCase();
    var m = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
    if (m) {
      var h = +m[1], min = m[2] ? +m[2] : 0, ap = m[3];
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      return h * 60 + min;
    }
    m = s.match(/^(\d{1,2})h(\d{2})?$/);            // "18h", "18h30"
    if (m) return (+m[1]) * 60 + (m[2] ? +m[2] : 0);
    return null;
  }

  function parseDays(s) {
    s = (s || "").trim().toLowerCase();
    if (!s) return [];
    if (/daily|every ?day|^all$|hằng|mỗi/.test(s)) return [0, 1, 2, 3, 4, 5, 6];
    if (/weekday/.test(s)) return [1, 2, 3, 4, 5];
    if (/weekend/.test(s)) return [0, 6];
    var map = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2,
                wed: 3, weds: 3, wednesday: 3, thu: 4, thur: 4, thurs: 4, thursday: 4,
                fri: 5, friday: 5, sat: 6, saturday: 6 };
    var rng = s.match(/^([a-z]+)\s*-\s*([a-z]+)$/);
    if (rng && map[rng[1]] != null && map[rng[2]] != null) {
      var a = map[rng[1]], b = map[rng[2]], out = [], cur = a;
      for (var k = 0; k < 7; k++) { out.push(cur); if (cur === b) break; cur = (cur + 1) % 7; }
      return out;
    }
    var parts = s.split(/[,\/ ]+/), res = [];
    for (var p = 0; p < parts.length; p++) {
      if (map[parts[p]] != null && res.indexOf(map[parts[p]]) < 0) res.push(map[parts[p]]);
    }
    return res;
  }

  function parseSchedule(rows) {
    var wins = [];
    for (var r = 0; r < rows.length; r++) {
      var c = rows[r];
      if (!c || c.length < 3) continue;
      var days = parseDays(c[0]), st = parseHM(c[1]), en = parseHM(c[2]);
      if (days.length && st != null && en != null) wins.push({ days: days, start: st, end: en });
    }
    return wins;
  }

  function isAllowedAt(date) {
    if (!scheduleWindows.length) return true;     // no schedule -> always allowed
    var day = date.getDay(), mins = date.getHours() * 60 + date.getMinutes();
    for (var i = 0; i < scheduleWindows.length; i++) {
      var w = scheduleWindows[i];
      if (w.end > w.start) {
        if (w.days.indexOf(day) >= 0 && mins >= w.start && mins < w.end) return true;
      } else {                                     // window crosses midnight
        if (w.days.indexOf(day) >= 0 && mins >= w.start) return true;
        if (w.days.indexOf((day + 6) % 7) >= 0 && mins < w.end) return true;
      }
    }
    return false;
  }
  function isAllowedNow() { return isAllowedAt(new Date()); }

  function nextAllowed(now) {
    for (var add = 0; add <= 7; add++) {
      var d = new Date(now.getTime());
      d.setDate(now.getDate() + add);
      var day = d.getDay(), starts = [];
      for (var i = 0; i < scheduleWindows.length; i++) {
        if (scheduleWindows[i].days.indexOf(day) >= 0) starts.push(scheduleWindows[i].start);
      }
      starts.sort(function (a, b) { return a - b; });
      for (var s = 0; s < starts.length; s++) {
        var cand = new Date(d.getTime());
        cand.setHours(Math.floor(starts[s] / 60), starts[s] % 60, 0, 0);
        if (cand.getTime() > now.getTime()) return cand;
      }
    }
    return null;
  }

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }
  function fmt12(d) {
    var h = d.getHours(), m = d.getMinutes();
    var ap = h >= 12 ? "PM" : "AM";
    var h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ":" + pad2(m) + " " + ap;        // e.g. 5:00 PM
  }
  function whenLabel(d) {
    var now = new Date();
    var hm = fmt12(d);
    var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    var tmr = new Date(now.getTime()); tmr.setDate(now.getDate() + 1);
    if (d.toDateString() === now.toDateString()) return hm;             // today -> time only
    if (d.toDateString() === tmr.toDateString()) return "tomorrow " + hm;
    return names[d.getDay()] + " " + hm;
  }

  // End (Date) of the watching window currently covering `now`, or null if none.
  function currentWindowEnd(now) {
    if (!scheduleWindows.length) return null;
    var day = now.getDay(), m = now.getHours() * 60 + now.getMinutes(), best = null;
    for (var i = 0; i < scheduleWindows.length; i++) {
      var w = scheduleWindows[i], cand = null;
      if (w.end > w.start) {
        if (w.days.indexOf(day) >= 0 && m >= w.start && m < w.end) {
          cand = new Date(now); cand.setHours(0, 0, 0, 0); cand.setMinutes(w.end);
        }
      } else { // crosses midnight
        if (w.days.indexOf(day) >= 0 && m >= w.start) {
          cand = new Date(now); cand.setDate(now.getDate() + 1); cand.setHours(0, 0, 0, 0); cand.setMinutes(w.end);
        } else if (w.days.indexOf((day + 6) % 7) >= 0 && m < w.end) {
          cand = new Date(now); cand.setHours(0, 0, 0, 0); cand.setMinutes(w.end);
        }
      }
      if (cand && (!best || cand.getTime() > best.getTime())) best = cand; // latest end among overlapping windows
    }
    return best;
  }

  function humanMins(mins) {
    if (mins < 1) return "less than a minute";
    if (mins < 60) return mins + (mins === 1 ? " minute" : " minutes");
    var h = Math.floor(mins / 60), m = mins % 60;
    return h + (h === 1 ? " hour" : " hours") + (m ? " " + m + " min" : "");
  }

  function overlayOpen() {
    return settingsScreen.classList.contains("active") || phoneScreen.classList.contains("active");
  }
  function hideCountdown() { countdownEl.style.display = "none"; }
  function updateCountdown() {
    var end = currentWindowEnd(new Date());
    if (!end || overlayOpen()) { hideCountdown(); return; }
    var rem = Math.round((end.getTime() - Date.now()) / 60000);
    if (rem < 0) rem = 0;
    countdownEl.textContent = "watching will end in: " + humanMins(rem);
    countdownEl.style.display = "block";
  }

  // Single source of truth: checks the schedule, toggles the blocked screen and
  // the countdown. Called on load, on resume, and every 30s by scheduleTicker.
  function enforceSchedule() {
    if (!scheduleWindows.length) { hideBlocked(); hideCountdown(); return; }
    if (isAllowedNow()) { hideBlocked(); updateCountdown(); }
    else { hideCountdown(); if (!overlayOpen()) showBlocked(); }
  }
  function showBlocked() {
    if (playerScreen.classList.contains("active")) returnToGrid();
    var nxt = nextAllowed(new Date());
    blockedMsg.textContent = "It's out of watching time, see you at: " + (nxt ? whenLabel(nxt) : "—");
    blockedScreen.classList.add("active");
  }
  function hideBlocked() { blockedScreen.classList.remove("active"); }

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

        var wrap = document.createElement("div");
        wrap.className = "thumb-wrap";
        var img = document.createElement("img");
        img.className = "thumb";
        img.src = "https://i.ytimg.com/vi/" + v.id + "/hqdefault.jpg";
        img.onerror = function () { img.src = "https://img.youtube.com/vi/" + v.id + "/0.jpg"; };
        var dur = document.createElement("span");
        dur.className = "dur";
        dur.setAttribute("data-vid", v.id);
        if (durations[v.id]) dur.textContent = fmtTime(durations[v.id]);
        wrap.appendChild(img);
        wrap.appendChild(dur);

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

        tile.appendChild(wrap);
        tile.appendChild(label);
        tile.addEventListener("click", function () { selected = i; play(i); });
        gridEl.appendChild(tile);
      })(i);
    }
    if (selected >= videos.length) selected = 0;
    updateSelection();
  }

  // ----- Clip durations -----
  // Captured from the player while a video plays (see updateProgress) and cached.
  // We no longer scrape YouTube watch pages — that got rate-limited (HTTP 429) and
  // made every launch slow.
  function loadDurations() {
    try { durations = JSON.parse(localStorage.getItem("durations") || "{}"); }
    catch (e) { durations = {}; }
  }
  function saveDurations() {
    try { localStorage.setItem("durations", JSON.stringify(durations)); } catch (e) {}
  }
  function setDuration(id, secs) {
    if (!secs || secs <= 0) return;
    secs = Math.round(secs);
    if (durations[id] === secs) return;
    durations[id] = secs;
    saveDurations();
    var els = gridEl.querySelectorAll('.dur[data-vid="' + id + '"]');
    for (var i = 0; i < els.length; i++) els[i].textContent = fmtTime(secs);
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
      "#player-screen,#player,#player iframe{" +
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
    if (scheduleWindows.length && !isAllowedNow()) { showBlocked(); return; }
    current = index;
    showScreen("player");
    nowPlayingEl.textContent = videos[index].title;
    isPlaying = true;
    startProgress();
    updateCountdown();

    if (!ytApiReady) { pendingPlay = index; loadYouTubeApi(); return; }

    var vars = {
      autoplay: 1, rel: 0, modestbranding: 1, fs: 1,
      playsinline: 1, controls: 1, iv_load_policy: 3,
      cc_load_policy: captionsOn ? 1 : 0,
      origin: window.location.origin,
      widget_referrer: window.location.href
    };
    // The caption setting is an embed param, so rebuild the player if it changed.
    if (player && playerCcOn !== captionsOn) {
      try { player.destroy(); } catch (e) {}
      player = null;
    }
    if (!player) {
      player = new YT.Player("player", {
        width: "100%", height: "100%",
        videoId: videos[index].id,
        playerVars: vars,
        events: {
          onReady: function (e) {
            if (screenW) { try { e.target.setSize(screenW, screenH); } catch (er) {} }
            if (captionsOn) { try { e.target.setOption("captions", "reload", true); } catch (er) {} }
            e.target.playVideo();
          },
          onStateChange: onPlayerState,
          onError: onPlayerError
        }
      });
      playerCcOn = captionsOn;
    } else {
      player.loadVideoById(videos[index].id);
    }
  }

  function onPlayerState(e) {
    if (e.data === YT.PlayerState.PLAYING) isPlaying = true;
    else if (e.data === YT.PlayerState.PAUSED) isPlaying = false;
    if (e.data === YT.PlayerState.ENDED) {
      if (current + 1 < videos.length) play(current + 1);
      else returnToGrid();
    }
  }

  // ----- Remote control helpers (YouTube shows its own on-screen controls) -----
  function togglePlay() {
    if (!player) return;
    if (isPlaying) { try { player.pauseVideo(); } catch (e) {} }
    else { try { player.playVideo(); } catch (e) {} }
  }
  function seek(delta) {
    if (!player || !player.getCurrentTime) return;
    var t = player.getCurrentTime() + delta;
    if (t < 0) t = 0;
    try { player.seekTo(t, true); } catch (e) {}
    updateProgress();
  }

  // ----- Always-on time + progress bar -----
  function fmtTime(t) {
    t = Math.max(0, Math.floor(t || 0));
    var h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), s = t % 60;
    var mm = (h > 0 && m < 10 ? "0" : "") + m;
    var ss = (s < 10 ? "0" : "") + s;
    return (h > 0 ? h + ":" : "") + mm + ":" + ss;
  }
  function updateProgress() {
    if (scheduleWindows.length && !isAllowedNow()) { returnToGrid(); showBlocked(); return; }
    if (!player || !player.getCurrentTime || !player.getDuration) return;
    var cur = player.getCurrentTime() || 0;
    var dur = player.getDuration() || 0;
    timeEl.textContent = fmtTime(cur) + " / " + fmtTime(dur);
    progressFill.style.width = (dur > 0 ? Math.min(100, cur / dur * 100) : 0) + "%";
    if (dur > 0 && current >= 0 && current < videos.length) setDuration(videos[current].id, dur);
  }
  function startProgress() {
    stopProgress();
    timeEl.textContent = "0:00 / 0:00";
    progressFill.style.width = "0%";
    progressTimer = setInterval(updateProgress, 500);
  }
  function stopProgress() {
    if (progressTimer) { clearInterval(progressTimer); progressTimer = null; }
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
    stopProgress();
    current = -1;
    showScreen("grid");
    zone = "grid";
    updateSelection();
    enforceSchedule();
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
    refreshUpdateLine();
    checkUpdate();
    settingsScreen.classList.add("active");
    setTimeout(function () { sheetInput.focus(); }, 50);
  }
  function closeSettings() {
    settingsScreen.classList.remove("active");
    if (gridScreen.classList.contains("active")) { zone = "grid"; updateSelection(); }
    enforceSchedule();
  }

  // Focusable controls inside the Settings dialog, in navigation order.
  function settingsFocusables() {
    var list = [sheetInput, $("settings-save"), $("settings-cancel"), $("cc-btn"), $("phone-btn")];
    if (updateBtn && updateBtn.style.display !== "none") list.push(updateBtn);
    return list;
  }

  // ----- Captions (CC) toggle -----
  function loadCc() { captionsOn = localStorage.getItem("cc") === "1"; updateCcLabel(); }
  function updateCcLabel() {
    var b = $("cc-btn");
    if (b) b.textContent = "Captions (CC): " + (captionsOn ? "On" : "Off");
  }
  function toggleCc() {
    captionsOn = !captionsOn;
    localStorage.setItem("cc", captionsOn ? "1" : "0");
    updateCcLabel();
    if (player) {
      try { player.destroy(); } catch (e) {}
      player = null;
      if (playerScreen.classList.contains("active") && current >= 0) play(current);
    }
  }

  // ----- Enter link from phone (Wi-Fi mini web server) -----
  function openPhone() {
    if (!hasNative) { phoneStatusEl.textContent = ""; }
    var url = "";
    if (hasNative) { try { url = window.Native.startConfigServer() || ""; } catch (e) {} }
    if (!url) {
      phoneUrlEl.textContent = "—";
      phoneStatusEl.textContent = "No Wi-Fi connection found. Connect the projector to Wi-Fi and try again.";
    } else {
      phoneUrlEl.textContent = url;
      phoneStatusEl.textContent = "Waiting for your phone…";
    }
    phoneScreen.classList.add("active");
    setTimeout(function () { $("phone-close").focus(); }, 50);
  }
  function closePhone() {
    if (hasNative) { try { window.Native.stopConfigServer(); } catch (e) {} }
    phoneScreen.classList.remove("active");
    // settings overlay is still underneath; restore focus there
    setTimeout(function () { $("phone-btn").focus(); }, 50);
    enforceSchedule();
  }
  window.onConfigReceived = function (url) {
    phoneStatusEl.textContent = "✅ Received! Loading…";
    sheetInput.value = url;
    saveUrl(url);
    currentGid = null;
    sheets = [];
    renderSheetPanel();
    loadVideos();
    setTimeout(function () { closePhone(); closeSettings(); }, 1500);
  };
  function moveSettingsFocus(dir) {
    var list = settingsFocusables();
    var idx = list.indexOf(document.activeElement);
    idx = idx < 0 ? 0 : (idx + dir + list.length) % list.length;
    list[idx].focus();
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
  // Self-update (reads update.json on GitHub; downloads + installs the APK)
  // =======================================================================
  function checkUpdate() {
    if (!hasNative) return;
    try { window.Native.checkUpdate(); } catch (e) {}
  }

  window.onUpdateInfo = function (json) {
    try { updateInfo = JSON.parse(json); } catch (e) { return; }
    updateBanner.style.display = updateInfo.available ? "block" : "none";
    if (updateInfo.available) {
      updateBanner.textContent = "🔔 New version " + updateInfo.latest + " available — tap to update";
    }
    refreshUpdateLine();
  };
  window.onUpdateError = function () {
    updateText.textContent = "Couldn't check for updates.";
    updateBtn.style.display = "none";
  };
  window.onUpdateStatus = function (msg) { updateText.textContent = msg || ""; };

  function refreshUpdateLine() {
    if (!updateInfo) { updateText.textContent = "Checking for updates…"; updateBtn.style.display = "none"; return; }
    if (updateInfo.available) {
      updateText.textContent = "New version " + updateInfo.latest + " is available.";
      updateBtn.style.display = "";
    } else {
      updateText.textContent = "You're on the latest version (" + (updateInfo.current || "") + ").";
      updateBtn.style.display = "none";
    }
  }

  // =======================================================================
  // Back handling (called from MainActivity.onBackPressed)
  // Returns true if handled by the web layer.
  // =======================================================================
  window.appHandleBack = function () {
    if (blockedScreen.classList.contains("active")) { hideBlocked(); return true; }
    if (phoneScreen.classList.contains("active")) { closePhone(); return true; }
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

    // Out-of-time screen: any of these just dismisses the message (play stays blocked)
    if (blockedScreen.classList.contains("active")) {
      if (key === "Escape" || key === "GoBack" || key === "Enter" || key === " " || key === "Backspace") {
        ev.preventDefault(); hideBlocked();
      }
      return;
    }

    // "Enter from phone" overlay: only Back/Done/OK closes it
    if (phoneScreen.classList.contains("active")) {
      if (key === "Escape" || key === "GoBack" || key === "Enter" || key === " ") {
        ev.preventDefault(); closePhone();
      }
      return;
    }

    // Settings overlay: keep focus INSIDE the dialog. Arrows cycle the controls,
    // Enter/OK activates the focused one, only Back/Escape closes the dialog.
    if (settingsScreen.classList.contains("active")) {
      switch (key) {
        case "Escape": case "GoBack":
          ev.preventDefault(); closeSettings(); break;
        case "ArrowDown": case "ArrowRight":
          ev.preventDefault(); moveSettingsFocus(1); break;
        case "ArrowUp": case "ArrowLeft":
          ev.preventDefault(); moveSettingsFocus(-1); break;
        case "Enter":
          ev.preventDefault();
          var el = document.activeElement;
          if (el && el.tagName === "BUTTON") el.click();
          else saveSettings();
          break;
        // any other key (letters, Backspace…) passes through to the text field
      }
      return;
    }

    // Player screen (YouTube shows its own controls; remote keys drive the API)
    if (playerScreen.classList.contains("active")) {
      switch (key) {
        case "Escape": case "Backspace": case "GoBack":
          ev.preventDefault(); returnToGrid(); break;
        case "Enter": case " ":
        case "MediaPlayPause": case "MediaPlay": case "MediaPause":
          ev.preventDefault(); togglePlay(); break;
        case "ArrowLeft":  ev.preventDefault(); seek(-10); break;
        case "ArrowRight": ev.preventDefault(); seek(10); break;
        case "ArrowUp": case "MediaTrackPrevious":
          ev.preventDefault(); if (current - 1 >= 0) play(current - 1); break;
        case "ArrowDown": case "MediaTrackNext":
          ev.preventDefault(); if (current + 1 < videos.length) play(current + 1); break;
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
  updateBtn.addEventListener("click", function () {
    if (updateInfo && updateInfo.apkUrl) {
      updateText.textContent = "Starting update…";
      try { window.Native.startUpdate(updateInfo.apkUrl); } catch (e) {}
    }
  });
  updateBanner.addEventListener("click", function () { openSettings(""); });
  $("phone-btn").addEventListener("click", openPhone);
  $("phone-close").addEventListener("click", closePhone);
  $("cc-btn").addEventListener("click", toggleCc);
  blockedScreen.addEventListener("click", hideBlocked);

  // Keep header zone state in sync when navigating by touch/focus
  reloadBtn.addEventListener("focus", function () { zone = "header"; headerSel = 0; });
  settingsBtn.addEventListener("focus", function () { zone = "header"; headerSel = 1; });

  // =======================================================================
  // Start
  // =======================================================================
  loadDurations();
  loadCc();
  loadYouTubeApi();
  loadVideos();
  checkUpdate();   // check GitHub for a newer build on launch
  scheduleTicker = setInterval(enforceSchedule, 30000);  // keep schedule + countdown live

})();

(function () {
  "use strict";

  var els = {
    token: document.getElementById("token"),
    owner: document.getElementById("owner"),
    repo: document.getElementById("repo"),
    branch: document.getElementById("branch"),
    prefix: document.getElementById("prefix"),
    remember: document.getElementById("remember"),
    connectBtn: document.getElementById("connect-btn"),
    connectStatus: document.getElementById("connect-status"),
    rollSection: document.getElementById("roll-section"),
    roll: document.getElementById("roll"),
    uploadSection: document.getElementById("upload-section"),
    drop: document.getElementById("drop"),
    fileInput: document.getElementById("file-input"),
    queue: document.getElementById("queue"),
    publishRow: document.getElementById("publish-row"),
    publishBtn: document.getElementById("publish-btn"),
    publishStatus: document.getElementById("publish-status"),
    log: document.getElementById("log")
  };

  var cfg = null;            // {owner, repo, branch, prefix, token}
  var manifest = [];         // current photos.json contents
  var manifestSha = null;    // sha of photos.json, null if file doesn't exist yet
  var queueItems = [];       // pending uploads: {id, file, blob, base64, filename, caption, category, date}
  var idCounter = 0;

  // ---------- small helpers ----------
  function setStatus(el, text, kind) {
    el.textContent = text;
    el.className = "status-line" + (kind ? " " + kind : "");
  }
  function logLine(text, kind) {
    var div = document.createElement("div");
    if (kind) div.className = kind;
    div.textContent = text;
    els.log.appendChild(div);
    els.log.classList.add("show");
    els.log.scrollTop = els.log.scrollHeight;
  }
  function slugify(s) {
    return (s || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 40) || "frame";
  }
  function todayISO() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function dateToISO(d) {
    if (!(d instanceof Date) || isNaN(d.getTime())) return null;
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function isSupportedImage(file) {
    if (/^image\//.test(file.type)) return true;
    return /\.(heic|heif)$/i.test(file.name || "");
  }
  function isHeic(file) {
    var type = (file.type || "").toLowerCase();
    return type === "image/heic" || type === "image/heif" || /\.(heic|heif)$/i.test(file.name || "");
  }

  // ---------- EXIF: capture date + place ----------
  function readExif(file) {
    if (typeof exifr === "undefined") return Promise.resolve(null);
    return exifr.parse(file, { gps: true, pick: ["DateTimeOriginal", "CreateDate", "Orientation", "latitude", "longitude"] })
      .catch(function () { return null; });
  }

  // reverse-geocode via OSM Nominatim, queued to stay near their 1 req/sec limit
  var geoQueue = Promise.resolve();
  function reverseGeocode(lat, lon) {
    var url = "https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=" + lat + "&lon=" + lon + "&zoom=14&addressdetails=1";
    return fetch(url, { headers: { "Accept-Language": "en" } })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (data) {
        if (!data || !data.address) return null;
        var a = data.address;
        var place = a.suburb || a.neighbourhood || a.city_district || a.town || a.village || a.city || a.county;
        var city = a.city || a.town || a.state || a.country;
        if (place && city && place !== city) return place + ", " + city;
        return place || city || null;
      })
      .catch(function () { return null; });
  }
  function reverseGeocodeQueued(lat, lon) {
    var result = geoQueue.then(function () { return reverseGeocode(lat, lon); });
    geoQueue = result.then(function () {
      return new Promise(function (res) { setTimeout(res, 1100); });
    }, function () {
      return new Promise(function (res) { setTimeout(res, 1100); });
    });
    return result;
  }

  // ---------- GitHub Contents API ----------
  function ghHeaders() {
    return {
      "Authorization": "Bearer " + cfg.token,
      "Accept": "application/vnd.github+json"
    };
  }
  function ghUrl(path) {
    return "https://api.github.com/repos/" + cfg.owner + "/" + cfg.repo + "/contents/" + path;
  }
  function ghGetFile(path) {
    return fetch(ghUrl(path) + "?ref=" + encodeURIComponent(cfg.branch), { headers: ghHeaders() })
      .then(function (r) {
        if (r.status === 404) return null;
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ("GitHub error " + r.status)); });
        return r.json();
      });
  }
  function ghPutFile(path, contentB64, message, sha) {
    var body = { message: message, content: contentB64, branch: cfg.branch };
    if (sha) body.sha = sha;
    return fetch(ghUrl(path), {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify(body)
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ("GitHub error " + r.status)); });
      return r.json();
    });
  }
  function ghDeleteFile(path, message, sha) {
    return fetch(ghUrl(path), {
      method: "DELETE",
      headers: Object.assign({ "Content-Type": "application/json" }, ghHeaders()),
      body: JSON.stringify({ message: message, sha: sha, branch: cfg.branch })
    }).then(function (r) {
      if (!r.ok) return r.json().then(function (j) { throw new Error(j.message || ("GitHub error " + r.status)); });
      return r.json();
    });
  }

  function loadManifest() {
    // photos.json always lives at repo root next to index.html, not under photos/
    return ghGetFile("photos.json").then(function (file) {
      if (!file) { manifest = []; manifestSha = null; return; }
      manifestSha = file.sha;
      var decoded = decodeURIComponent(escape(atob(file.content.replace(/\n/g, ""))));
      try { manifest = JSON.parse(decoded); } catch (e) { manifest = []; }
      if (!Array.isArray(manifest)) manifest = [];
    });
  }

  function saveManifest(message) {
    var json = JSON.stringify(manifest, null, 2) + "\n";
    var b64 = btoa(unescape(encodeURIComponent(json)));
    return ghPutFile("photos.json", b64, message, manifestSha).then(function (res) {
      manifestSha = res.content.sha;
    });
  }

  // ---------- roll (existing photos) rendering ----------
  function renderRoll() {
    els.roll.innerHTML = "";
    if (!manifest.length) {
      var p = document.createElement("p");
      p.className = "empty-note";
      p.textContent = "No frames on the sheet yet. Add some below.";
      els.roll.appendChild(p);
      return;
    }
    manifest.forEach(function (photo, i) {
      var cell = document.createElement("div");
      cell.className = "cell";
      var img = document.createElement("img");
      img.src = "https://raw.githubusercontent.com/" + cfg.owner + "/" + cfg.repo + "/" + cfg.branch + "/" + cfg.prefix + "/" + photo.file;
      img.alt = photo.caption || "";
      cell.appendChild(img);
      var del = document.createElement("button");
      del.textContent = "remove";
      del.addEventListener("click", function () { removeFromRoll(i); });
      cell.appendChild(del);
      els.roll.appendChild(cell);
    });
  }

  function removeFromRoll(index) {
    var photo = manifest[index];
    if (!confirm("Remove \"" + (photo.caption || photo.file) + "\" from the sheet?")) return;
    manifest.splice(index, 1);
    saveManifest("darkroom: remove " + photo.file)
      .then(function () {
        return ghGetFile(cfg.prefix + "/" + photo.file);
      })
      .then(function (file) {
        if (file) return ghDeleteFile(cfg.prefix + "/" + photo.file, "darkroom: delete " + photo.file, file.sha);
      })
      .then(function () {
        renderRoll();
      })
      .catch(function (err) {
        alert("Couldn't remove that frame: " + err.message);
      });
  }

  // ---------- connect ----------
  els.connectBtn.addEventListener("click", function () {
    var token = els.token.value.trim();
    var owner = els.owner.value.trim();
    var repo = els.repo.value.trim();
    var branch = els.branch.value.trim() || "main";
    var prefix = els.prefix.value.trim() || "photos";

    if (!token || !owner || !repo) {
      setStatus(els.connectStatus, "token, owner and repo are required", "err");
      return;
    }
    cfg = { token: token, owner: owner, repo: repo, branch: branch, prefix: prefix };

    if (els.remember.checked) {
      localStorage.setItem("darkroom.owner", owner);
      localStorage.setItem("darkroom.repo", repo);
      localStorage.setItem("darkroom.branch", branch);
      localStorage.setItem("darkroom.prefix", prefix);
    }

    setStatus(els.connectStatus, "connecting…");
    els.connectBtn.disabled = true;

    loadManifest()
      .then(function () {
        setStatus(els.connectStatus, "connected, " + manifest.length + " frames on the sheet", "ok");
        els.rollSection.hidden = false;
        els.uploadSection.hidden = false;
        renderRoll();
      })
      .catch(function (err) {
        setStatus(els.connectStatus, "couldn't connect: " + err.message, "err");
      })
      .finally(function () {
        els.connectBtn.disabled = false;
      });
  });

  // restore remembered fields (never the token)
  ["owner", "repo", "branch", "prefix"].forEach(function (key) {
    var saved = localStorage.getItem("darkroom." + key);
    if (saved) els[key].value = saved;
  });
  if (localStorage.getItem("darkroom.owner")) els.remember.checked = true;

  // ---------- HEIC conversion + image compression ----------
  function toDecodableBlob(file) {
    if (!isHeic(file)) return Promise.resolve(file);
    if (typeof heic2any === "undefined") return Promise.reject(new Error("HEIC support failed to load"));
    return heic2any({ blob: file, toType: "image/jpeg", quality: 0.92 })
      .then(function (out) { return Array.isArray(out) ? out[0] : out; });
  }

  function compressImage(srcBlob, orientation) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(srcBlob);
      var img = new Image();
      img.onload = function () {
        var maxDim = 2400;
        var iw = img.width, ih = img.height;
        var scale = Math.min(1, maxDim / Math.max(iw, ih));
        var sw = Math.round(iw * scale), sh = Math.round(ih * scale);
        var swap = orientation >= 5 && orientation <= 8;

        var canvas = document.createElement("canvas");
        canvas.width = swap ? sh : sw;
        canvas.height = swap ? sw : sh;
        var ctx = canvas.getContext("2d");
        ctx.fillStyle = "#fff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        switch (orientation) {
          case 2: ctx.transform(-1, 0, 0, 1, sw, 0); break;
          case 3: ctx.transform(-1, 0, 0, -1, sw, sh); break;
          case 4: ctx.transform(1, 0, 0, -1, 0, sh); break;
          case 5: ctx.transform(0, 1, 1, 0, 0, 0); break;
          case 6: ctx.transform(0, 1, -1, 0, sh, 0); break;
          case 7: ctx.transform(0, -1, -1, 0, sh, sw); break;
          case 8: ctx.transform(0, -1, 1, 0, 0, sw); break;
          default: break;
        }
        ctx.drawImage(img, 0, 0, sw, sh);

        canvas.toBlob(function (blob) {
          URL.revokeObjectURL(url);
          if (!blob) { reject(new Error("could not encode image")); return; }
          resolve(blob);
        }, "image/jpeg", 0.86);
      };
      img.onerror = function () { URL.revokeObjectURL(url); reject(new Error("could not read image")); };
      img.src = url;
    });
  }
  function blobToBase64(blob) {
    return new Promise(function (resolve, reject) {
      var reader = new FileReader();
      reader.onload = function () { resolve(reader.result.split(",")[1]); };
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  }

  // ---------- upload queue ----------
  function addFiles(fileList) {
    Array.prototype.forEach.call(fileList, function (file) {
      if (!isSupportedImage(file)) return;
      var id = "q" + (idCounter++);
      var item = {
        id: id, file: file, caption: "", category: "street", date: todayISO(),
        userEditedCaption: false, userEditedDate: false
      };
      queueItems.push(item);
      renderQueueItem(item);
      setItemNote(item, isHeic(file) ? "converting heic…" : "reading photo details…");

      var exifResult = null;
      readExif(file)
        .then(function (exif) {
          exifResult = exif;
          if (!exif) return;
          var captured = dateToISO(exif.DateTimeOriginal || exif.CreateDate);
          if (captured && !item.userEditedDate) {
            item.date = captured;
            if (item.dateEl) item.dateEl.value = captured;
          }
          if (exif.latitude != null && exif.longitude != null) {
            setItemNote(item, "looking up where this was taken…");
            return reverseGeocodeQueued(exif.latitude, exif.longitude).then(function (place) {
              if (place && !item.userEditedCaption) {
                item.caption = place;
                if (item.captionEl) item.captionEl.value = place;
              }
            });
          }
        })
        .catch(function () { /* no exif on this file, that's fine */ })
        .then(function () {
          setItemNote(item, "processing…");
          return toDecodableBlob(file);
        })
        .then(function (decodable) {
          var orientation = exifResult ? exifResult.Orientation : undefined;
          return compressImage(decodable, orientation);
        })
        .then(function (blob) {
          item.blob = blob;
          return blobToBase64(blob);
        })
        .then(function (b64) {
          item.base64 = b64;
          var imgEl = document.querySelector('[data-item="' + id + '"] img');
          if (imgEl) imgEl.src = "data:image/jpeg;base64," + b64;
          setItemNote(item, file.name);
          updatePublishRow();
        })
        .catch(function (err) {
          setItemNote(item, "failed to process: " + err.message);
        });
    });
  }

  function setItemNote(item, text) {
    var row = document.querySelector('[data-item="' + item.id + '"]');
    if (row) {
      var el = row.querySelector(".filename");
      if (el) el.textContent = text;
    }
  }

  function renderQueueItem(item) {
    var row = document.createElement("div");
    row.className = "item";
    row.setAttribute("data-item", item.id);

    var img = document.createElement("img");
    img.src = URL.createObjectURL(item.file);
    row.appendChild(img);

    var fields = document.createElement("div");
    fields.className = "fields";

    var caption = document.createElement("input");
    caption.type = "text";
    caption.placeholder = "caption (auto-filled from location if available)";
    caption.addEventListener("input", function () {
      item.caption = caption.value;
      item.userEditedCaption = true;
    });
    fields.appendChild(caption);
    item.captionEl = caption;

    var row2 = document.createElement("div");
    row2.className = "row2";

    var category = document.createElement("select");
    ["street", "landscape", "portrait", "other"].forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c; opt.textContent = c;
      category.appendChild(opt);
    });
    category.value = item.category;
    category.addEventListener("change", function () { item.category = category.value; });
    row2.appendChild(category);

    var date = document.createElement("input");
    date.type = "date";
    date.value = item.date;
    date.addEventListener("input", function () {
      item.date = date.value;
      item.userEditedDate = true;
    });
    row2.appendChild(date);
    item.dateEl = date;

    fields.appendChild(row2);

    var filename = document.createElement("div");
    filename.className = "filename";
    filename.textContent = item.file.name + " · queued…";
    fields.appendChild(filename);

    row.appendChild(fields);

    var remove = document.createElement("button");
    remove.className = "btn btn-ghost item-remove";
    remove.textContent = "remove";
    remove.addEventListener("click", function () {
      queueItems = queueItems.filter(function (q) { return q.id !== item.id; });
      row.remove();
      updatePublishRow();
    });
    row.appendChild(remove);

    els.queue.appendChild(row);
  }

  function updatePublishRow() {
    var ready = queueItems.length > 0 && queueItems.every(function (q) { return !!q.base64; });
    els.publishRow.hidden = queueItems.length === 0;
    els.publishBtn.disabled = !ready;
  }

  els.drop.addEventListener("click", function () { els.fileInput.click(); });
  els.fileInput.addEventListener("change", function () { addFiles(els.fileInput.files); els.fileInput.value = ""; });
  ["dragenter", "dragover"].forEach(function (evt) {
    els.drop.addEventListener(evt, function (e) { e.preventDefault(); els.drop.classList.add("drag"); });
  });
  ["dragleave", "drop"].forEach(function (evt) {
    els.drop.addEventListener(evt, function (e) { e.preventDefault(); els.drop.classList.remove("drag"); });
  });
  els.drop.addEventListener("drop", function (e) {
    if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files);
  });

  // ---------- publish ----------
  els.publishBtn.addEventListener("click", function () {
    els.publishBtn.disabled = true;
    setStatus(els.publishStatus, "publishing…");
    var chain = Promise.resolve();
    var newEntries = [];

    queueItems.forEach(function (item) {
      chain = chain.then(function () {
        var filename = item.date + "-" + slugify(item.caption || item.file.name.replace(/\.[a-z0-9]+$/i, "")) + "-" + Math.random().toString(36).slice(2, 6) + ".jpg";
        logLine("uploading " + filename + " …");
        return ghPutFile(cfg.prefix + "/" + filename, item.base64, "darkroom: add " + filename)
          .then(function () {
            logLine(filename + " uploaded", "ok");
            newEntries.push({
              file: filename,
              caption: item.caption,
              category: item.category,
              date: item.date,
              alt: item.caption || ""
            });
          });
      });
    });

    chain
      .then(function () {
        logLine("updating catalog…");
        manifest = newEntries.concat(manifest);
        return saveManifest("darkroom: publish " + newEntries.length + " frame(s)");
      })
      .then(function () {
        logLine("published " + newEntries.length + " frame(s). view the sheet to confirm.", "ok");
        setStatus(els.publishStatus, "published " + newEntries.length + " frame(s)", "ok");
        queueItems = [];
        els.queue.innerHTML = "";
        els.publishRow.hidden = true;
        renderRoll();
      })
      .catch(function (err) {
        logLine("stopped: " + err.message, "err");
        setStatus(els.publishStatus, "publish failed: " + err.message, "err");
      })
      .finally(function () {
        els.publishBtn.disabled = false;
      });
  });
})();

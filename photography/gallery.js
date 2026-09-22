(function () {
  "use strict";

  var sheetEl = document.getElementById("sheet");
  var emptyEl = document.getElementById("empty");
  var filtersEl = document.getElementById("filters");
  var countEl = document.getElementById("frame-count");
  var updatedEl = document.getElementById("last-updated");

  var viewer = document.getElementById("viewer");
  var viewerImg = document.getElementById("viewer-img");
  var viewerCaption = document.getElementById("viewer-caption");
  var viewerClose = document.getElementById("viewer-close");
  var viewerPrev = document.getElementById("viewer-prev");
  var viewerNext = document.getElementById("viewer-next");

  var allPhotos = [];
  var visible = [];
  var activeCategory = "all";
  var viewerIndex = -1;

  function frameLabel(i) {
    var letter = String.fromCharCode(65 + Math.floor(i / 99)); // A, B, C...
    var num = (i % 99) + 1;
    return (num < 10 ? "0" + num : "" + num) + letter;
  }

  function formatDate(d) {
    if (!d) return "";
    var parts = d.split("-");
    if (parts.length !== 3) return d;
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[parseInt(parts[1], 10) - 1] + " " + parts[0];
  }

  function render() {
    sheetEl.innerHTML = "";
    visible = activeCategory === "all"
      ? allPhotos.slice()
      : allPhotos.filter(function (p) { return p.category === activeCategory; });

    emptyEl.hidden = allPhotos.length > 0;
    sheetEl.hidden = allPhotos.length === 0;

    countEl.textContent = allPhotos.length === 0
      ? "roll empty"
      : visible.length + " of " + allPhotos.length + " frames"
        + (activeCategory !== "all" ? " · " + activeCategory : "");

    visible.forEach(function (photo, i) {
      var btn = document.createElement("button");
      btn.className = "frame";
      btn.setAttribute("data-index", i);
      btn.setAttribute("aria-label", "open photo " + (photo.caption || frameLabel(i)));

      var img = document.createElement("img");
      img.src = "photos/" + photo.file;
      img.alt = photo.alt || photo.caption || "";
      img.loading = "lazy";
      btn.appendChild(img);

      var tag = document.createElement("span");
      tag.className = "tag";
      tag.textContent = frameLabel(i);
      btn.appendChild(tag);

      if (photo.category) {
        var cat = document.createElement("span");
        cat.className = "cat";
        cat.textContent = photo.category;
        btn.appendChild(cat);
      }

      var pick = document.createElement("span");
      pick.className = "pick";
      btn.appendChild(pick);

      btn.addEventListener("click", function () { openViewer(i); });
      sheetEl.appendChild(btn);
    });
  }

  function buildFilters() {
    var cats = {};
    allPhotos.forEach(function (p) {
      if (p.category) cats[p.category] = true;
    });
    var list = ["all"].concat(Object.keys(cats).sort());
    filtersEl.innerHTML = "";
    list.forEach(function (cat) {
      var b = document.createElement("button");
      b.textContent = cat;
      b.setAttribute("aria-pressed", cat === activeCategory ? "true" : "false");
      b.addEventListener("click", function () {
        activeCategory = cat;
        Array.prototype.forEach.call(filtersEl.children, function (child) {
          child.setAttribute("aria-pressed", child === b ? "true" : "false");
        });
        render();
      });
      filtersEl.appendChild(b);
    });
  }

  function openViewer(i) {
    viewerIndex = i;
    var photo = visible[i];
    if (!photo) return;
    viewerImg.src = "photos/" + photo.file;
    viewerImg.alt = photo.alt || photo.caption || "";
    var bits = [];
    bits.push("<b>" + frameLabel(i) + "</b>");
    if (photo.caption) bits.push(photo.caption);
    if (photo.category) bits.push(photo.category);
    if (photo.date) bits.push(formatDate(photo.date));
    viewerCaption.innerHTML = bits.join(" &nbsp;·&nbsp; ");
    viewer.classList.add("open");
    document.body.style.overflow = "hidden";
  }

  function closeViewer() {
    viewer.classList.remove("open");
    document.body.style.overflow = "";
    viewerIndex = -1;
  }

  function step(delta) {
    if (viewerIndex < 0) return;
    var next = (viewerIndex + delta + visible.length) % visible.length;
    openViewer(next);
  }

  viewerClose.addEventListener("click", closeViewer);
  viewerPrev.addEventListener("click", function () { step(-1); });
  viewerNext.addEventListener("click", function () { step(1); });
  viewer.addEventListener("click", function (e) {
    if (e.target === viewer) closeViewer();
  });
  document.addEventListener("keydown", function (e) {
    if (!viewer.classList.contains("open")) return;
    if (e.key === "Escape") closeViewer();
    if (e.key === "ArrowLeft") step(-1);
    if (e.key === "ArrowRight") step(1);
  });

  fetch("photos.json", { cache: "no-store" })
    .then(function (r) { return r.ok ? r.json() : []; })
    .catch(function () { return []; })
    .then(function (data) {
      allPhotos = Array.isArray(data) ? data : [];
      buildFilters();
      render();
      if (allPhotos.length) {
        var dates = allPhotos.map(function (p) { return p.date; }).filter(Boolean).sort();
        var latest = dates[dates.length - 1];
        if (latest) updatedEl.textContent = "last developed " + formatDate(latest);
      }
    });
})();

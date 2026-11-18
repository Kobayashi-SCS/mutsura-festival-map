(() => {
  "use strict";

  const D = window.MAP_DATA;
  const $ = (s) => document.querySelector(s);
  const esc = (s) =>
    String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
    );
  const flat = (s) => String(s == null ? "" : s).replace(/\n/g, "");

  const TYPE_NAME = {
    room: "教室", booth: "出店", stage: "ステージ", toilet: "トイレ",
    stairs: "階段", entrance: "出入口", rest: "休憩所", service: "サービス",
    elevator: "エレベーター", closed: "使用しない", shoebox: "下駄箱", vending: "自販機",
  };
  const ICON = { toilet: "🚻", stairs: "🪜", entrance: "🚪", rest: "☕", stage: "🎤" };
  const WEIGHT = { room: 1, booth: 1, stage: 1, toilet: 0.55, stairs: 0.55, entrance: 0.7, rest: 0.8 };
  const DX = 12, DY = 11; // 建物の立体表現のずらし量

  let cur = { b: null, f: null };
  let lastKey = "";
  const spots = () => (D.map && D.map.spots) || [];
  const spotById = (id) => spots().find((s) => s.id === id);
  const itemsOf = (b, f) => { const fl = b.floors[f]; return Array.isArray(fl) ? fl : (fl.items || []); };

  /* ---------- ルーティング (URLの # で状態を持つ) ---------- */
  function route() {
    const p = new URLSearchParams(location.hash.slice(1));
    return { b: p.get("b"), f: p.get("f"), i: p.get("i"), s: p.get("s") };
  }
  function go(b, f, i, s) {
    const p = new URLSearchParams();
    if (b) p.set("b", b);
    if (f) p.set("f", f);
    if (i !== undefined && i !== null) p.set("i", i);
    if (s) p.set("s", s);
    location.hash = p.toString();
  }

  /* ---------- 全体マップ (SVG) ---------- */
  function textLines(label, cx, cy, fs, color) {
    const ls = String(label).split("\n");
    const lh = fs * 1.15;
    const y0 = cy - ((ls.length - 1) * lh) / 2;
    const st = color ? ` style="fill:${color}"` : "";
    return ls.map((l, k) =>
      `<text class="ov-t" x="${cx}" y="${y0 + k * lh}" dominant-baseline="central" font-size="${fs}"${st}>${esc(l)}</text>`
    ).join("");
  }

  const cid = (c) => String(c).replace(/[^0-9a-z]/gi, "");
  function defsHTML(decor) {
    const cols = [...new Set(decor.map((d) => d.color))];
    return "<defs>" + cols.map((c) => {
      const k = cid(c);
      return `<marker id="ar-${k}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="4" markerHeight="4" orient="auto"><path d="M0,0L10,5L0,10z" fill="${c}"/></marker>` +
        `<marker id="ci-${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3" markerHeight="3"><circle cx="5" cy="5" r="3.6" fill="#fff" stroke="${c}" stroke-width="1.6"/></marker>` +
        `<marker id="di-${k}" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.2" markerHeight="3.2"><path d="M5,0L10,5L5,10L0,5z" fill="${c}"/></marker>`;
    }).join("") + "</defs>";
  }
  function decorHTML(d) {
    const k = cid(d.color);
    const ms = d.start === "circle" ? ` marker-start="url(#ci-${k})"` : d.start === "diamond" ? ` marker-start="url(#di-${k})"` : "";
    const me = d.end === "arrow" ? ` marker-end="url(#ar-${k})"` : "";
    return `<path d="${esc(d.d)}" fill="none" stroke="${d.color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"${ms}${me}/>`;
  }

  function buildingSVG(b) {
    const p = b.pos, c = b.color || "#ddd";
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const open = `<g class="bld" data-act="bld" data-id="${esc(b.id)}" tabindex="0" role="button" aria-label="${esc(b.name)}">`;
    if (b.shape === "label") {
      return open + `<rect x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="#fff" fill-opacity="0"/>` +
        `<text class="ov-t" x="${cx}" y="${cy}" dominant-baseline="central" font-size="${b.fs || 40}">${esc(b.name)}</text></g>`;
    }
    const side = `${p.x + p.w},${p.y} ${p.x + p.w + DX},${p.y + DY} ${p.x + p.w + DX},${p.y + p.h + DY} ${p.x + p.w},${p.y + p.h}`;
    const bottom = `${p.x},${p.y + p.h} ${p.x + p.w},${p.y + p.h} ${p.x + p.w + DX},${p.y + p.h + DY} ${p.x + DX},${p.y + p.h + DY}`;
    const ln = `stroke="#666" stroke-width="1.5" stroke-linejoin="round"`;
    return open +
      `<polygon class="face" points="${side}" fill="${c}" ${ln}/><polygon points="${side}" fill="#fff" fill-opacity=".45" stroke="none"/>` +
      `<polygon class="face" points="${bottom}" fill="${c}" ${ln}/><polygon points="${bottom}" fill="#000" fill-opacity=".22" stroke="none"/>` +
      `<rect class="face" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" fill="${c}" ${ln}/>` +
      textLines(b.name, cx, cy, b.fs || 26) + `</g>`;
  }

  function spotSVG(s) {
    const p = s.pos, cx = p.x + p.w / 2, cy = p.y + p.h / 2;
    const g = `<g class="spot" data-act="spot" data-id="${esc(s.id)}" tabindex="0" role="button" aria-label="${esc(flat(s.label))}">`;
    const fill = s.fill || "#fff";
    const st = `fill="${fill}" stroke="#555" stroke-width="2.5" stroke-linejoin="round"`;
    let shape = "", txt = "";
    if (s.shape === "diamond") {
      shape = `<polygon class="face" points="${cx},${p.y} ${p.x + p.w},${cy} ${cx},${p.y + p.h} ${p.x},${cy}" ${st}/>`;
      txt = textLines(s.label, cx, cy, s.fs || 16);
    } else if (s.shape === "pin") {
      const r = p.w / 2, pcy = p.y + r;
      shape = `<polygon points="${cx - 9},${pcy + r - 6} ${cx + 9},${pcy + r - 6} ${cx + 4},${p.y + p.h}" fill="#555"/>` +
        `<circle class="face" cx="${cx}" cy="${pcy}" r="${r}" fill="#555" stroke="#555" stroke-width="2"/>`;
      txt = textLines(String(s.label).split("").join("\n"), cx, pcy, s.fs || 14, "#fff");
    } else if (s.shape === "pill") {
      shape = `<rect class="face" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" rx="${p.h / 2}" ${st} stroke-width="3"/>`;
      txt = textLines(s.label, cx, cy, s.fs || 15);
    } else if (s.shape === "station") {
      shape = `<rect class="face" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" ${st} fill="${s.fill || "#eee"}" stroke-width="1.5"/>`;
      txt = textLines(String(s.label).split("").join("\n"), cx, cy, s.fs || 12);
    } else {
      shape = `<rect class="face" x="${p.x}" y="${p.y}" width="${p.w}" height="${p.h}" ${st} ${s.fill ? `fill="${s.fill}" stroke-width="1.5"` : ""}/>`;
      txt = textLines(s.label, cx, cy, s.fs || 16);
    }
    return g + shape + txt + `</g>`;
  }

  function overviewHTML() {
    const m = D.map;
    const decor = m.decor || [];
    let s = `<p class="hint">建物や場所をタップすると、くわしい情報が見られます</p>`;
    s += `<svg class="overview" viewBox="0 0 ${m.w} ${m.h}" role="img" aria-label="校内全体マップ">`;
    s += defsHTML(decor);
    D.buildings.forEach((b) => (s += buildingSVG(b)));
    decor.forEach((d) => (s += decorHTML(d)));
    spots().forEach((sp) => (s += spotSVG(sp)));
    s += `</svg>`;
    s += `<ul class="legend">` +
      [["#fff", "教室"], ["#fff1d6", "出店"], ["#ffd9e8", "ステージ"], ["#def0fb", "トイレ"],
       ["#e6e6e6", "階段"], ["#d9f2d9", "出入口"], ["#fff7bf", "休憩所"]]
        .map(([c, t]) => `<li><i style="background:${c}"></i>${t}</li>`).join("") + `</ul>`;
    return s;
  }

  /* ---------- 建物ビュー ---------- */
  /* ---------- 平面図 (座標で部屋を描くフロア) ---------- */
  const TONE = { g: "#d3f0df", p: "#fbd5e3" };
  function wrapText(text, maxW, fs) {
    const out = [];
    String(text).split("\n").forEach((line) => {
      let cur = "", w = 0;
      for (const ch of line) {
        const cw = ch.charCodeAt(0) > 255 ? fs : fs * 0.58;
        if (w + cw > maxW && cur) { out.push(cur); cur = ""; w = 0; }
        cur += ch; w += cw;
      }
      out.push(cur);
    });
    return out;
  }
  function bbox(it) {
    if (it.pts) {
      const ps = it.pts.trim().split(/\s+/).map((p) => p.split(",").map(Number));
      const xs = ps.map((p) => p[0]), ys = ps.map((p) => p[1]);
      const x = Math.min(...xs), y = Math.min(...ys);
      return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
    }
    return { x: it.x, y: it.y, w: it.w, h: it.h };
  }
  function person(cx, cy, s, sex) {
    const r = s * 0.15, top = cy - s / 2;
    const by = top + 2 * r + s * 0.06, bb = cy + s / 2;
    const pts = sex === "f"
      ? `${cx - s * 0.09},${by} ${cx + s * 0.09},${by} ${cx + s * 0.24},${bb} ${cx - s * 0.24},${bb}`
      : `${cx - s * 0.3},${by} ${cx + s * 0.3},${by} ${cx + s * 0.09},${bb} ${cx - s * 0.09},${bb}`;
    const sw = Math.max(2, s * 0.05);
    return `<circle cx="${cx}" cy="${top + r}" r="${r}" fill="#fff" stroke="#555" stroke-width="${sw}"/>` +
      `<polygon points="${pts}" fill="#fff" stroke="#555" stroke-width="${sw}" stroke-linejoin="round"/>`;
  }
  function stairIcon(cx, cy, s) {
    const u = s / 60;
    const p = [[-26, 16], [-10, 16], [-10, 4], [6, 4], [6, -8], [22, -8]]
      .map(([x, y]) => `${(cx + x * u).toFixed(1)},${(cy + y * u).toFixed(1)}`).join(" ");
    return `<polyline points="${p}" fill="none" stroke="#111" stroke-width="${(5 * u).toFixed(1)}"/>` +
      `<polygon points="${cx + 14 * u},${cy - 20 * u} ${cx + 30 * u},${cy - 20 * u} ${cx + 30 * u},${cy - 4 * u}" fill="#111"/>`;
  }
  function elevIcon(cx, cy, s) {
    const u = s / 60;
    let o = `<polygon points="${cx - 12 * u},${cy - 36 * u} ${cx - 20 * u},${cy - 20 * u} ${cx - 4 * u},${cy - 20 * u}" fill="#222"/>` +
      `<polygon points="${cx + 12 * u},${cy - 18 * u} ${cx + 4 * u},${cy - 34 * u} ${cx + 20 * u},${cy - 34 * u}" fill="#222"/>` +
      `<rect x="${cx - 26 * u}" y="${cy - 14 * u}" width="${52 * u}" height="${40 * u}" rx="${3 * u}" fill="#eee" stroke="#555" stroke-width="${3 * u}"/>`;
    [-14, 0, 14].forEach((dx) => {
      o += `<circle cx="${cx + dx * u}" cy="${cy - 1 * u}" r="${4 * u}" fill="#111"/>` +
        `<rect x="${cx + (dx - 4) * u}" y="${cy + 5 * u}" width="${8 * u}" height="${15 * u}" rx="${2 * u}" fill="#111"/>`;
    });
    return o;
  }
  function yenBadge(x, y) {
    return `<rect x="${x}" y="${y}" width="34" height="34" fill="#fff" stroke="#555" stroke-width="2"/>` +
      `<text x="${x + 17}" y="${y + 18}" text-anchor="middle" dominant-baseline="central" font-size="24" font-weight="700" style="fill:#1a1aaa">¥</text>` +
      `<line x1="${x}" y1="${y}" x2="${x + 34}" y2="${y + 34}" stroke="#222" stroke-width="2"/>`;
  }

  function itemSVG(it, i, sel) {
    const t = it.type || "room";
    const bb = bbox(it);
    const cx = it.lx != null ? it.lx : bb.x + bb.w / 2;
    const cy = it.ly != null ? it.ly : bb.y + bb.h / 2;
    const lab = flat(it.label || "");
    const open = t === "closed" ? `<g>`
      : `<g class="pi${i === sel ? " sel" : ""}" data-act="item" data-i="${i}" tabindex="0" role="button" aria-label="${esc(lab || TYPE_NAME[t] || "")}">`;
    let fill = "#fff";
    if (t === "room") fill = TONE[it.tone] || "#fff";
    else if (t === "closed") fill = "#ececec";
    else if (t === "toilet") fill = it.sex === "f" ? "#fde3ea" : "#d9ebfb";
    else if (t === "service") fill = "#f7f5ee";
    else if (t === "rest") fill = TONE.g;
    else if (t === "stairs") fill = it.plain ? "#fff" : `url(#hatch${it.dir === "h" ? "H" : "V"})`;
    if (it.fill) fill = it.fill;
    const stroke = `stroke="#555" stroke-width="3"`;
    let shape;
    if (t === "shoebox" && !it.solid) {
      shape = `<rect class="face" x="${bb.x}" y="${bb.y}" width="${bb.w}" height="${bb.h}" fill="#fff" stroke="#555" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round"/>`;
    } else if (it.pts) {
      shape = `<polygon class="face" points="${it.pts}" fill="${fill}" ${stroke} stroke-linejoin="round"/>`;
    } else {
      shape = `<rect class="face" x="${bb.x}" y="${bb.y}" width="${bb.w}" height="${bb.h}" fill="${fill}" ${stroke}/>`;
    }
    let inner = "";
    if (t === "stairs") {
      const s = Math.min(bb.w, bb.h) * 0.62;
      if (!it.plain) inner += `<rect x="${cx - s / 2}" y="${cy - s / 2}" width="${s}" height="${s}" fill="#fff"/>`;
      inner += stairIcon(cx, cy, s * 0.85);
    } else if (t === "toilet") {
      const mf = it.sex === "mf";
      const s = Math.min(bb.h * 0.55, bb.w * (mf ? 0.42 : 0.8));
      inner += mf ? person(cx - s * 0.5, cy, s, "m") + person(cx + s * 0.5, cy, s, "f") : person(cx, cy, s, it.sex);
    } else if (t === "elevator") {
      inner += elevIcon(cx, cy, Math.min(bb.w * 0.75, bb.h * 0.5));
    } else if (t === "vending") {
      const px = bb.x + bb.w * 0.12, pw = bb.w * 0.76;
      [0, 1].forEach((r) => [0, 1].forEach((c) => {
        inner += `<rect x="${px + c * pw * 0.54}" y="${bb.y + bb.h * (0.1 + r * 0.3)}" width="${pw * 0.46}" height="${bb.h * 0.22}" fill="#fff" stroke="#555" stroke-width="2"/>`;
      }));
      inner += `<rect x="${px}" y="${bb.y + bb.h * 0.72}" width="${pw}" height="${bb.h * 0.12}" fill="#eee" stroke="#555" stroke-width="2"/>`;
    } else if (lab || it.booth) {
      const fs = it.fs || 26;
      const rows = wrapText(it.label || "", bb.w - 14, fs).map((x) => ({ x, fs }));
      if (it.booth) {
        const f2 = Math.round(fs * 0.72);
        wrapText(it.booth, bb.w - 14, f2).forEach((x) => rows.push({ x, fs: f2, sub: true }));
      }
      const lh = (r) => r.fs * 1.25;
      let y = cy - rows.reduce((n, r) => n + lh(r), 0) / 2;
      rows.forEach((r) => {
        inner += `<text class="pt" x="${cx}" y="${y + lh(r) / 2}" dominant-baseline="central" font-size="${r.fs}"${r.sub ? ' style="fill:#555;font-weight:400"' : ""}>${esc(r.x)}</text>`;
        y += lh(r);
      });
    }
    if (it.yen) inner += yenBadge(bb.x + bb.w - 34, bb.y);
    return open + shape + inner + `</g>`;
  }

  function decorPlan(d) {
    const fs = d.fs || 30;
    if (d.t === "text") {
      const ls = String(d.text).split("\n"), lh = fs * 1.2, y0 = d.y - ((ls.length - 1) * lh) / 2;
      return ls.map((l, k) => `<text class="pt" x="${d.x}" y="${y0 + k * lh}" dominant-baseline="central" font-size="${fs}">${esc(l)}</text>`).join("");
    }
    if (d.t === "rect") return `<rect x="${d.x}" y="${d.y}" width="${d.w}" height="${d.h}" fill="${d.fill || "#eee"}"${d.stroke ? ` stroke="${d.stroke}" stroke-width="3"` : ""}/>`;
    if (d.t === "poly") return `<polygon points="${d.pts}" fill="${d.fill || "none"}" stroke="${d.stroke || "#555"}" stroke-width="3" stroke-linejoin="round"/>`;
    if (d.t === "path") return `<path d="${esc(d.d)}" fill="none" stroke="${d.stroke || "#555"}" stroke-width="3" stroke-linecap="round"/>`;
    if (d.t === "arrow") {
      const { x, y } = d;
      const P = d.dir === "left"
        ? [[-22, 0], [-4, -15], [-4, -6], [22, -6], [22, 6], [-4, 6], [-4, 15]]
        : d.dir === "right"
          ? [[22, 0], [4, -15], [4, -6], [-22, -6], [-22, 6], [4, 6], [4, 15]]
          : [[0, -22], [-15, -4], [-6, -4], [-6, 22], [6, 22], [6, -4], [15, -4]];
      return `<polygon points="${P.map(([a, b]) => `${x + a},${y + b}`).join(" ")}" fill="#cfe7ea" stroke="#5b8f97" stroke-width="2" stroke-linejoin="round"/>`;
    }
    return "";
  }

  function planSVG(fl, sel) {
    const W = fl.w || 1000, H = fl.h || 560;
    const dec = fl.decor || [];
    let s = `<svg class="planmap" viewBox="0 0 ${W} ${H}" role="group" aria-label="フロア図">`;
    s += `<defs><pattern id="hatchV" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#fff"/><path d="M6,0V12" stroke="#555" stroke-width="3"/></pattern>` +
      `<pattern id="hatchH" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="#fff"/><path d="M0,6H12" stroke="#555" stroke-width="3"/></pattern></defs>`;
    if (fl.outline) s += `<polygon points="${fl.outline}" fill="#fff" stroke="#555" stroke-width="3" stroke-linejoin="round"/>`;
    dec.filter((d) => d.under).forEach((d) => (s += decorPlan(d)));
    (fl.items || []).forEach((it, i) => (s += itemSVG(it, i, sel)));
    dec.filter((d) => !d.under).forEach((d) => (s += decorPlan(d)));
    return s + `</svg>`;
  }

  function cell(it, i) {
    const t = it.type || "room";
    const icon = ICON[t] ? `<span class="ic">${ICON[t]}</span>` : "";
    const booth = it.booth ? `<span class="bn">${esc(it.booth)}</span>` : "";
    return `<button class="cell t-${t}" style="flex:${WEIGHT[t] != null ? WEIGHT[t] : 1}" data-act="item" data-i="${i}">` +
      `${icon}<span class="lb">${esc(it.label)}</span>${booth}</button>`;
  }

  function planHTML(b, f, sel) {
    const fl = b.floors[f];
    if (!Array.isArray(fl)) return planSVG(fl, sel);
    const items = fl;
    if (b.layout === "courtyard") {
      const stages = [], others = [];
      items.forEach((it, i) => (it.type === "stage" ? stages : others).push(cell(it, i)));
      return `<div class="yard"><div class="stage-row">${stages.join("")}</div><div class="grid">${others.join("")}</div></div>`;
    }
    const k = Math.ceil(items.length / 2);
    const top = items.slice(0, k).map((it, i) => cell(it, i)).join("");
    const bottom = items.slice(k).map((it, i) => cell(it, i + k)).join("");
    return `<div class="plan"><div class="side">${top}</div><div class="corridor"><span>廊下</span></div><div class="side">${bottom}</div></div>`;
  }

  function buildingHTML(b, f, sel) {
    const floors = Object.keys(b.floors);
    let s = `<div class="nav"><button class="back" data-act="back">← 全体マップ</button><h2>${esc(b.name)}</h2></div>`;
    if (floors.length > 1) {
      s += `<div class="tabs" role="tablist">` +
        floors.slice().reverse().map((x) =>
          `<button class="tab${x === f ? " on" : ""}" role="tab" aria-selected="${x === f}" data-act="floor" data-f="${esc(x)}">${esc(x)}</button>`
        ).join("") + `</div>`;
    }
    s += planHTML(b, f, sel);
    const items = itemsOf(b, f);
    const rows = items.map((it, i) => it.booth
      ? `<li><button data-act="item" data-i="${i}"><b>${esc(it.label)}</b><span>${esc(it.booth)}</span></button></li>` : "").join("");
    if (rows) s += `<h3 class="list-title">${floors.length > 1 ? esc(f) + "の" : ""}出し物一覧</h3><ul class="list">${rows}</ul>`;
    return s;
  }

  /* ---------- 詳細シート ---------- */
  function fillSheet(where, label, t, it) {
    let s = `<p class="where">${esc(where)}</p><h2>${esc(label)}</h2><span class="tag">${TYPE_NAME[t] || ""}</span>`;
    if (it.booth) s += `<p class="booth">${esc(it.booth)}</p>`;
    if (it.desc) s += `<p class="desc">${esc(it.desc)}</p>`;
    if (!it.booth && !it.desc && (t === "room" || t === "booth")) s += `<p class="desc">この場所の詳しい情報は準備中です。</p>`;
    if (it.photo) s += `<img src="${esc(it.photo)}" alt="${esc(it.booth || label)}の写真" loading="lazy">`;
    $("#sheet-body").innerHTML = s;
    const img = $("#sheet-body img");
    if (img) img.addEventListener("error", () => img.remove());
    $("#sheet").hidden = false;
  }
  function showSheet(b, f, i) {
    const it = itemsOf(b, f)[i];
    const where = b.layout === "courtyard" ? b.name : `${b.name} ${f}`;
    fillSheet(where, it.label, it.type || "room", it);
  }
  function showSpot(s) {
    fillSheet("校内マップ", flat(s.label), s.type || "booth", s);
  }
  function closeSheet() { $("#sheet").hidden = true; }

  /* ---------- 描画 ---------- */
  function render() {
    const r = route();
    const b = D.buildings.find((x) => x.id === r.b);
    const view = $("#view");
    if (!b) {
      cur = { b: null, f: null };
      view.innerHTML = overviewHTML();
      if (lastKey !== "overview") window.scrollTo(0, 0);
      lastKey = "overview";
      const sp = r.s ? spotById(r.s) : null;
      if (sp) showSpot(sp); else closeSheet();
      return;
    }
    const floors = Object.keys(b.floors);
    const f = floors.includes(r.f) ? r.f : floors[0];
    cur = { b: b.id, f };
    const idx = r.i == null ? -1 : Number(r.i);
    view.innerHTML = buildingHTML(b, f, idx);
    const key = b.id + "/" + f;
    if (lastKey !== key) window.scrollTo(0, 0);
    lastKey = key;
    if (itemsOf(b, f)[idx]) showSheet(b, f, idx); else closeSheet();
  }

  /* ---------- 検索 ---------- */
  function search(q) {
    q = q.trim().toLowerCase();
    if (!q) return [];
    const out = [];
    D.buildings.forEach((b) =>
      Object.keys(b.floors).forEach((f) =>
        itemsOf(b, f).forEach((it, i) => {
          if (it.type === "closed") return;
          const hay = [it.label, it.booth, it.desc, TYPE_NAME[it.type || "room"], b.name].join(" ").toLowerCase();
          if (hay.includes(q)) out.push({ b, f, i, it });
        })
      )
    );
    spots().forEach((s) => {
      if (s.link) return; // ライブ会場など、建物内のデータと重複するものは除く
      const hay = [flat(s.label), s.booth, s.desc, TYPE_NAME[s.type || "booth"]].join(" ").toLowerCase();
      if (hay.includes(q)) out.push({ spot: s });
    });
    return out;
  }
  function showResults(q) {
    const box = $("#results");
    if (!q.trim()) { box.hidden = true; box.innerHTML = ""; return; }
    const hits = search(q);
    box.hidden = false;
    box.innerHTML = `<h2>検索結果 ${hits.length}件</h2>` + (hits.length
      ? `<ul class="list">` + hits.slice(0, 50).map((h) => h.spot
        ? `<li><button data-act="hit" data-s="${esc(h.spot.id)}"><b>${esc(flat(h.spot.label))}${h.spot.booth ? "｜" + esc(h.spot.booth) : ""}</b><span>校内マップ</span></button></li>`
        : `<li><button data-act="hit" data-b="${esc(h.b.id)}" data-f="${esc(h.f)}" data-i="${h.i}">` +
          `<b>${esc(h.it.label)}${h.it.booth ? "｜" + esc(h.it.booth) : ""}</b>` +
          `<span>${esc(h.b.name)}${h.b.layout === "courtyard" ? "" : " " + esc(h.f)}</span></button></li>`
        ).join("") + `</ul>`
      : `<p class="hint">見つかりませんでした。別のことばで試してください。</p>`);
  }

  /* ---------- イベント ---------- */
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-act]");
    if (!t) return;
    const act = t.dataset.act;
    if (act === "bld") go(t.dataset.id);
    else if (act === "back") go();
    else if (act === "floor") go(cur.b, t.dataset.f);
    else if (act === "item") go(cur.b, cur.f, t.dataset.i);
    else if (act === "spot") {
      const s = spotById(t.dataset.id);
      if (!s) return;
      if (s.link) go(s.link.b, s.link.f, s.link.i);
      else go(null, null, null, s.id);
    } else if (act === "hit") {
      $("#q").value = "";
      showResults("");
      if (t.dataset.s) go(null, null, null, t.dataset.s);
      else go(t.dataset.b, t.dataset.f, t.dataset.i);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !$("#sheet").hidden) { go(cur.b, cur.f); return; }
    if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("g[data-act]")) {
      e.preventDefault();
      e.target.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    }
  });
  $("#sheet").addEventListener("click", (e) => { if (e.target.id === "sheet") go(cur.b, cur.f); });
  $("#sheet-close").addEventListener("click", () => go(cur.b, cur.f));
  $("#q").addEventListener("input", (e) => showResults(e.target.value));
  window.addEventListener("hashchange", render);

  document.title = D.title;
  $("#title").textContent = D.title;
  render();
})();

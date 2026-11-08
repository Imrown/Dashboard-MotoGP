/* =========================================
   MotoGP Dashboard 2026 — Application
   Terkoneksi ke API: https://api.motogp.pulselive.com/motogp/v1
   ========================================= */

const API_BASE = "https://api.motogp.pulselive.com/motogp/v1";

// ---------- Konfigurasi ----------
const CONFIG = {
  seasonYear: 2026,
  categoryName: "MotoGP™",
  cacheMs: 5 * 60 * 1000, // cache 5 menit
};

// ---------- State ----------
let state = {
  seasonUuid: null,
  categoryUuid: null,
  schedule: [],
  results: [],
  standings: [],
  riders: [],
  apiStatus: "checking", // checking | online | offline | fallback
  error: null,
};

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

function formatPoints(n) {
  return n ? n.toLocaleString("id-ID") : "0";
}

function debounce(fn, delay) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), delay);
  };
}

function apiStatus(text, type = "online") {
  const el = $("#api-status");
  if (!el) return;
  state.apiStatus = type;
  el.textContent = text;
  el.className = "api-status " + type;
}

// ---------- API Fetcher ----------
async function fetchApi(path, opts = {}) {
  const url = `${API_BASE}${path}`;
  try {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      },
      ...opts,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`API gagal: ${path}`, err);
    throw err;
  }
}

// ---------- Data Loaders ----------
async function loadSeasonAndCategory() {
  try {
    const seasons = await fetchApi("/results/seasons");
    const season2026 = seasons.find((s) => s.year === 2026);
    if (!season2026) throw new Error("Season 2026 tidak ditemukan");
    state.seasonUuid = season2026.id;

    const categories = await fetchApi(
      `/results/categories?seasonUuid=${state.seasonUuid}`
    );
    const catMotoGP = categories.find((c) => c.name === CONFIG.categoryName);
    if (!catMotoGP) throw new Error("Kategori MotoGP tidak ditemukan");
    state.categoryUuid = catMotoGP.id;

    apiStatus("Terhubung ke API MotoGP", "online");
  } catch (err) {
    state.error = err.message;
    apiStatus("API tidak tersedia — mode data simpanan", "offline");
    console.error("Gagal load season/category:", err);
  }
}

async function loadSchedule() {
  if (!state.seasonUuid) return [];

  try {
    const events = await fetchApi(
      `/results/events?seasonUuid=${state.seasonUuid}&isFinished=false`
    );
    const finished = await fetchApi(
      `/results/events?seasonUuid=${state.seasonUuid}&isFinished=true`
    );
    const allEvents = [...finished, ...events];

    // Filter hanya yang punya legacyId untuk kategori MotoGP (categoryId 3)
    const motogpEvents = allEvents.filter((e) =>
      (e.legacy_id || []).some((l) => l.categoryId === 3)
    );

    const schedule = motogpEvents.map((e) => {
      const status =
        e.status === "FINISHED" ? "completed" : e.status === "ACTIVE" ? "active" : "upcoming";
      return {
        round: (e.legacy_id || []).find((l) => l.categoryId === 3)?.eventId || 0,
        circuit: e.sponsored_name || e.name,
        country: e.country.name || "—",
        date: `${e.date_start} s.d ${e.date_end}`,
        status,
        note: e.circuit.name || "",
        eventUuid: e.id,
        shortName: e.short_name || "",
      };
    });

    // Urutkan berdasarkan round
    schedule.sort((a, b) => a.round - b.round);
    // Map circuit image from api.lucasarts.fr
    const circuitImageMap = {
      "thailand": "Chang%20International%20Circuit.svg",
      "brazil": null,
      "usa": "Circuit%20of%20The%20Americas.svg",
      "spain": "Circuit%20de%20Jerez.svg",
      "france": "Le%20Mans%20Bugatti%20Circuit.svg",
      "catalonia": "Circuit%20de%20Catalunya.svg",
      "italy": "Autodromo%20Internazionale%20del%20Mugello.svg",
      "hungary": null,
      "czechia": null,
      "netherlands": "TT%20Circuit%20Assen.svg",
      "germany": "Sachsenring.svg",
      "great-britain": "Silverstone.svg",
      "aragon": null,
      "san-marino": "Misano%20World%20Circuit.svg",
      "austria": "Red%20Bull%20Ring.svg",
      "japan": "Twin%20Ring%20Motegi.svg",
      "indonesia": "Mandalika%20International%20Circuit.svg",
      "australia": "Phillip%20Island%20Circuit.svg",
      "malaysia": "Sepang%20International%20Circuit.svg",
      "qatar": "Losail%20International%20Circuit.svg",
      "portugal": "Autodromo%20International%20Algarve.svg",
      "valencia": "Circuit%20de%20la%20Comunitat%20Valenciana%20Ricardo%20Tormo.svg"
    };

    const scheduleWithImages = schedule.map((e) => {
      const key = e.shortName?.toLowerCase() || e.country.toLowerCase().replace(/\s+/g, '-');
      return { ...e, circuitImage: circuitImageMap[key] || null };
    });

    state.schedule = scheduleWithImages;
    return scheduleWithImages;
  } catch (err) {
    console.error("Gagal load schedule:", err);
    return [];
  }
}

async function loadStandings() {
  if (!state.seasonUuid || !state.categoryUuid) return [];

  try {
    const data = await fetchApi(
      `/results/standings?seasonUuid=${state.seasonUuid}&categoryUuid=${state.categoryUuid}`
    );
    const classification = data.classification || [];

    const standings = classification.map((item) => ({
      rank: item.position,
      rider: item.rider.full_name,
      team: item.team.name,
      number: item.rider.number,
      points: item.points,
      leader: item.position === 1,
    }));

    state.standings = standings;
    return standings;
  } catch (err) {
    console.error("Gagal load standings:", err);
    return [];
  }
}

async function loadRiders() {
  try {
    const riders = await fetchApi("/riders");
    const motogpRiders = riders.filter(
      (r) =>
        r.current_career_step &&
        r.current_career_step.category &&
        r.current_career_step.category.name === "MotoGP" &&
        r.current_career_step.in_grid
    );

    const list = motogpRiders.map((r) => {
      const step = r.current_career_step;
      return {
        number: r.legacy_id || 0,
        name: `${r.name} ${r.surname}`.trim(),
        team: step.team?.name || "—",
        avatar: (r.name[0] || "") + (r.surname[0] || ""),
        legacyId: r.legacy_id,
      };
    });

    // Urutkan berdasarkan nomor pembalap
    list.sort((a, b) => a.number - b.number);
    state.riders = list;
    return list;
  } catch (err) {
    console.error("Gagal load riders:", err);
    return [];
  }
}

async function loadResults() {
  // Coba ambil hasil balapan dari event terakhir yang FINISHED
  if (!state.schedule.length) return [];

  try {
    const finishedEvents = state.schedule.filter((e) => e.status === "completed");
    if (!finishedEvents.length) return [];

    const latest = finishedEvents[finishedEvents.length - 1];

    // Coba dapatkan sesi dan klasifikasi
    const sessions = await fetchApi(
      `/results/sessions?eventUuid=${latest.eventUuid}&categoryUuid=${state.categoryUuid}`
    );

    const raceSession = sessions.find((s) => s.type === "R") || sessions[sessions.length - 1];
    if (!raceSession) return [];

    const classification = await fetchApi(
      `/results/session/${raceSession.id}/classification?seasonYear=2026&test=false`
    );

    const results = (classification.classification || []).map((item, idx) => ({
      pos: item.position,
      rider: item.rider.full_name,
      team: item.team.name,
      number: item.rider.number,
      time: item.best_lap?.time || "—",
      gap: item.gap?.first || "",
    }));

    state.results = results;
    return results;
  } catch (err) {
    console.error("Gagal load results:", err);
    return [];
  }
}

// ---------- Data Simpanan (Static Fallback) ----------
const STATIC_SCHEDULE = [
  { round: 18, circuit: "Australian GP", country: "Australia", date: "25 Okt 2026", status: "completed", note: "Phillip Island Circuit", circuitImage: "Phillip%20Island%20Circuit.svg" },
  { round: 19, circuit: "Malaysian GP", country: "Malaysia", date: "01 Nov 2026", status: "completed", note: "Sepang International Circuit", circuitImage: "Sepang%20International%20Circuit.svg" },
  { round: 20, circuit: "Qatar Airways Grand Prix of Qatar", country: "Qatar", date: "06–08 Nov 2026", status: "active", note: "Lusail International Circuit", circuitImage: "Losail%20International%20Circuit.svg" },
  { round: 21, circuit: "Portuguese GP", country: "Portugal", date: "20–22 Nov 2026", status: "upcoming", note: "Autódromo do Algarve, Portimão", circuitImage: "Autodromo%20International%20Algarve.svg" },
  { round: 22, circuit: "Valencia GP", country: "Spain", date: "27–29 Nov 2026", status: "upcoming", note: "Circuit Ricardo Tormo, Valencia", circuitImage: "Circuit%20de%20la%20Comunitat%20Valenciana%20Ricardo%20Tormo.svg" }
];

const STATIC_RESULTS = [
  { pos: 1, rider: "Marc Marquez", team: "Ducati Lenovo Team", number: 93, time: "41'12.345", gap: "" },
  { pos: 2, rider: "Pedro Acosta", team: "Red Bull KTM Factory Racing", number: 31, time: "41'13.012", gap: "+0.667s" },
  { pos: 3, rider: "Alex Marquez", team: "BK8 Gresini Racing MotoGP", number: 73, time: "41'13.891", gap: "+1.546s" },
  { pos: 4, rider: "Marco Bezzecchi", team: "Aprilia Racing", number: 72, time: "41'14.203", gap: "+1.858s" },
  { pos: 5, rider: "Fabio Di Giannantonio", team: "Pertamina Enduro VR46 Racing Team", number: 49, time: "41'15.010", gap: "+2.665s" }
];

const STATIC_STANDINGS = [
  { rank: 1, rider: "Marc Marquez", team: "Ducati Lenovo Team", number: 93, points: 412, leader: true },
  { rank: 2, rider: "Jorge Martin", team: "Aprilia Racing", number: 89, points: 385 },
  { rank: 3, rider: "Marco Bezzecchi", team: "Aprilia Racing", number: 72, points: 310 },
  { rank: 4, rider: "Pedro Acosta", team: "Red Bull KTM Factory Racing", number: 31, points: 290 },
  { rank: 5, rider: "Fabio Di Giannantonio", team: "Pertamina Enduro VR46 Racing Team", number: 49, points: 245 },
  { rank: 6, rider: "Francesco Bagnaia", team: "Ducati Lenovo Team", number: 1, points: 210 },
  { rank: 7, rider: "Ai Ogura", team: "Trackhouse Racing", number: 79, points: 165 },
  { rank: 8, rider: "Brad Binder", team: "Red Bull KTM Factory Racing", number: 33, points: 142 },
  { rank: 9, rider: "Fabio Quartararo", team: "Honda HRC Castrol", number: 20, points: 110 },
  { rank: 10, rider: "Franco Morbidelli", team: "Pertamina Enduro VR46 Racing Team", number: 21, points: 98 },
  { rank: 11, rider: "Johann Zarco", team: "LCR Honda", number: 5, points: 85 },
  { rank: 12, rider: "Jack Miller", team: "Yamaha Factory Racing", number: 43, points: 78 },
  { rank: 13, rider: "Luca Marini", team: "Honda HRC", number: 10, points: 72 },
  { rank: 14, rider: "Alex Rins", team: "Yamaha Factory Racing", number: 42, points: 68 },
  { rank: 15, rider: "Enea Bastianini", team: "Ducati Lenovo Team", number: 23, points: 65 },
  { rank: 16, rider: "Fermin Aldeguer", team: "BK8 Gresini Racing MotoGP", number: 14, points: 52 },
  { rank: 17, rider: "Iker Lecuona", team: "BK8 Gresini Racing MotoGP", number: 27, points: 48 },
  { rank: 18, rider: "Diogo Moreira", team: "Honda HRC Castrol", number: 22, points: 38 },
  { rank: 19, rider: "Toprak Razgatlioglu", team: "Pertamina Enduro VR46 Racing Team", number: 54, points: 30 },
  { rank: 20, rider: "Joan Mir", team: "LCR Honda", number: 36, points: 25 },
  { rank: 21, rider: "Maverick Vinales", team: "Aprilia Racing", number: 12, points: 18 },
  { rank: 22, rider: "Pol Espargaro", team: "Tech3 KTM", number: 44, points: 12 }
];

const STATIC_RIDERS = [
  { number: 93, name: "Marc Marquez", team: "Ducati Lenovo Team", avatar: "MM", color: "#CC0000" },
  { number: 89, name: "Jorge Martin", team: "Aprilia Racing", avatar: "JM", color: "#772CE8" },
  { number: 72, name: "Marco Bezzecchi", team: "Aprilia Racing", avatar: "MB", color: "#772CE8" },
  { number: 31, name: "Pedro Acosta", team: "Red Bull KTM Factory Racing", avatar: "PA", color: "#F48200" },
  { number: 49, name: "Fabio Di Giannantonio", team: "Pertamina Enduro VR46 Racing Team", avatar: "FDG", color: "#F4D03F" },
  { number: 1, name: "Francesco Bagnaia", team: "Ducati Lenovo Team", avatar: "FB", color: "#CC0000" },
  { number: 73, name: "Alex Marquez", team: "BK8 Gresini Racing MotoGP", avatar: "AM", color: "#CC0000" },
  { number: 33, name: "Brad Binder", team: "Red Bull KTM Factory Racing", avatar: "BB", color: "#F48200" },
  { number: 79, name: "Ai Ogura", team: "SuperFile Trackhouse MotoGP Team", avatar: "AO", color: "#1E3A8A" },
  { number: 44, name: "Pol Espargaro", team: "Tech3 KTM", avatar: "PE", color: "#F48200" },
  { number: 20, name: "Fabio Quartararo", team: "Monster Energy Yamaha MotoGP", avatar: "FQ", color: "#003A8C" },
  { number: 21, name: "Franco Morbidelli", team: "Pertamina Enduro VR46 Racing Team", avatar: "FM", color: "#F4D03F" },
  { number: 5, name: "Johann Zarco", team: "CASTROL Honda LCR", avatar: "JZ", color: "#CE0000" },
  { number: 43, name: "Jack Miller", team: "Prima Pramac Yamaha MotoGP", avatar: "JM2", color: "#D62027" },
  { number: 10, name: "Luca Marini", team: "Honda HRC Castrol", avatar: "LM", color: "#CE0000" },
  { number: 42, name: "Alex Rins", team: "Monster Energy Yamaha MotoGP", avatar: "AR", color: "#003A8C" },
  { number: 23, name: "Enea Bastianini", team: "Red Bull KTM Tech3", avatar: "EB", color: "#F48200" },
  { number: 14, name: "Fermin Aldeguer", team: "BK8 Gresini Racing MotoGP", avatar: "FA", color: "#CC0000" },
  { number: 27, name: "Iker Lecuona", team: "BK8 Gresini Racing MotoGP", avatar: "IL", color: "#CC0000" },
  { number: 22, name: "Diogo Moreira", team: "Pro Honda LCR", avatar: "DM", color: "#CE0000" },
  { number: 54, name: "Toprak Razgatlioglu", team: "Prima Pramac Yamaha MotoGP", avatar: "TR", color: "#D62027" },
  { number: 36, name: "Joan Mir", team: "Honda HRC Castrol", avatar: "JMi", color: "#CE0000" },
  { number: 12, name: "Maverick Vinales", team: "Red Bull KTM Tech3", avatar: "MV", color: "#F48200" },
  { number: 25, name: "Raul Fernandez", team: "SuperFile Trackhouse MotoGP Team", avatar: "RF", color: "#1E3A8A" }
];

// ---------- Sirkuit Data (22 GP Musim 2026) ----------
const CIRCUITS = [
  { round: 1, name: "Thailand Grand Prix", circuit: "Chang International Circuit", country: "Thailand", city: "Buriram", date: "27 Feb – 1 Mar 2026", image: "Chang%20International%20Circuit.svg", desc: "Sirkuit modern di Buriram dengan kombinasi lurus panjang dan tikungan teknis. Dirupakan sebagai salah satu sirkuit terbaik di Asia." },
  { round: 2, name: "Brazil Grand Prix", circuit: "Autódromo Internacional Ayrton Senna", country: "Brazil", city: "Goiânia", date: "20 – 22 Mar 2026", image: null, desc: "Kembali ke kalender MotoGP setelah jeda panjang. Sirkuit legendaris di Goiânia dengan karakter tulen berkecepatan tinggi." },
  { round: 3, name: "Grand Prix of The Americas", circuit: "Circuit of The Americas", country: "USA", city: "Austin", date: "27 – 29 Mar 2026", image: "Circuit%20of%20The%20Americas.svg", desc: "Sirkuit buatan Amerika Serikat di Austin. Dikenal dengan tikungan 1 yang legendaris dan lurus panjang memukau." },
  { round: 4, name: "Spanish Grand Prix", circuit: "Circuit de Jerez – Ángel Nieto", country: "Spain", city: "Jerez de la Frontera", date: "24 – 26 Apr 2026", image: "Circuit%20de%20Jerez.svg", desc: "Salah satu sirkuit klasik Eropa dengan karakter teknis dan ramai penggemar. Rumah balapan Spanyol sejak tahun 1980-an." },
  { round: 5, name: "French Grand Prix", circuit: "Le Mans Bugatti Circuit", country: "France", city: "Le Mans", date: "8 – 10 May 2026", image: "Le%20Mans%20Bugatti%20Circuit.svg", desc: "Sirkuit history di Le Mans dengan bagian dalam sirkuit 24 Jam Le Mans. Tikungan Garage Vert dan Curva Dunlop menjadi ikonik." },
  { round: 6, name: "Catalonia Grand Prix", circuit: "Circuit de Barcelona-Catalunya", country: "Catalonia", city: "Montmeló", date: "15 – 17 May 2026", image: "Circuit%20de%20Catalunya.svg", desc: "Sirkuit uji coba utama tim MotoGP di Eropa. Kombinasi lurus panjang panjang dan tumpukan tikungan teknis." },
  { round: 7, name: "Italian Grand Prix", circuit: "Autodromo Internazionale del Mugello", country: "Italy", city: "Scarperia", date: "29 – 31 May 2026", image: "Autodromo%20Internazionale%20del%20Mugello.svg", desc: "Sirkuit legendaris di Toscana dengan lurus panjang legendaris dan tikungan Arrabbiata yang mencekik. Rumah Ducati." },
  { round: 8, name: "Hungarian Grand Prix", circuit: "Balaton Park Circuit", country: "Hungary", city: "Balatonfőkajár", date: "05 – 07 Jun 2026", image: null, desc: "Sirkuit terbaru di kalender MotoGP 2026 di edge Danau Balaton. Layout modern dengan variasi elevasi yang menantang." },
  { round: 9, name: "Czech Grand Prix", circuit: "Brno Circuit", country: "Czechia", city: "Brno", date: "19 – 21 Jun 2026", image: null, desc: "Sirkuit klasik di Brno dengan lurus panjang panjang dan tumpukan tikungan cepat. Favorit para pembalap." },
  { round: 10, name: "Dutch Grand Prix", circuit: "TT Circuit Assen", country: "Netherlands", city: "Assen", date: "26 – 28 Jun 2026", image: "TT%20Circuit%20Assen.svg", desc: "Dikenal sebagai 'Kathedral Kecepatan'. Sirkuit tercepat di kalender dengan suasana balap yang legender sejak 1925." },
  { round: 11, name: "German Grand Prix", circuit: "Sachsenring", country: "Germany", city: "Hohenstein-Ernstthal", date: "10 – 12 Jul 2026", image: "Sachsenring.svg", desc: "Sirkuit kontras di Jerman dengan tikungan cepat dan lambat bercampur. Cocok untuk pembalap dengan gaya agresif." },
  { round: 12, name: "British Grand Prix", circuit: "Silverstone Circuit", country: "Great Britain", city: "Silverstone", date: "7 – 9 Aug 2026", image: "Silverstone.svg", desc: "Sirkuit legendaris di Inggris dengan kombinasi lurus panjang cepat dan tikungan magenta. Rumah balap Inggris sejak 1948." },
  { round: 13, name: "Aragon Grand Prix", circuit: "MotorLand Aragón", country: "Aragon", city: "Alcañiz", date: "28 – 30 Aug 2026", image: null, desc: "Sirkuit modern di Spanyol dengan variasi elevasi dan tumpukan tikungan teknis. Dikenal dari overtaking yang dramatis." },
  { round: 14, name: "San Marino Grand Prix", circuit: "Misano World Circuit Marco Simoncelli", country: "San Marino", city: "Misano Adriatico", date: "11 – 13 Sep 2026", image: "Misano%20World%20Circuit.svg", desc: "Sirkuit di Riviera Italia dengan suasana hangat dan tumpukan tikungan cepat. Dipecat sebagai 'Misano' oleh penggemar." },
  { round: 15, name: "Austrian Grand Prix", circuit: "Red Bull Ring", country: "Austria", city: "Spielberg", date: "18 – 20 Sep 2026", image: "Red%20Bull%20Ring.svg", desc: "Sirkuit di pegunungan Alpen dengan lurus panjang cepat dan tikungan pendek. Cocok untuk balapan berkecepatan tinggi." },
  { round: 16, name: "Japanese Grand Prix", circuit: "Twin Ring Motegi", country: "Japan", city: "Motegi", date: "2 – 4 Oct 2026", image: "Twin%20Ring%20Motegi.svg", desc: "Sirkuit Honda di Jepang dengan kombinasi oval dan road course. Balapan malam dengan suasana Jepang yang unik." },
  { round: 17, name: "Indonesian Grand Prix", circuit: "Mandalika International Circuit", country: "Indonesia", city: "Lombok", date: "9 – 10 Oct 2026", image: "Mandalika%20International%20Circuit.svg", desc: "Sirkuit pantai di Lombok dengan pemandangan laut yang indah. Balapan di pantai Lombok." },
  { round: 18, name: "Australian Grand Prix", circuit: "Phillip Island Circuit", country: "Australia", city: "Phillip Island", date: "23 – 25 Oct 2026", image: "Phillip%20Island%20Circuit.svg", desc: "Sirkuit pantai di Australia dengan angin laut yang kencang dan tumpukan tikungan cepat." },
  { round: 19, name: "Malaysian Grand Prix", circuit: "Sepang International Circuit", country: "Malaysia", city: "Sepang", date: "30 Oct – 1 Nov 2026", image: "Sepang%20International%20Circuit.svg", desc: "Sirkuit legendaris di Malaysia dengan lurus panjang panjang dan tumpukan tikungan teknis. Suasana panas dan lembab." },
  { round: 20, name: "Qatar Airways Grand Prix of Qatar", circuit: "Lusail International Circuit", country: "Qatar", city: "Lusail", date: "06 – 08 Nov 2026", image: "Losail%20International%20Circuit.svg", desc: "Sirkuit malam di Doha dengan lampu sorot yang indah. Balapan Aktif GP ke-20 musim 2026." },
  { round: 21, name: "Portuguese Grand Prix", circuit: "Autódromo Internacional do Algarve", country: "Portugal", city: "Portimão", date: "20 – 22 Nov 2026", image: "Autodromo%20International%20Algarve.svg", desc: "Sirkuit modern di Portimão dengan elevasi yang dramatis dan tumpukan tikungan teknis. GP ke-21 musim 2026." },
  { round: 22, name: "Valencia Grand Prix", circuit: "Circuit Ricardo Tormo", country: "Spain", city: "Cheste", date: "27 – 29 Nov 2026", image: "Circuit%20de%20la%20Comunitat%20Valenciana%20Ricardo%20Tormo.svg", desc: "Sirkuit finale musim di Valencia. Balapan penutup 2026 dengan suasana merayakan akhir musim." }
];

// ---------- Renderers ----------
function renderSchedule(data = null) {
  const grid = $("#grid-schedule");
  const empty = $("#schedule-empty");
  const list = data || state.schedule || STATIC_SCHEDULE;
  const usingStatic = data === null && state.apiStatus === "offline";

  const scheduleFilter = $("#schedule-filter");
  const scheduleSearch = $("#schedule-search");
  const filterVal = scheduleFilter ? scheduleFilter.value : "all";
  const query = scheduleSearch ? scheduleSearch.value.toLowerCase() : "";

  const filtered = list.filter((item) => {
    const matchStatus = filterVal === "all" || item.status === filterVal;
    const matchQuery =
      item.circuit.toLowerCase().includes(query) ||
      item.country.toLowerCase().includes(query) ||
      (item.note || "").toLowerCase().includes(query);
    return matchStatus && matchQuery;
  });

  empty.style.display = filtered.length ? "none" : "block";
  grid.innerHTML = filtered.map((item, i) => {
    const statusText = {
      completed: "Selesai",
      upcoming: "Akan Datang",
      active: "Sedang Berlangsung"
    }[item.status];

    const circuitImage = item.circuitImage
      ? `https://api.lucasarts.fr/gp/motogp/circuit/svg/${item.circuitImage}`
      : null;

    return `
      <article class="card reveal schedule-card" style="transition-delay: ${i * 80}ms">
        ${circuitImage ? `<img src="${circuitImage}" alt="${item.circuit} layout" class="circuit-layout" loading="lazy" />` : ''}
        <div class="schedule-badge ${item.status}">${statusText}</div>
        <div class="circuit">${item.circuit}</div>
        <span class="country">${item.country}</span>
        <div class="meta">
          <span>📅 ${item.date}</span>
          <span>🏁 Round ${item.round}</span>
        </div>
        ${item.note ? `<div style="font-size:0.8rem;color:var(--text-muted);margin-bottom:14px;">${item.note}</div>` : ""}
        <div class="actions">
          <button class="btn primary">Detail</button>
          <button class="btn">Tiket</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderResults(data = null) {
  const grid = $("#grid-results");
  const empty = $("#results-empty");
  const list = data || state.results || STATIC_RESULTS;
  const usingStatic = data === null && state.apiStatus === "offline";

  const resultsSearch = $("#results-search");
  const query = resultsSearch ? resultsSearch.value.toLowerCase() : "";

  const filtered = list.filter((item) =>
    item.rider.toLowerCase().includes(query) ||
    item.team.toLowerCase().includes(query)
  );

  empty.style.display = filtered.length ? "none" : "block";
  grid.innerHTML = filtered.map((item, i) => {
    const posClass = `p${item.pos}`;
    return `
      <article class="card reveal" style="transition-delay: ${i * 80}ms">
        <div class="result-row">
          <div class="result-pos ${posClass}">${item.pos}</div>
          <div class="rider-info">
            <span class="rider-name">${item.rider}</span>
            <span class="rider-team">${item.team}</span>
          </div>
          <div class="rider-time">${item.time} ${item.gap}</div>
        </div>
      </article>
    `;
  }).join("");
}

function renderStandings(data = null) {
  const wrap = $("#grid-standings");
  const list = data || state.standings || STATIC_STANDINGS;
  const maxPoints = Math.max(...list.map((s) => s.points || 0));

  wrap.innerHTML = list.map((item, i) => {
    const pct = maxPoints > 0 ? (((item.points || 0) / maxPoints) * 100).toFixed(1) : 0;
    return `
      <div class="standing-item reveal" style="transition-delay: ${i * 80}ms">
        <div class="standing-rank ${item.leader ? "leader" : ""}">${item.rank}</div>
        <div class="standing-rider">
          <span class="standing-name">${item.rider}</span>
          <span class="standing-team">${item.team}</span>
        </div>
        <span class="standing-points">${formatPoints(item.points)}</span>
        <div class="points-bar">
          <div class="points-fill" data-width="${pct}%"></div>
        </div>
      </div>
    `;
  }).join("");

  setTimeout(() => {
    $$(".points-fill").forEach((el) => {
      el.style.width = el.dataset.width;
    });
  }, 100);
}

function renderCircuits(data = null) {
  const grid = $("#grid-circuits");
  const empty = $("#circuits-empty");
  const list = data || CIRCUITS;

  const circuitsSearch = $("#circuits-search");
  const query = circuitsSearch ? circuitsSearch.value.toLowerCase() : "";

  const filtered = list.filter((item) =>
    item.name.toLowerCase().includes(query) ||
    item.circuit.toLowerCase().includes(query) ||
    item.country.toLowerCase().includes(query) ||
    item.city.toLowerCase().includes(query)
  );

  empty.style.display = filtered.length ? "none" : "block";
  grid.innerHTML = filtered.map((item, i) => {
    const circuitImage = item.image
      ? `https://api.lucasarts.fr/gp/motogp/circuit/svg/${item.image}`
      : null;

    return `
      <article class="card reveal circuit-card" style="transition-delay: ${i * 80}ms">
        ${circuitImage ? `<img src="${circuitImage}" alt="${item.circuit} layout" class="circuit-layout" loading="lazy" />` : `
          <div class="circuit-layout placeholder">
            <div class="placeholder-icon">🏁</div>
            <div class="placeholder-text">Layout tidak tersedia</div>
          </div>`}
        <div class="circuit-badge">Round ${item.round}</div>
        <div class="circuit-name">${item.name}</div>
        <span class="circuit-location">${item.city}, ${item.country}</span>
        <div class="circuit-meta">
          <span>📅 ${item.date}</span>
        </div>
        <div style="font-size:0.85rem;color:var(--text-muted);margin:14px 0;line-height:1.4;">${item.desc}</div>
        <div class="circuit-actions">
          <button class="btn primary">Lihat Detail</button>
        </div>
      </article>
    `;
  }).join("");
}

function renderRiders(data = null) {
  const grid = $("#grid-riders");
  const empty = $("#riders-empty");
  const list = data || state.riders || STATIC_RIDERS;
  const usingStatic = data === null && state.apiStatus === "offline";

  const ridersSearch = $("#riders-search");
  const ridersSort = $("#riders-sort");
  const query = ridersSearch ? ridersSearch.value.toLowerCase() : "";
  const sortBy = ridersSort ? ridersSort.value : "number";

  let filtered = list.filter((item) =>
    item.name.toLowerCase().includes(query) ||
    item.team.toLowerCase().includes(query)
  );

  if (sortBy === "name") {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  } else if (sortBy === "team") {
    filtered.sort((a, b) => a.team.localeCompare(b.team));
  } else {
    filtered.sort((a, b) => a.number - b.number);
  }

  empty.style.display = filtered.length ? "none" : "block";
  grid.innerHTML = filtered.map((item, i) => {
    const standing = (state.standings || STATIC_STANDINGS).find((s) => s.rider === item.name);
    const riderColor = item.color || "#CC0000";
    return `
      <article class="card reveal rider-card" style="transition-delay: ${i * 80}ms">
        <span class="number-badge" style="background:${riderColor};box-shadow:0 0 15px ${riderColor}80;">#${item.number}</span>
        <div class="rider-avatar">${item.avatar}</div>
        <h3>${item.name}</h3>
        <span class="team">${item.team}</span>
        <div class="stats">
          <div class="stat-box">
            <span class="stat-val">${standing ? standing.rank : "-"}</span>
            <span class="stat-lab">Klasemen</span>
          </div>
          <div class="stat-box">
            <span class="stat-val">${item.number}</span>
            <span class="stat-lab">Nomor</span>
          </div>
          <div class="stat-box">
            <span class="stat-val">2026</span>
            <span class="stat-lab">Musim</span>
          </div>
        </div>
      </article>
    `;
  }).join("");
}

// ---------- Tab Navigation ----------
const links = $$(".nav-link");
const panels = $$(".tab-panel");

function activateTab(tabId) {
  links.forEach((link) => {
    link.classList.toggle("active", link.dataset.tab === tabId);
  });

  panels.forEach((panel) => {
    panel.classList.toggle("active", panel.id === tabId);
  });

  const titles = {
    schedule: "Jadwal Balap 2026",
    results: "Result Musim 2026",
    standings: "Standing Dunia 2026",
    riders: "Riders & Tim 2026",
    circuits: "Sirkuit MotoGP 2026"
  };
  const subs = {
    schedule: "Lengkap jadwal balapan MotoGP tahun 2026",
    results: "Hasil balapan terbaru dari setiap ronde",
    standings: "Peringkat pembalap dalam klasemen dunia",
    riders: "Daftar pembalap dan tim resmi MotoGP",
    circuits: "Semua sirkuit balapan musim 2026 dengan layout"
  };
  $("#page-title").textContent = titles[tabId];
  $("#page-sub").textContent = subs[tabId];

  const revealItems = document.querySelectorAll(`#${tabId} .reveal`);
  revealItems.forEach((el, i) => {
    el.classList.remove("active");
    void el.offsetWidth;
    el.style.transitionDelay = `${i * 80}ms`;
    el.classList.add("active");
  });

  if (tabId === "standings") {
    $$(".points-fill").forEach((el) => {
      el.style.width = "0%";
    });
    setTimeout(() => {
      $$(".points-fill").forEach((el) => {
        el.style.width = el.dataset.width;
      });
    }, 300);
  }
}

links.forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    activateTab(link.dataset.tab);
  });
});

// ---------- Intersection Observer ----------
const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add("active");
      }
    });
  },
  { threshold: 0.12, rootMargin: "0px 0px -60px 0px" }
);

function observeReveals() {
  document.querySelectorAll(".reveal").forEach((el) => observer.observe(el));
}

// ---------- Wire Controls ----------
function wireControls() {
  const scheduleSearch = $("#schedule-search");
  const scheduleFilter = $("#schedule-filter");
  if (scheduleSearch && scheduleFilter) {
    const handleSchedule = debounce(() => {
      renderSchedule();
      observeReveals();
    }, 150);
    scheduleSearch.addEventListener("input", handleSchedule);
    scheduleFilter.addEventListener("change", handleSchedule);
  }

  const resultsSearch = $("#results-search");
  if (resultsSearch) {
    resultsSearch.addEventListener("input", debounce(() => {
      renderResults();
      observeReveals();
    }, 150));
  }

  const ridersSearch = $("#riders-search");
  const ridersSort = $("#riders-sort");
  if (ridersSearch && ridersSort) {
    const handleRiders = debounce(() => {
      renderRiders();
      observeReveals();
    }, 150);
    ridersSearch.addEventListener("input", handleRiders);
    ridersSort.addEventListener("change", handleRiders);
  }

  const circuitsSearch = $("#circuits-search");
  if (circuitsSearch) {
    circuitsSearch.addEventListener("input", debounce(() => {
      renderCircuits();
      observeReveals();
    }, 150));
  }
}

// ---------- Theme Toggle ----------
function initTheme() {
  const toggle = $("#theme-toggle");
  const savedTheme = localStorage.getItem("motogp-theme") || "dark";
  document.documentElement.setAttribute("data-theme", savedTheme);
  updateThemeButton(savedTheme);

  toggle.addEventListener("click", () => {
    const current = document.documentElement.getAttribute("data-theme");
    const newTheme = current === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", newTheme);
    localStorage.setItem("motogp-theme", newTheme);
    updateThemeButton(newTheme);
  });
}

function updateThemeButton(theme) {
  const toggle = $("#theme-toggle");
  const icon = toggle.querySelector(".toggle-icon");
  const label = toggle.querySelector(".toggle-label");
  if (theme === "light") {
    icon.textContent = "☀️";
    label.textContent = "Tema Terang";
  } else {
    icon.textContent = "🌙";
    label.textContent = "Tema Gelap";
  }
}

// ---------- Init ----------
async function init() {
  const loader = $("#loader");

  // Inisialisasi tema
  initTheme();

  // Tampilkan loader
  setTimeout(() => {
    loader.classList.add("done");
  }, 700);

  // Coba muat data dari API
  try {
    await loadSeasonAndCategory();

    if (state.apiStatus === "online") {
      const [schedule, standings, riders, results] = await Promise.all([
        loadSchedule(),
        loadStandings(),
        loadRiders(),
        loadResults(),
      ]);
    } else {
      // Gunakan data statis sebagai fallback
      state.schedule = STATIC_SCHEDULE;
      state.standings = STATIC_STANDINGS;
      state.riders = STATIC_RIDERS;
      state.results = STATIC_RESULTS;
    }
  } catch (err) {
    console.error("Init error:", err);
    apiStatus("Gagal memuat data", "offline");
    state.schedule = STATIC_SCHEDULE;
    state.standings = STATIC_STANDINGS;
    state.riders = STATIC_RIDERS;
    state.results = STATIC_RESULTS;
  }

  // Render awal
  renderSchedule();
  renderResults();
  renderStandings();
  renderRiders();
  renderCircuits();

  activateTab("schedule");
  wireControls();
  observeReveals();
}

document.addEventListener("DOMContentLoaded", init);

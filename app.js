(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY = 'routerijder-v5-settings';
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');

  const state = {
    apiKey: saved.apiKey || '',
    profile: saved.profile || 'car',
    autoFollow: saved.autoFollow !== false,
    startMode: 'gps',
    startPoint: null,
    startLabel: 'Mijn locatie',
    destinationPoint: null,
    destinationLabel: '',
    current: null,
    route: null,
    original: [],
    mode: 'idle',
    watchId: null,
    marker: null,
    startMarker: null,
    destinationMarker: null,
    mapReady: false,
    pickingStart: false,
    follow: false,
    simulation: { timer: null, playing: false, distanceKm: 0, speedFactor: 5, lastTime: 0 },
    progressKm: 0,
    offCount: 0,
    lastReroute: 0
  };

  if (!window.maplibregl || !window.turf) {
    alert('De kaart- of routebibliotheek kon niet worden geladen. Vernieuw de pagina.');
    return;
  }

  const status = (text) => { $('status').textContent = text; };
  const fmtDistance = (m) => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const fmtDuration = (ms) => {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} u ${minutes % 60} min` : `${minutes} min`;
  };

  const map = new maplibregl.Map({
    container: 'map',
    style: {
      version: 8,
      sources: { osm: { type: 'raster', tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'], tileSize: 256, attribution: '© OpenStreetMap-bijdragers' } },
      layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
    },
    center: [5.3, 52.1],
    zoom: 7
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

  map.on('load', () => {
    addRouteLayer('main-route', '#2563eb', 8);
    addRouteLayer('rejoin-route', '#f97316', 7);
    state.mapReady = true;
    status('Klaar om te testen');
  });

  function addRouteLayer(id, color, width) {
    map.addSource(id, { type: 'geojson', data: turf.lineString([]) });
    map.addLayer({ id, type: 'line', source: id, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': color, 'line-width': width, 'line-opacity': .92 } });
  }

  function ensureKey() {
    if (!state.apiKey.trim()) throw new Error('Vul eerst je GraphHopper API-key in via het tandwiel.');
  }

  async function geocode(query) {
    ensureKey();
    const url = new URL('https://graphhopper.com/api/1/geocode');
    url.searchParams.set('q', query);
    url.searchParams.set('locale', 'nl');
    url.searchParams.set('limit', '6');
    url.searchParams.set('key', state.apiKey);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Adres zoeken mislukt (${response.status}).`);
    const data = await response.json();
    return (data.hits || []).map(hit => ({
      label: [hit.name, hit.street, hit.housenumber, hit.city, hit.country].filter(Boolean).join(', '),
      point: [hit.point.lng, hit.point.lat]
    }));
  }

  async function calculateRoute(points) {
    ensureKey();
    const url = new URL('https://graphhopper.com/api/1/route');
    points.forEach(([lng, lat]) => url.searchParams.append('point', `${lat},${lng}`));
    Object.entries({ profile: state.profile, locale: 'nl', instructions: 'true', points_encoded: 'false', calc_points: 'true', key: state.apiKey }).forEach(([k,v]) => url.searchParams.set(k,v));
    const response = await fetch(url);
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) {}
      throw new Error(`Routeberekening mislukt (${response.status})${detail ? `: ${detail}` : ''}.`);
    }
    const data = await response.json();
    const path = data.paths && data.paths[0];
    if (!path) throw new Error('Geen route gevonden.');
    return { coordinates: path.points.coordinates, distance: path.distance, time: path.time, instructions: path.instructions || [] };
  }

  function setMarker(type, point) {
    if (!point) return;
    const color = type === 'start' ? '#0ea5e9' : '#ef4444';
    const key = type === 'start' ? 'startMarker' : 'destinationMarker';
    if (!state[key]) state[key] = new maplibregl.Marker({ color }).setLngLat(point).addTo(map);
    else state[key].setLngLat(point);
  }

  function setCurrentPosition(point, options = {}) {
    state.current = point;
    if (!state.marker) state.marker = new maplibregl.Marker({ color: '#16a34a' }).setLngLat(point).addTo(map);
    else state.marker.setLngLat(point);
    if (options.source) $('devSource').textContent = options.source;
    $('devPosition').textContent = `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
    updateNavigation(point, options.speedMps || 0, options.heading);
  }

  function drawRoute(data, mode) {
    state.route = data;
    state.original = data.coordinates.slice();
    state.mode = mode;
    state.progressKm = 0;
    state.follow = false;
    const main = map.getSource('main-route');
    const rejoin = map.getSource('rejoin-route');
    if (main) main.setData(turf.lineString(mode === 'rejoin' ? state.original : data.coordinates));
    if (rejoin) rejoin.setData(turf.lineString(mode === 'rejoin' ? data.coordinates : []));
    showOverview();
    const first = data.instructions[0];
    $('instruction').textContent = first ? first.text : mode === 'gpx' ? 'Volg de geladen GPX-route' : 'Volg de route';
    $('routeMeta').textContent = `${fmtDistance(data.distance)}${data.time ? ` · ${fmtDuration(data.time)}` : ''}`;
    $('maneuverIcon').textContent = '↑';
    updateDeveloper();
  }

  function showOverview() {
    if (!state.route || !state.route.coordinates.length) return status('Er is nog geen route om te tonen.');
    const bounds = state.route.coordinates.reduce((b,c) => b.extend(c), new maplibregl.LngLatBounds(state.route.coordinates[0], state.route.coordinates[0]));
    map.fitBounds(bounds, { padding: { top: 165, bottom: 165, left: 55, right: 55 }, duration: 650 });
    state.follow = false;
    status('Route-overzicht');
  }

  function getStartPoint() {
    if (state.startMode === 'manual') {
      if (!state.startPoint) throw new Error('Kies eerst een handmatig vertrekpunt.');
      return state.startPoint;
    }
    if (!state.current) throw new Error('Start GPS en wacht op je locatie, of kies Handmatig.');
    return state.current;
  }

  async function planRoute() {
    try {
      const destinationText = $('destinationQuery').value.trim();
      if (!state.destinationPoint) {
        if (!destinationText) throw new Error('Vul een bestemming in.');
        await showSearchResults(destinationText, 'destination', true);
        return;
      }
      const start = getStartPoint();
      status('Route berekenen…');
      const data = await calculateRoute([start, state.destinationPoint]);
      setMarker('start', start);
      setMarker('destination', state.destinationPoint);
      drawRoute(data, 'address');
      status(`Route klaar: ${fmtDistance(data.distance)}`);
    } catch (error) { status(error.message); }
  }

  async function showSearchResults(query, target, autoSelectSingle = false) {
    status('Adres zoeken…');
    const hits = await geocode(query);
    if (!hits.length) throw new Error('Geen adressen gevonden.');
    const box = $('searchResults');
    box.innerHTML = '';
    hits.forEach(hit => {
      const button = document.createElement('button');
      button.className = 'search-result';
      button.textContent = hit.label;
      button.onclick = () => selectSearchHit(hit, target);
      box.appendChild(button);
    });
    box.hidden = false;
    status(target === 'start' ? 'Kies een vertrekpunt' : 'Kies een bestemming');
    if (autoSelectSingle && hits.length === 1) selectSearchHit(hits[0], target);
  }

  function selectSearchHit(hit, target) {
    $('searchResults').hidden = true;
    if (target === 'start') {
      state.startPoint = hit.point;
      state.startLabel = hit.label;
      $('startQuery').value = hit.label;
      setMarker('start', hit.point);
      map.easeTo({ center: hit.point, zoom: 13 });
      status('Vertrekpunt gekozen');
    } else {
      state.destinationPoint = hit.point;
      state.destinationLabel = hit.label;
      $('destinationQuery').value = hit.label;
      setMarker('destination', hit.point);
      status('Bestemming gekozen; route berekenen…');
      planRoute();
    }
  }

  function toggleStartMode() {
    state.startMode = state.startMode === 'gps' ? 'manual' : 'gps';
    const manual = state.startMode === 'manual';
    $('startMode').textContent = manual ? 'Hand' : 'GPS';
    $('startMode').classList.toggle('manual', manual);
    $('startQuery').disabled = !manual;
    $('startQuery').placeholder = manual ? 'Vul een vertrekadres in' : 'Vertrekpunt: mijn locatie';
    if (!manual) $('startQuery').value = state.current ? 'Mijn huidige locatie' : '';
    status(manual ? 'Handmatig vertrekpunt actief' : 'GPS als vertrekpunt actief');
  }

  function requestMapStart() {
    if (state.startMode !== 'manual') toggleStartMode();
    state.pickingStart = true;
    map.getCanvas().classList.add('map-pick-mode');
    status('Klik op de kaart om het vertrekpunt te kiezen');
  }

  map.on('click', (event) => {
    if (!state.pickingStart) return;
    state.pickingStart = false;
    map.getCanvas().classList.remove('map-pick-mode');
    const point = [event.lngLat.lng, event.lngLat.lat];
    state.startPoint = point;
    state.startLabel = `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
    $('startQuery').value = state.startLabel;
    setMarker('start', point);
    status('Vertrekpunt op kaart gekozen');
  });

  function gpsErrorMessage(error) {
    if (error.code === 1) return 'Locatietoegang geweigerd. Controleer browser- én Windows-locatie-instellingen.';
    if (error.code === 2) return 'Locatie niet beschikbaar. Gebruik Handmatig om op desktop te testen.';
    if (error.code === 3) return 'Locatie zoeken duurde te lang. Probeer opnieuw of gebruik Handmatig.';
    return `GPS-fout: ${error.message}`;
  }

  function toggleGps() {
    if (state.watchId !== null) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
      $('gps').classList.remove('active');
      $('gps').textContent = 'Start GPS';
      status('GPS gepauzeerd');
      return;
    }
    if (!navigator.geolocation) return status('Deze browser ondersteunt geen locatiebepaling.');
    $('gps').textContent = 'Zoeken…';
    status('Locatie zoeken…');
    state.watchId = navigator.geolocation.watchPosition(
      pos => {
        const point = [pos.coords.longitude, pos.coords.latitude];
        setCurrentPosition(point, { source: 'Echte GPS', speedMps: pos.coords.speed || 0, heading: pos.coords.heading });
        $('gps').classList.add('active');
        $('gps').textContent = 'GPS actief';
        if (state.startMode === 'gps') $('startQuery').value = 'Mijn huidige locatie';
        status(`GPS actief · nauwkeurigheid ${Math.round(pos.coords.accuracy)} m`);
      },
      error => {
        status(gpsErrorMessage(error));
        $('gps').classList.remove('active');
        $('gps').textContent = 'Start GPS';
        if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 }
    );
    navigator.wakeLock?.request('screen').catch(() => {});
  }

  function updateNavigation(point, speedMps, heading) {
    $('devSpeed').textContent = `${Math.round(speedMps * 3.6)} km/u`;
    if (!state.route || state.route.coordinates.length < 2) {
      if (state.follow) map.easeTo({ center: point, zoom: 16, pitch: 45, bearing: Number.isFinite(heading) ? heading : map.getBearing(), duration: 450 });
      return;
    }

    const line = turf.lineString(state.route.coordinates);
    const snap = turf.nearestPointOnLine(line, turf.point(point), { units: 'kilometers' });
    const location = Number(snap.properties.location || 0);
    const offKm = turf.distance(turf.point(point), snap, { units: 'kilometers' });
    state.progressKm = Math.max(state.progressKm, location);
    $('devOffRoute').textContent = `${Math.round(offKm * 1000)} m`;

    const totalKm = turf.length(line, { units: 'kilometers' });
    const percentage = totalKm ? Math.min(100, Math.round(location / totalKm * 100)) : 0;
    $('devProgress').textContent = `${percentage}%`;

    updateInstructionByIndex(Number(snap.properties.index || 0));

    if (state.autoFollow && (state.follow || speedMps > 1.2 || state.simulation.playing)) {
      state.follow = true;
      const derivedHeading = Number.isFinite(heading) ? heading : bearingAlongRoute(line, location);
      map.easeTo({ center: point, zoom: 16.5, pitch: 52, bearing: derivedHeading, duration: 350 });
    }

    if ((state.mode === 'address' || state.mode === 'gpx') && offKm > 0.065) state.offCount += 1;
    else state.offCount = 0;
    if (state.offCount >= 3 && !state.simulation.playing) {
      state.offCount = 0;
      smartRejoin(point);
    }
  }

  function bearingAlongRoute(line, locationKm) {
    const total = turf.length(line, { units: 'kilometers' });
    const a = turf.along(line, Math.max(0, locationKm), { units: 'kilometers' });
    const b = turf.along(line, Math.min(total, locationKm + .05), { units: 'kilometers' });
    return turf.bearing(a, b);
  }

  function updateInstructionByIndex(index) {
    const instructions = state.route.instructions || [];
    const current = instructions.find(item => item.interval && index >= item.interval[0] && index <= item.interval[1]) || instructions.find(item => item.interval && item.interval[0] >= index);
    if (!current) {
      $('devInstruction').textContent = state.mode === 'gpx' ? 'Volg GPX' : '-';
      return;
    }
    $('instruction').textContent = `${fmtDistance(current.distance)} · ${current.text}`;
    $('devInstruction').textContent = current.text;
    $('maneuverIcon').textContent = maneuverSymbol(current.sign);
  }

  function maneuverSymbol(sign) {
    const symbols = { '-3': '↶', '-2': '↙', '-1': '↖', '0': '↑', '1': '↗', '2': '↘', '3': '↷', '4': '🏁', '5': '🏁', '6': '↻', '-6': '↺' };
    return symbols[String(sign)] || '↑';
  }

  async function smartRejoin(point) {
    if (!state.original.length || !state.apiKey || Date.now() - state.lastReroute < 25000) return;
    state.lastReroute = Date.now();
    status('Slim aansluitpunt zoeken…');
    const line = turf.lineString(state.original);
    const total = turf.length(line, { units: 'kilometers' });
    const candidates = [0.5,1,2,4].map(v => Math.min(total, state.progressKm + v)).filter((v,i,a) => v > state.progressKm + .1 && a.indexOf(v) === i);
    const routes = [];
    for (const km of candidates) {
      try {
        const target = turf.along(line, km, { units: 'kilometers' }).geometry.coordinates;
        const route = await calculateRoute([point, target]);
        routes.push({ route, km, score: route.distance + km * 30 });
      } catch (_) {}
    }
    routes.sort((a,b) => a.score - b.score);
    if (!routes[0]) return status('Geen geschikte aansluiting gevonden.');
    const source = map.getSource('rejoin-route');
    if (source) source.setData(turf.lineString(routes[0].route.coordinates));
    status(`Aansluitroute: ${fmtDistance(routes[0].route.distance)}`);
  }

  function parseGpx(xml) {
    const points = Array.from(xml.querySelectorAll('trkpt')).length ? Array.from(xml.querySelectorAll('trkpt')) : Array.from(xml.querySelectorAll('rtept'));
    return points.map(n => [Number(n.getAttribute('lon')), Number(n.getAttribute('lat'))]).filter(([lng,lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  }

  async function loadGpx(event) {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Dit GPX-bestand kan niet worden gelezen.');
      const coordinates = parseGpx(xml);
      if (coordinates.length < 2) throw new Error('Geen bruikbare GPX-track gevonden.');
      const distance = turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000;
      state.startMode = 'manual';
      $('startMode').textContent = 'Hand';
      $('startMode').classList.add('manual');
      $('startQuery').disabled = false;
      state.startPoint = coordinates[0];
      $('startQuery').value = 'Start GPX';
      setMarker('start', coordinates[0]);
      setMarker('destination', coordinates[coordinates.length - 1]);
      drawRoute({ coordinates, distance, time: 0, instructions: [] }, 'gpx');
      status(`GPX geladen: ${fmtDistance(distance)}. Gebruik Test om te simuleren.`);
    } catch (error) { status(error.message); }
    finally { event.target.value = ''; }
  }

  function toggleSimulation() {
    if (!state.route || state.route.coordinates.length < 2) return status('Bereken of laad eerst een route.');
    if (state.simulation.playing) return pauseSimulation();
    state.simulation.playing = true;
    state.follow = true;
    state.simulation.lastTime = performance.now();
    $('simPlay').textContent = '⏸ Pauze';
    $('simPlay').classList.add('active');
    $('devSource').textContent = 'Simulatie';
    status('Routesimulatie gestart');
    state.simulation.timer = requestAnimationFrame(simulationFrame);
  }

  function pauseSimulation() {
    state.simulation.playing = false;
    if (state.simulation.timer) cancelAnimationFrame(state.simulation.timer);
    state.simulation.timer = null;
    $('simPlay').textContent = '▶ Simuleer';
    $('simPlay').classList.remove('active');
    status('Simulatie gepauzeerd');
  }

  function resetSimulation() {
    pauseSimulation();
    state.simulation.distanceKm = 0;
    state.progressKm = 0;
    if (state.route && state.route.coordinates.length) {
      setCurrentPosition(state.route.coordinates[0], { source: 'Simulatie', speedMps: 0 });
      showOverview();
    }
    updateDeveloper();
    status('Simulatie teruggezet');
  }

  function simulationFrame(now) {
    if (!state.simulation.playing || !state.route) return;
    const dt = Math.min(.1, (now - state.simulation.lastTime) / 1000);
    state.simulation.lastTime = now;
    const line = turf.lineString(state.route.coordinates);
    const totalKm = turf.length(line, { units: 'kilometers' });
    const baseSpeedKmh = state.profile === 'bike' ? 22 : state.profile === 'foot' ? 5 : 70;
    const simulatedKmh = baseSpeedKmh * state.simulation.speedFactor;
    state.simulation.distanceKm += simulatedKmh * dt / 3600;
    if (state.simulation.distanceKm >= totalKm) {
      state.simulation.distanceKm = totalKm;
      const end = turf.along(line, totalKm, { units: 'kilometers' }).geometry.coordinates;
      setCurrentPosition(end, { source: 'Simulatie', speedMps: 0, heading: bearingAlongRoute(line, Math.max(0,totalKm-.05)) });
      pauseSimulation();
      $('instruction').textContent = 'Bestemming bereikt';
      $('maneuverIcon').textContent = '🏁';
      status('Simulatie voltooid');
      return;
    }
    const p = turf.along(line, state.simulation.distanceKm, { units: 'kilometers' }).geometry.coordinates;
    setCurrentPosition(p, { source: 'Simulatie', speedMps: baseSpeedKmh / 3.6, heading: bearingAlongRoute(line, state.simulation.distanceKm) });
    state.simulation.timer = requestAnimationFrame(simulationFrame);
  }

  function clearRoute() {
    pauseSimulation();
    state.route = null;
    state.original = [];
    state.destinationPoint = null;
    state.mode = 'idle';
    state.progressKm = 0;
    state.simulation.distanceKm = 0;
    ['main-route','rejoin-route'].forEach(id => map.getSource(id)?.setData(turf.lineString([])));
    if (state.destinationMarker) { state.destinationMarker.remove(); state.destinationMarker = null; }
    $('destinationQuery').value = '';
    $('instruction').textContent = 'Geen actieve route';
    $('routeMeta').textContent = 'Kies een vertrekpunt en bestemming';
    $('maneuverIcon').textContent = '↑';
    updateDeveloper();
    status('Route gewist');
  }

  function updateDeveloper() {
    if (!state.route) {
      $('devProgress').textContent = '0%';
      $('devOffRoute').textContent = '-';
      $('devInstruction').textContent = '-';
    }
  }

  function openSettings() { $('apiKey').value = state.apiKey; $('vehicleProfile').value = state.profile; $('autoFollow').checked = state.autoFollow; $('settingsSheet').hidden = false; $('backdrop').hidden = false; }
  function closeSettings() { $('settingsSheet').hidden = true; $('backdrop').hidden = true; }
  function saveSettings() {
    state.apiKey = $('apiKey').value.trim();
    state.profile = $('vehicleProfile').value;
    state.autoFollow = $('autoFollow').checked;
    localStorage.setItem(KEY, JSON.stringify({ apiKey: state.apiKey, profile: state.profile, autoFollow: state.autoFollow }));
    closeSettings();
    status('Instellingen opgeslagen');
  }

  $('startMode').onclick = toggleStartMode;
  $('useMapStart').onclick = requestMapStart;
  $('planRoute').onclick = planRoute;
  $('gps').onclick = toggleGps;
  $('gpx').onclick = () => $('gpxFile').click();
  $('gpxFile').onchange = loadGpx;
  $('overview').onclick = showOverview;
  $('clear').onclick = clearRoute;
  $('developer').onclick = () => { $('developerPanel').hidden = !$('developerPanel').hidden; };
  $('closeDeveloper').onclick = () => { $('developerPanel').hidden = true; };
  $('simPlay').onclick = toggleSimulation;
  $('simReset').onclick = resetSimulation;
  $('simSpeed').onchange = event => { state.simulation.speedFactor = Number(event.target.value); };
  $('settings').onclick = openSettings;
  $('closeSettings').onclick = closeSettings;
  $('backdrop').onclick = closeSettings;
  $('saveSettings').onclick = saveSettings;
  $('destinationQuery').oninput = () => { state.destinationPoint = null; };
  $('startQuery').oninput = () => { state.startPoint = null; };
  $('destinationQuery').onkeydown = async event => { if (event.key === 'Enter') { try { await showSearchResults(event.target.value.trim(), 'destination'); } catch (error) { status(error.message); } } };
  $('startQuery').onkeydown = async event => { if (event.key === 'Enter' && state.startMode === 'manual') { try { await showSearchResults(event.target.value.trim(), 'start'); } catch (error) { status(error.message); } } };

  $('apiKey').value = state.apiKey;
  $('vehicleProfile').value = state.profile;
  $('autoFollow').checked = state.autoFollow;
})();

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KEY = 'routerijder-settings';
  const saved = JSON.parse(localStorage.getItem(KEY) || '{}');

  const state = {
    apiKey: saved.apiKey || '',
    profile: saved.profile || 'car',
    autoFollow: saved.autoFollow !== false,
    keepAwake: saved.keepAwake !== false,
    wakeLock: null,
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
    pickingDestination: false,
    navigationActive: false,
    fuelStop: null,
    follow: false,
    simulation: { timer: null, playing: false, distanceKm: 0, speedFactor: 5, lastTime: 0 },
    progressKm: 0,
    offCount: 0,
    lastReroute: 0,
    layoutMode: saved.layoutMode || (window.innerWidth > window.innerHeight ? 'landscape' : 'portrait'),
    rotationFallback: false,
    fuelCandidates: [],
    gpxEditor: { active: false, fileName: 'route', originalCoordinates: [], controlPoints: [], originalControlPoints: [], markers: [] }
  };

  if (!window.maplibregl || !window.turf) {
    alert('De kaart- of routebibliotheek kon niet worden geladen. Vernieuw de pagina.');
    return;
  }

  const status = (text) => { if ($('status')) $('status').textContent = text; };
  const fmtDistance = (m) => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`;
  const fmtDuration = (ms) => {
    const minutes = Math.max(1, Math.round(ms / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} u ${minutes % 60} min` : `${minutes} min`;
  };

  async function requestWakeLock() {
    if (!state.keepAwake || !state.navigationActive || document.visibilityState !== 'visible') return;
    if (!('wakeLock' in navigator)) {
      console.warn('Screen Wake Lock wordt niet ondersteund door deze browser.');
      return;
    }
    try {
      if (state.wakeLock && !state.wakeLock.released) return;
      state.wakeLock = await navigator.wakeLock.request('screen');
      state.wakeLock.addEventListener('release', () => { state.wakeLock = null; });
    } catch (error) {
      console.warn('Scherm wakker houden is niet gelukt:', error);
    }
  }

  async function releaseWakeLock() {
    try {
      if (state.wakeLock && !state.wakeLock.released) await state.wakeLock.release();
    } catch (_) {}
    state.wakeLock = null;
  }

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && state.navigationActive) requestWakeLock();
  });

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
    addRouteLayer('route-casing', '#ffffff', 13, 0.96);
    addRouteLayer('route-traveled', '#94a3b8', 8, 0.78);
    addRouteLayer('route-remaining', '#2563eb', 8, 0.98);
    addRouteLayer('rejoin-casing', '#ffffff', 12, 0.94);
    addRouteLayer('rejoin-route', '#f97316', 7, 0.98);
    state.mapReady = true;
    status('Klaar om te testen');
  });

  function addRouteLayer(id, color, width, opacity) {
    map.addSource(id, { type: 'geojson', data: emptyGeoJson() });
    map.addLayer({
      id,
      type: 'line',
      source: id,
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': color, 'line-width': width, 'line-opacity': opacity }
    });
  }

  function emptyGeoJson() {
    return { type: 'FeatureCollection', features: [] };
  }

  function setLineSource(id, coordinates) {
    const source = map.getSource(id);
    if (source) source.setData(coordinates && coordinates.length >= 2 ? turf.lineString(coordinates) : emptyGeoJson());
  }

  function updateRouteProgress(progressKm) {
    if (!state.route || state.route.coordinates.length < 2) return;
    const line = turf.lineString(state.route.coordinates);
    const totalKm = turf.length(line, { units: 'kilometers' });
    const clamped = Math.max(0, Math.min(totalKm, Number(progressKm) || 0));

    let traveled = [];
    let remaining = state.route.coordinates;
    try {
      if (clamped > 0.001) traveled = turf.lineSliceAlong(line, 0, clamped, { units: 'kilometers' }).geometry.coordinates;
      if (clamped < totalKm - 0.001) remaining = turf.lineSliceAlong(line, clamped, totalKm, { units: 'kilometers' }).geometry.coordinates;
      else remaining = [];
    } catch (_) {
      traveled = [];
      remaining = state.route.coordinates;
    }

    setLineSource('route-casing', state.route.coordinates);
    setLineSource('route-traveled', traveled);
    setLineSource('route-remaining', remaining);
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

  function stopSimulationTimer() {
    state.simulation.playing = false;
    if (state.simulation.timer) cancelAnimationFrame(state.simulation.timer);
    state.simulation.timer = null;
    if ($('simPlay')) {
      $('simPlay').textContent = '▶ Simuleer';
      $('simPlay').classList.remove('active');
    }
  }

  function drawRoute(data, mode) {
    stopSimulationTimer();
    state.route = data;
    document.body.classList.add('route-ready');
    state.original = data.coordinates.slice();
    state.mode = mode;
    state.progressKm = 0;
    state.simulation.distanceKm = 0;
    state.follow = false;
    updateRouteProgress(0);
    setLineSource('rejoin-casing', mode === 'rejoin' ? data.coordinates : []);
    setLineSource('rejoin-route', mode === 'rejoin' ? data.coordinates : []);
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

  function requestMapPoint(target) {
    if (target === 'start' && state.startMode !== 'manual') toggleStartMode();
    state.pickingStart = target === 'start';
    state.pickingDestination = target === 'destination';
    map.getCanvas().classList.add('map-pick-mode');
    status(target === 'start' ? 'Klik op de kaart om het vertrekpunt te kiezen' : 'Klik op de kaart om de bestemming te kiezen');
  }

  function requestMapStart() {
    requestMapPoint('start');
  }

  map.on('click', (event) => {
    if (!state.pickingStart && !state.pickingDestination) return;
    const target = state.pickingStart ? 'start' : 'destination';
    state.pickingStart = false;
    state.pickingDestination = false;
    map.getCanvas().classList.remove('map-pick-mode');
    const point = [event.lngLat.lng, event.lngLat.lat];
    const label = `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
    if (target === 'start') {
      state.startPoint = point;
      state.startLabel = label;
      $('startQuery').value = label;
      setMarker('start', point);
      status('Vertrekpunt op kaart gekozen');
    } else {
      state.destinationPoint = point;
      state.destinationLabel = label;
      $('destinationQuery').value = label;
      setMarker('destination', point);
      status('Bestemming op kaart gekozen; route berekenen…');
      planRoute();
    }
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
        if (state.route) setNavigationMode(true);
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
    updateRouteProgress(state.progressKm);
    $('devOffRoute').textContent = `${Math.round(offKm * 1000)} m`;

    const totalKm = turf.length(line, { units: 'kilometers' });
    const percentage = totalKm ? Math.min(100, Math.round(location / totalKm * 100)) : 0;
    $('devProgress').textContent = `${percentage}%`;
    const remainingKm = Math.max(0, totalKm - location);
    const avgKmh = state.profile === 'bike' ? 22 : state.profile === 'foot' ? 5 : 70;
    $('routeMeta').textContent = `${remainingKm.toFixed(1)} km resterend · ongeveer ${fmtDuration(remainingKm / avgKmh * 3600000)}`;

    updateInstructionByIndex(Number(snap.properties.index || 0));

    if (state.autoFollow && (state.follow || speedMps > 1.2 || state.simulation.playing)) {
      state.follow = true;
      const derivedHeading = Number.isFinite(heading) ? heading : bearingAlongRoute(line, location);
      map.easeTo({ center: point, zoom: 15.8, pitch: 55, bearing: derivedHeading, offset: state.layoutMode === 'landscape' ? [-40, 160] : [0, 175], padding: { top: 18, bottom: 18, left: 18, right: 18 }, duration: 350 });
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

  function cumulativeRouteKm() {
    const coords = state.route?.coordinates || [];
    const values = [0];
    for (let i = 1; i < coords.length; i += 1) {
      values.push(values[i - 1] + turf.distance(turf.point(coords[i - 1]), turf.point(coords[i]), { units: 'kilometers' }));
    }
    return values;
  }

  function translateInstruction(text) {
    let value = String(text || 'Volg de route');
    const replacements = [
      [/\band take\b/gi, 'en neem'], [/\btoward\b/gi, 'richting'], [/\bkeep left\b/gi, 'houd links aan'],
      [/\bkeep right\b/gi, 'houd rechts aan'], [/\bturn left\b/gi, 'sla linksaf'], [/\bturn right\b/gi, 'sla rechtsaf'],
      [/\bcontinue straight\b/gi, 'ga rechtdoor'], [/\bcontinue\b/gi, 'ga verder'], [/\bat the roundabout\b/gi, 'op de rotonde'],
      [/\btake the (\d+)(?:st|nd|rd|th) exit\b/gi, 'neem de $1e afslag'], [/\bmake a u-turn\b/gi, 'keer om'],
      [/\barrive at destination\b/gi, 'bestemming bereikt']
    ];
    replacements.forEach(([pattern, replacement]) => { value = value.replace(pattern, replacement); });
    return value.charAt(0).toUpperCase() + value.slice(1);
  }

  function updateInstructionByIndex(index) {
    const instructions = state.route.instructions || [];
    const next = instructions.find(item => item.interval && Number(item.interval[0]) > index + 1)
      || instructions.find(item => item.interval && Number(item.interval[0]) >= index)
      || instructions[instructions.length - 1];
    if (!next) {
      $('devInstruction').textContent = state.mode === 'gpx' ? 'Volg GPX' : '-';
      $('instruction').textContent = state.mode === 'gpx' ? 'Volg de GPX-route' : 'Volg de route';
      return;
    }
    const cumulative = cumulativeRouteKm();
    const targetIndex = Math.min(cumulative.length - 1, Number(next.interval?.[0] || index));
    const distanceM = Math.max(0, ((cumulative[targetIndex] || 0) - state.progressKm) * 1000);
    const text = translateInstruction(next.text);
    $('instruction').textContent = `${fmtDistance(distanceM)} · ${text}`;
    $('devInstruction').textContent = text;
    $('maneuverIcon').textContent = maneuverSymbol(next.sign);
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
    setLineSource('rejoin-casing', routes[0].route.coordinates);
    setLineSource('rejoin-route', routes[0].route.coordinates);
    status(`Aansluitroute: ${fmtDistance(routes[0].route.distance)}`);
  }

  function parseGpx(xml) {
    const trackNodes = Array.from(xml.querySelectorAll('trkpt'));
    const routeNodes = Array.from(xml.querySelectorAll('rtept'));
    const waypointNodes = Array.from(xml.querySelectorAll('wpt'));
    const nodes = trackNodes.length ? trackNodes : routeNodes;
    const coordinates = nodes.map(n => [Number(n.getAttribute('lon')), Number(n.getAttribute('lat'))]).filter(([lng,lat]) => Number.isFinite(lng) && Number.isFinite(lat));
    const explicitStops = (routeNodes.length ? routeNodes : waypointNodes).map(n => ({
      point: [Number(n.getAttribute('lon')), Number(n.getAttribute('lat'))],
      name: n.querySelector('name')?.textContent?.trim() || ''
    })).filter(item => item.point.every(Number.isFinite));
    return { coordinates, explicitStops };
  }

  function makeEditorControlPoints(coordinates, explicitStops) {
    if (explicitStops.length >= 2) return explicitStops.map((item, index) => ({ point: [...item.point], name: item.name || `Tussenpunt ${index + 1}` }));
    const line = turf.lineString(coordinates);
    const total = turf.length(line, { units: 'kilometers' });
    const desired = Math.max(2, Math.min(12, Math.ceil(total / 12) + 1));
    const result = [];
    for (let i = 0; i < desired; i += 1) {
      const km = desired === 1 ? 0 : total * i / (desired - 1);
      result.push({ point: turf.along(line, km, { units: 'kilometers' }).geometry.coordinates, name: i === 0 ? 'Start' : i === desired - 1 ? 'Einde' : `Tussenpunt ${i}` });
    }
    return result;
  }

  function clearGpxEditMarkers() {
    state.gpxEditor.markers.forEach(marker => marker.remove());
    state.gpxEditor.markers = [];
  }

  function renderGpxEditor() {
    clearGpxEditMarkers();
    const list = $('gpxPointList');
    if (!list) return;
    list.innerHTML = '';
    state.gpxEditor.controlPoints.forEach((item, index) => {
      const el = document.createElement('div');
      el.className = 'gpx-edit-marker';
      el.textContent = String(index + 1);
      const marker = new maplibregl.Marker({ element: el, draggable: true }).setLngLat(item.point).addTo(map);
      marker.on('dragend', async () => {
        const p = marker.getLngLat();
        item.point = [p.lng, p.lat];
        await rebuildGpxFromControlPoints();
        renderGpxEditor();
      });
      state.gpxEditor.markers.push(marker);

      const row = document.createElement('div');
      row.className = 'gpx-point-row';
      row.innerHTML = `<span class="gpx-point-number">${index + 1}</span><span class="gpx-point-coordinates"><strong>${item.name}</strong><br>${item.point[1].toFixed(5)}, ${item.point[0].toFixed(5)}</span>`;
      const remove = document.createElement('button');
      remove.className = 'gpx-point-remove';
      remove.textContent = 'Verwijder';
      remove.disabled = state.gpxEditor.controlPoints.length <= 2;
      remove.addEventListener('click', async () => {
        if (state.gpxEditor.controlPoints.length <= 2) return status('Een route moet minimaal een start- en eindpunt houden.');
        state.gpxEditor.controlPoints.splice(index, 1);
        await rebuildGpxFromControlPoints();
        renderGpxEditor();
      });
      row.appendChild(remove);
      list.appendChild(row);
    });
  }

  async function rebuildGpxFromControlPoints() {
    const points = state.gpxEditor.controlPoints.map(item => item.point);
    try {
      status('GPX-route opnieuw berekenen…');
      let data;
      if (state.apiKey && points.length >= 2) data = await calculateRoute(points);
      else {
        const coordinates = points.map(point => [...point]);
        data = { coordinates, distance: turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000, time: 0, instructions: [] };
      }
      drawRoute(data, 'gpx');
      $('editGpx').hidden = false;
      status('GPX bijgewerkt');
    } catch (error) { status(`Aanpassen mislukt: ${error.message}`); }
  }

  function openGpxEditor() {
    if (state.mode !== 'gpx' || !state.gpxEditor.controlPoints.length) return status('Laad eerst een GPX-bestand.');
    pauseSimulation();
    setNavigationMode(false);
    state.gpxEditor.active = true;
    document.body.classList.add('gpx-editing');
    $('gpxEditorSheet').hidden = false;
    $('backdrop').hidden = false;
    renderGpxEditor();
    showOverview();
    status('Versleep een genummerd punt of verwijder een tussenpunt.');
  }

  function closeGpxEditor() {
    state.gpxEditor.active = false;
    document.body.classList.remove('gpx-editing');
    clearGpxEditMarkers();
    if ($('gpxEditorSheet')) $('gpxEditorSheet').hidden = true;
    if ($('settingsSheet')?.hidden && $('fuelSheet')?.hidden) $('backdrop').hidden = true;
    showOverview();
  }

  async function restoreGpx() {
    state.gpxEditor.controlPoints = state.gpxEditor.originalControlPoints.map(item => ({ point: [...item.point], name: item.name }));
    const coordinates = state.gpxEditor.originalCoordinates.map(point => [...point]);
    const distance = turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000;
    drawRoute({ coordinates, distance, time: 0, instructions: [] }, 'gpx');
    renderGpxEditor();
    status('Oorspronkelijke GPX hersteld');
  }

  function escapeXml(value) {
    return String(value || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  }

  function exportGpx() {
    if (!state.route?.coordinates?.length) return status('Er is geen GPX-route om te exporteren.');
    const routePoints = state.gpxEditor.controlPoints.map(item => `    <rtept lat="${item.point[1].toFixed(7)}" lon="${item.point[0].toFixed(7)}"><name>${escapeXml(item.name)}</name></rtept>`).join('\n');
    const trackPoints = state.route.coordinates.map(point => `      <trkpt lat="${point[1].toFixed(7)}" lon="${point[0].toFixed(7)}"></trkpt>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="joepjoepGO v15" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml(state.gpxEditor.fileName)} bewerkt</name></metadata>\n  <rte>\n    <name>${escapeXml(state.gpxEditor.fileName)} bewerkt</name>\n${routePoints}\n  </rte>\n  <trk><name>${escapeXml(state.gpxEditor.fileName)} bewerkt</name><trkseg>\n${trackPoints}\n    </trkseg></trk>\n</gpx>`;
    const blob = new Blob([xml], { type: 'application/gpx+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${state.gpxEditor.fileName.replace(/\.gpx$/i,'') || 'route'}-bewerkt.gpx`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    status('Nieuwe GPX geëxporteerd');
  }

  async function loadGpx(event) {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Dit GPX-bestand kan niet worden gelezen.');
      const parsed = parseGpx(xml);
      const coordinates = parsed.coordinates;
      if (coordinates.length < 2) throw new Error('Geen bruikbare GPX-track gevonden.');
      const controls = makeEditorControlPoints(coordinates, parsed.explicitStops);
      state.gpxEditor.fileName = file.name.replace(/\.gpx$/i, '') || 'route';
      state.gpxEditor.originalCoordinates = coordinates.map(point => [...point]);
      state.gpxEditor.controlPoints = controls.map(item => ({ point: [...item.point], name: item.name }));
      state.gpxEditor.originalControlPoints = controls.map(item => ({ point: [...item.point], name: item.name }));
      const distance = turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000;
      state.startMode = 'manual';
      $('startMode').textContent = 'Hand';
      $('startMode').classList.add('manual');
      $('startQuery').disabled = false;
      state.startPoint = coordinates[0];
      state.destinationPoint = coordinates[coordinates.length - 1];
      $('startQuery').value = 'Start GPX';
      $('destinationQuery').value = 'Einde GPX';
      setMarker('start', coordinates[0]);
      setMarker('destination', coordinates[coordinates.length - 1]);
      drawRoute({ coordinates, distance, time: 0, instructions: [] }, 'gpx');
      $('editGpx').hidden = false;
      status(`GPX geladen: ${fmtDistance(distance)}. Kies Bewerk GPX om tussenpunten aan te passen.`);
    } catch (error) { status(error.message); }
    finally { event.target.value = ''; }
  }

  function physicalOrientation() {
    return window.innerWidth > window.innerHeight ? 'landscape' : 'portrait';
  }

  function applyLayoutMode() {
    const physical = physicalOrientation();
    const rotateClockwise = state.layoutMode === 'landscape' && physical === 'portrait';
    const rotateCounterClockwise = state.layoutMode === 'portrait' && physical === 'landscape';

    document.body.classList.toggle('layout-portrait', state.layoutMode === 'portrait');
    document.body.classList.toggle('layout-landscape', state.layoutMode === 'landscape');
    document.body.classList.toggle('force-rotate-cw', rotateClockwise);
    document.body.classList.toggle('force-rotate-ccw', rotateCounterClockwise);
    state.rotationFallback = rotateClockwise || rotateCounterClockwise;

    const button = $('layoutToggle');
    if (button) {
      button.textContent = state.layoutMode === 'portrait' ? '↻' : '↺';
      button.title = state.layoutMode === 'portrait' ? 'Draai naar liggende navigatie' : 'Draai naar staande navigatie';
      button.setAttribute('aria-label', button.title);
    }
    window.setTimeout(() => map.resize(), 80);
  }

  async function tryNativeOrientationLock(mode) {
    try {
      if (!screen.orientation || typeof screen.orientation.lock !== 'function') return false;
      await screen.orientation.lock(mode);
      return true;
    } catch (_) {
      return false;
    }
  }

  async function toggleLayoutMode() {
    state.layoutMode = state.layoutMode === 'portrait' ? 'landscape' : 'portrait';
    localStorage.setItem(KEY, JSON.stringify({ apiKey: state.apiKey, profile: state.profile, autoFollow: state.autoFollow, keepAwake: state.keepAwake, layoutMode: state.layoutMode }));
    await tryNativeOrientationLock(state.layoutMode);
    applyLayoutMode();
  }

  function setNavigationMode(active) {
    state.navigationActive = active;
    document.body.classList.toggle('navigation-active', active);
    applyLayoutMode();
    if (active) {
      $('developerPanel').hidden = true;
      $('routeActions').hidden = false;
      $('layoutToggle').hidden = false;
      requestWakeLock();
    } else {
      $('routeActions').hidden = true;
      $('layoutToggle').hidden = true;
      releaseWakeLock();
    }
    requestAnimationFrame(() => map.resize());
  }

  function closeFuelSheet() {
    const sheet = $('fuelSheet');
    if (sheet) sheet.hidden = true;
    if ($('backdrop') && $('settingsSheet')?.hidden) $('backdrop').hidden = true;
  }

  function renderFuelChoices(candidates) {
    const box = $('fuelChoices');
    box.innerHTML = '';
    candidates.slice(0, 3).forEach((station, index) => {
      const button = document.createElement('button');
      button.className = 'fuel-choice';
      const routeAhead = Math.max(0, station.ahead - state.progressKm);
      button.innerHTML = `<strong>${index + 1}. ${station.name}</strong><span>${routeAhead.toFixed(1)} km verder op de route · ${Math.round(station.side * 1000)} m ernaast</span><span class="fuel-add">Toevoegen ›</span>`;
      button.addEventListener('click', () => chooseFuelStop(station));
      box.appendChild(button);
    });
  }

  async function chooseFuelStop(station) {
    try {
      closeFuelSheet();
      status(`${station.name} als tussenstop toevoegen…`);
      const destination = state.destinationPoint || state.route.coordinates[state.route.coordinates.length - 1];
      const dataRoute = await calculateRoute([state.current, station.point, destination]);
      state.fuelStop = station;
      setMarker('destination', destination);
      drawRoute(dataRoute, 'address');
      setNavigationMode(true);
      state.follow = true;
      status(`${station.name} is als tussenstop toegevoegd.`);
    } catch (error) { status(error.message); }
  }

  async function addNearestFuelStop() {
    try {
      if (!state.route || !state.current) throw new Error('Start eerst de navigatie of simulatie.');
      status('Tankstations langs de komende route zoeken…');
      const line = turf.lineString(state.route.coordinates);
      const total = turf.length(line, { units: 'kilometers' });
      const searchStart = Math.min(total, state.progressKm + 0.5);
      const searchEnd = Math.min(total, state.progressKm + 30);
      const sampleDistances = [];
      for (let km = searchStart; km <= searchEnd; km += 6) sampleDistances.push(km);
      if (!sampleDistances.length) sampleDistances.push(searchStart);
      const aroundParts = sampleDistances.map(km => {
        const p = turf.along(line, km, { units: 'kilometers' }).geometry.coordinates;
        return `node["amenity"="fuel"](around:6500,${p[1]},${p[0]});way["amenity"="fuel"](around:6500,${p[1]},${p[0]});`;
      }).join('');
      const query = `[out:json][timeout:25];(${aroundParts});out center tags;`;
      const endpoints = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
      let data = null;
      for (const endpoint of endpoints) {
        try {
          const response = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' }, body: `data=${encodeURIComponent(query)}` });
          if (response.ok) { data = await response.json(); break; }
        } catch (_) {}
      }
      if (!data) throw new Error('Tankstations zoeken is tijdelijk niet beschikbaar.');
      const dedupe = new Map();
      (data.elements || []).forEach(item => {
        const point = item.type === 'node' ? [item.lon, item.lat] : [item.center?.lon, item.center?.lat];
        if (!point || !point.every(Number.isFinite)) return;
        const key = `${point[0].toFixed(5)},${point[1].toFixed(5)}`;
        dedupe.set(key, { point, name: item.tags?.name || item.tags?.brand || 'Tankstation' });
      });
      const candidates = [...dedupe.values()].map(item => {
        const snap = turf.nearestPointOnLine(line, turf.point(item.point), { units: 'kilometers' });
        const ahead = Number(snap.properties.location || 0);
        const side = turf.distance(turf.point(item.point), snap, { units: 'kilometers' });
        return { ...item, ahead, side, score: side * 10 + Math.max(0, ahead - state.progressKm) * 0.04 };
      }).filter(item => item.ahead > state.progressKm + .2 && item.ahead <= searchEnd + 3 && item.side <= 4)
        .sort((a,b) => a.score - b.score)
        .slice(0, 3);
      if (!candidates.length) throw new Error('Geen tankstation langs het komende deel van de route gevonden.');
      state.fuelCandidates = candidates;
      renderFuelChoices(candidates);
      $('fuelSheet').hidden = false;
      $('backdrop').hidden = false;
      status('Kies een tankstation');
    } catch (error) { status(error.message); }
  }

  function stopNavigation() {
    pauseSimulation();
    setNavigationMode(false);
    state.follow = false;
    showOverview();
    status('Navigatie gepauzeerd');
  }

  function toggleSimulation() {
    if (!state.route || state.route.coordinates.length < 2) return status('Bereken of laad eerst een route.');
    if (state.simulation.playing) return pauseSimulation();

    const line = turf.lineString(state.route.coordinates);
    const totalKm = turf.length(line, { units: 'kilometers' });
    if (!Number.isFinite(state.simulation.distanceKm) || state.simulation.distanceKm < 0 || state.simulation.distanceKm >= totalKm - 0.001) {
      state.simulation.distanceKm = 0;
    }
    state.progressKm = state.simulation.distanceKm;
    updateRouteProgress(state.progressKm);

    const startPosition = turf.along(line, state.simulation.distanceKm, { units: 'kilometers' }).geometry.coordinates;
    const startHeading = bearingAlongRoute(line, state.simulation.distanceKm);
    state.follow = true;
    setNavigationMode(true);
    setCurrentPosition(startPosition, { source: 'Simulatie', speedMps: 0, heading: startHeading });

    state.simulation.playing = true;
    state.simulation.lastTime = performance.now();
    $('simPlay').textContent = '⏸ Pauze';
    $('simPlay').classList.add('active');
    $('devSource').textContent = 'Simulatie';
    status(state.simulation.distanceKm > 0 ? 'Routesimulatie hervat' : 'Routesimulatie gestart');
    state.simulation.timer = requestAnimationFrame(simulationFrame);
  }

  function pauseSimulation() {
    stopSimulationTimer();
    status('Simulatie gepauzeerd');
  }

  function resetSimulation() {
    pauseSimulation();
    state.simulation.distanceKm = 0;
    state.progressKm = 0;
    updateRouteProgress(0);
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
    document.body.classList.remove('route-ready');
    setNavigationMode(false);
    state.original = [];
    clearGpxEditMarkers();
    state.gpxEditor = { active: false, fileName: 'route', originalCoordinates: [], controlPoints: [], originalControlPoints: [], markers: [] };
    if ($('editGpx')) $('editGpx').hidden = true;
    state.destinationPoint = null;
    state.mode = 'idle';
    state.progressKm = 0;
    state.simulation.distanceKm = 0;
    ['route-casing','route-traveled','route-remaining','rejoin-casing','rejoin-route'].forEach(id => setLineSource(id, []));
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

  function openSettings() { $('apiKey').value = state.apiKey; $('vehicleProfile').value = state.profile; $('autoFollow').checked = state.autoFollow; $('keepAwake').checked = state.keepAwake; $('settingsSheet').hidden = false; $('backdrop').hidden = false; }
  function closeSettings() { $('settingsSheet').hidden = true; $('backdrop').hidden = true; }
  function saveSettings() {
    state.apiKey = $('apiKey').value.trim();
    state.profile = $('vehicleProfile').value;
    state.autoFollow = $('autoFollow').checked;
    state.keepAwake = $('keepAwake').checked;
    localStorage.setItem(KEY, JSON.stringify({ apiKey: state.apiKey, profile: state.profile, autoFollow: state.autoFollow, keepAwake: state.keepAwake, layoutMode: state.layoutMode }));
    if (state.navigationActive) { if (state.keepAwake) requestWakeLock(); else releaseWakeLock(); }
    closeSettings();
    status('Instellingen opgeslagen');
  }

  function bind(id, eventName, handler) {
    const element = $(id);
    if (!element) { console.warn(`joepjoepGO v15: element #${id} ontbreekt`); return; }
    element.addEventListener(eventName, handler);
  }

  bind('startMode', 'click', toggleStartMode);
  bind('useMapStart', 'click', requestMapStart);
  bind('useMapDestination', 'click', () => requestMapPoint('destination'));
  bind('planRoute', 'click', planRoute);
  bind('gps', 'click', toggleGps);
  bind('gpx', 'click', () => $('gpxFile')?.click());
  bind('gpxFile', 'change', loadGpx);
  bind('editGpx', 'click', openGpxEditor);
  bind('closeGpxEditor', 'click', closeGpxEditor);
  bind('restoreGpx', 'click', restoreGpx);
  bind('exportGpx', 'click', exportGpx);
  bind('overview', 'click', showOverview);
  bind('clear', 'click', clearRoute);
  bind('fuel', 'click', addNearestFuelStop);
  bind('layoutToggle', 'click', toggleLayoutMode);
  bind('closeFuelSheet', 'click', closeFuelSheet);
  bind('stopNavigation', 'click', stopNavigation);
  bind('developer', 'click', () => { const panel = $('developerPanel'); if (panel) panel.hidden = !panel.hidden; });
  bind('closeDeveloper', 'click', () => { const panel = $('developerPanel'); if (panel) panel.hidden = true; });
  bind('simPlay', 'click', toggleSimulation);
  bind('simReset', 'click', resetSimulation);
  bind('simSpeed', 'change', event => { state.simulation.speedFactor = Number(event.target.value); });
  bind('settings', 'click', openSettings);
  bind('closeSettings', 'click', closeSettings);
  bind('backdrop', 'click', () => { closeSettings(); closeFuelSheet(); closeGpxEditor(); });
  bind('saveSettings', 'click', saveSettings);
  bind('destinationQuery', 'input', () => { state.destinationPoint = null; });
  bind('startQuery', 'input', () => { state.startPoint = null; });
  bind('destinationQuery', 'keydown', async event => { if (event.key === 'Enter') { try { await showSearchResults(event.target.value.trim(), 'destination'); } catch (error) { status(error.message); } } });
  bind('startQuery', 'keydown', async event => { if (event.key === 'Enter' && state.startMode === 'manual') { try { await showSearchResults(event.target.value.trim(), 'start'); } catch (error) { status(error.message); } } });

  window.addEventListener('resize', () => { if (state.navigationActive) applyLayoutMode(); });
  applyLayoutMode();
  if ($('apiKey')) $('apiKey').value = state.apiKey;
  $('vehicleProfile').value = state.profile;
  $('autoFollow').checked = state.autoFollow;
})();

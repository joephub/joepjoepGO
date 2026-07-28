(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    apiKey: localStorage.getItem('graphhopper-key') || '',
    route: null,
    original: [],
    mode: 'idle',
    current: null,
    progressKm: 0,
    offCount: 0,
    lastReroute: 0,
    watch: null,
    marker: null,
    mapReady: false
  };

  const status = (text) => { $('status').textContent = text; };
  const fmt = (m) => m >= 1000 ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km` : `${Math.max(10, Math.round(m / 10) * 10)} m`;

  function ensureLibraries() {
    if (!window.maplibregl) throw new Error('De kaartbibliotheek kon niet worden geladen. Vernieuw de pagina.');
    if (!window.turf) throw new Error('De routebibliotheek kon niet worden geladen. Vernieuw de pagina.');
  }

  ensureLibraries();
  $('apiKey').value = state.apiKey;

  const style = {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap-bijdragers'
      }
    },
    layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
  };

  const map = new maplibregl.Map({
    container: 'map',
    style,
    center: [5.3, 52.1],
    zoom: 7
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

  map.on('load', () => {
    for (const id of ['main-route', 'rejoin-route']) {
      map.addSource(id, { type: 'geojson', data: turf.lineString([]) });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        paint: {
          'line-color': id === 'main-route' ? '#2563eb' : '#f97316',
          'line-width': id === 'main-route' ? 7 : 6,
          'line-opacity': 0.9
        }
      });
    }
    state.mapReady = true;
    status('Klaar om te rijden');
  });

  map.on('error', (event) => {
    console.error('Kaartfout:', event.error || event);
  });

  function ensureKey() {
    if (!state.apiKey.trim()) throw new Error('Vul eerst je GraphHopper API-key in via het tandwiel.');
  }

  async function geocode(query) {
    ensureKey();
    const url = new URL('https://graphhopper.com/api/1/geocode');
    url.searchParams.set('q', query);
    url.searchParams.set('locale', 'nl');
    url.searchParams.set('limit', '5');
    url.searchParams.set('key', state.apiKey);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Adres zoeken mislukt (${response.status}).`);
    const data = await response.json();
    return (data.hits || []).map((hit) => ({
      label: [hit.name, hit.street, hit.housenumber, hit.city, hit.country].filter(Boolean).join(', '),
      point: [hit.point.lng, hit.point.lat]
    }));
  }

  async function calculateRoute(points) {
    ensureKey();
    const url = new URL('https://graphhopper.com/api/1/route');
    points.forEach(([lng, lat]) => url.searchParams.append('point', `${lat},${lng}`));
    const params = {
      profile: 'car', locale: 'nl', instructions: 'true',
      points_encoded: 'false', calc_points: 'true', key: state.apiKey
    };
    Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Routeberekening mislukt (${response.status}).`);
    const data = await response.json();
    const path = data.paths && data.paths[0];
    if (!path) throw new Error('Geen route gevonden.');
    return {
      coordinates: path.points.coordinates,
      distance: path.distance,
      time: path.time,
      instructions: path.instructions || []
    };
  }

  function draw(data, mode) {
    state.route = data;
    state.mode = mode;
    const sourceId = mode === 'rejoin' ? 'rejoin-route' : 'main-route';
    const source = map.getSource(sourceId);
    if (source) source.setData(turf.lineString(data.coordinates));

    if (data.coordinates.length) {
      const bounds = data.coordinates.reduce(
        (result, coordinate) => result.extend(coordinate),
        new maplibregl.LngLatBounds(data.coordinates[0], data.coordinates[0])
      );
      map.fitBounds(bounds, { padding: 70, duration: 700 });
    }

    $('mode').textContent = mode === 'rejoin' ? 'Tijdelijke aansluitroute' : mode === 'gpx' ? 'GPX-navigatie' : 'Adresnavigatie';
    $('instruction').textContent = (data.instructions && data.instructions[0] && data.instructions[0].text) || (mode === 'gpx' ? 'Volg de blauwe GPX-route' : 'Volg de route');
  }

  $('settings').addEventListener('click', () => {
    $('sheet').hidden = false;
    $('backdrop').hidden = false;
  });

  $('backdrop').addEventListener('click', () => {
    $('sheet').hidden = true;
    $('backdrop').hidden = true;
  });

  $('saveSettings').addEventListener('click', () => {
    state.apiKey = $('apiKey').value.trim();
    localStorage.setItem('graphhopper-key', state.apiKey);
    $('sheet').hidden = true;
    $('backdrop').hidden = true;
    status(state.apiKey ? 'Instellingen opgeslagen' : 'API-key verwijderd');
  });

  $('search').addEventListener('click', async () => {
    try {
      const query = $('query').value.trim();
      if (!query) throw new Error('Vul eerst een adres in.');
      status('Adres zoeken…');
      const hits = await geocode(query);
      $('results').innerHTML = '';
      if (!hits.length) throw new Error('Geen adressen gevonden.');

      for (const hit of hits) {
        const button = document.createElement('button');
        button.className = 'result';
        button.textContent = hit.label;
        button.addEventListener('click', async () => {
          try {
            $('results').hidden = true;
            $('query').value = hit.label;
            if (!state.current) throw new Error('Start eerst GPS en wacht op je locatie.');
            status('Route berekenen…');
            const data = await calculateRoute([state.current, hit.point]);
            state.original = data.coordinates;
            state.progressKm = 0;
            draw(data, 'address');
            status(`Route: ${fmt(data.distance)}`);
          } catch (error) {
            status(error.message);
          }
        });
        $('results').appendChild(button);
      }
      $('results').hidden = false;
      status('Kies een bestemming');
    } catch (error) {
      status(error.message);
    }
  });

  $('query').addEventListener('keydown', (event) => {
    if (event.key === 'Enter') $('search').click();
  });

  $('gpx').addEventListener('click', () => $('file').click());

  function extractGpxCoordinates(xml) {
    const trackPoints = Array.from(xml.querySelectorAll('trkpt'));
    const routePoints = Array.from(xml.querySelectorAll('rtept'));
    const points = trackPoints.length ? trackPoints : routePoints;
    return points.map((node) => [Number(node.getAttribute('lon')), Number(node.getAttribute('lat'))])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  }

  $('file').addEventListener('change', async (event) => {
    try {
      const file = event.target.files && event.target.files[0];
      if (!file) return;
      status('GPX laden…');
      const xml = new DOMParser().parseFromString(await file.text(), 'application/xml');
      if (xml.querySelector('parsererror')) throw new Error('Dit GPX-bestand kan niet worden gelezen.');
      const coordinates = extractGpxCoordinates(xml);
      if (coordinates.length < 2) throw new Error('Geen bruikbare track of route gevonden.');
      state.original = coordinates;
      state.progressKm = 0;
      const data = {
        coordinates,
        distance: turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000,
        time: 0,
        instructions: []
      };
      draw(data, 'gpx');
      status(`GPX geladen: ${fmt(data.distance)}`);
    } catch (error) {
      status(error.message);
    } finally {
      event.target.value = '';
    }
  });

  $('clear').addEventListener('click', () => {
    state.original = [];
    state.route = null;
    state.mode = 'idle';
    for (const id of ['main-route', 'rejoin-route']) {
      const source = map.getSource(id);
      if (source) source.setData(turf.lineString([]));
    }
    $('instruction').textContent = 'Geen actieve route';
    $('mode').textContent = 'RouteRijder';
    status('Route gewist');
  });

  function updateInstruction(position) {
    if (!state.route || !state.route.coordinates.length || !state.route.instructions.length) return;
    const snap = turf.nearestPointOnLine(turf.lineString(state.route.coordinates), turf.point(position), { units: 'kilometers' });
    const index = Number(snap.properties.index || 0);
    const instruction = state.route.instructions.find((item) => index >= item.interval[0] && index <= item.interval[1]) ||
      state.route.instructions.find((item) => item.interval[0] >= index);
    if (instruction) $('instruction').textContent = `${fmt(instruction.distance)} · ${instruction.text}`;
  }

  async function smartRejoin(position) {
    if (state.original.length < 2 || !state.apiKey || Date.now() - state.lastReroute < 25000) return;
    state.lastReroute = Date.now();
    status('Slim aansluitpunt zoeken…');
    const line = turf.lineString(state.original);
    const total = turf.length(line, { units: 'kilometers' });
    const kms = [0.5, 1, 2, 4]
      .map((value) => Math.min(total, state.progressKm + value))
      .filter((value, index, array) => value > state.progressKm + 0.1 && array.indexOf(value) === index);
    const scored = [];

    for (const km of kms) {
      try {
        const target = turf.along(line, km, { units: 'kilometers' }).geometry.coordinates;
        const data = await calculateRoute([position, target]);
        scored.push({ score: data.distance + km * 35, data, km });
      } catch (error) {
        console.warn('Aansluitpunt overgeslagen:', error);
      }
    }

    scored.sort((a, b) => a.score - b.score);
    if (!scored[0]) {
      status('Geen geschikte aansluiting gevonden');
      return;
    }
    state.progressKm = scored[0].km;
    draw(scored[0].data, 'rejoin');
    status(`Nieuwe aansluiting over ${fmt(scored[0].data.distance)}`);
  }

  function onPosition(position) {
    const pos = [position.coords.longitude, position.coords.latitude];
    state.current = pos;
    if (!state.marker) {
      state.marker = new maplibregl.Marker({ color: '#16a34a' }).setLngLat(pos).addTo(map);
    } else {
      state.marker.setLngLat(pos);
    }
    map.easeTo({
      center: pos,
      zoom: Math.max(map.getZoom(), 15),
      bearing: Number.isFinite(position.coords.heading) ? position.coords.heading : map.getBearing(),
      pitch: 45,
      duration: 700
    });
    updateInstruction(pos);

    if (state.original.length > 1 && (state.mode === 'gpx' || state.mode === 'address')) {
      const line = turf.lineString(state.original);
      const snap = turf.nearestPointOnLine(line, turf.point(pos), { units: 'kilometers' });
      const off = turf.distance(turf.point(pos), snap, { units: 'kilometers' });
      const location = Number(snap.properties.location || 0);
      state.progressKm = Math.max(state.progressKm, location);
      state.offCount = off > 0.06 ? state.offCount + 1 : 0;
      if (state.offCount >= 3) {
        state.offCount = 0;
        smartRejoin(pos);
      }
    }
  }

  $('gps').addEventListener('click', async () => {
    if (state.watch !== null) {
      navigator.geolocation.clearWatch(state.watch);
      state.watch = null;
      $('gps').classList.remove('active');
      $('gps').textContent = 'Start GPS';
      status('GPS gepauzeerd');
      return;
    }
    if (!navigator.geolocation) {
      status('GPS wordt niet ondersteund.');
      return;
    }
    try { await navigator.wakeLock?.request('screen'); } catch (error) { console.warn('Wake lock niet beschikbaar:', error); }
    state.watch = navigator.geolocation.watchPosition(
      onPosition,
      (error) => status(`GPS-fout: ${error.message}`),
      { enableHighAccuracy: true, maximumAge: 1000, timeout: 15000 }
    );
    $('gps').classList.add('active');
    $('gps').textContent = 'GPS aan';
    status('GPS actief, locatie zoeken…');
  });
})();

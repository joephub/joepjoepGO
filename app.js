(function () {
  'use strict';

  const APP_NAME = 'joepjoepGO';
  const APP_VERSION = '28';
  const $ = (id) => document.getElementById(id);
  const KEY = 'joepjoepgo-settings-v1';
  const LEGACY_KEY = 'routerijder-settings';

  function readSavedSettings() {
    try {
      return JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(LEGACY_KEY) || '{}');
    } catch (_) {
      return {};
    }
  }

  const saved = readSavedSettings();
  const state = {
    apiKey: saved.apiKey || '',
    profile: saved.profile || 'car',
    autoFollow: saved.autoFollow !== false,
    keepAwake: saved.keepAwake !== false,
    avatar: saved.avatar || 'motor',
    customAvatar: saved.customAvatar || '',
    wakeLock: null,
    entryMode: null,
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
    gpsStatus: 'idle',
    gpsError: '',
    gpsLastFixAt: 0,
    gpsWatchdog: null,
    marker: null,
    startMarker: null,
    destinationMarker: null,
    mapReady: false,
    pickingStart: false,
    pickingDestination: false,
    navigationActive: false,
    navigationPaused: false,
    navigationSource: null,
    pendingNavigationStart: false,
    pendingGpxStartStrategy: null,
    fuelStop: null,
    follow: false,
    simulation: { timer: null, playing: false, distanceKm: 0, speedFactor: 5, lastTime: 0, lastRender: 0 },
    progressKm: 0,
    offCount: 0,
    lastReroute: 0,
    layoutMode: 'portrait',
    orientationStep: 0,
    orientationRequestToken: 0,
    orientationNativeLocked: false,
    fuelCandidates: [],
    fuelLoading: false,
    fuelSearchToken: 0,
    fuelAbortController: null,
    statusTimer: null,
    gpxLoadToken: 0,
    gpxAppendMode: false,
    gpxRoutePreparing: false,
    gpxPrepareProgress: '',
    gpxRoutePrepared: false,
    gpxPreparedMethod: '',
    gpxPrepareWarnings: [],
    gpxBaseRoute: null,
    gpxActiveSegmentIds: [],
    gpxRouteMode: ['hybrid', 'exact'].includes(saved.gpxRouteMode) ? saved.gpxRouteMode : 'hybrid',
    gpxHybridToleranceMeters: [10, 20, 30, 50].includes(Number(saved.gpxHybridToleranceMeters)) ? Number(saved.gpxHybridToleranceMeters) : 30,
    gpxPendingPreparation: null,
    gpxStartAfterPrepare: false,
    gpxStartStrategy: null,
    gpxStartWaiting: false,
    nextManeuver: null,
    gpxDocument: null,
    gpxEditor: { active: false, fileName: 'route', originalCoordinates: [], editCoordinates: [], selectedIndices: new Set(), selectedMarker: null, boxMode: false, addMode: false, boxStart: null, boxElement: null, pointerId: null, history: [] },
    gpxAnalysis: { sourceParts: [], segments: [], active: false, intent: null, selectedIds: new Set(), jumpThresholdMeters: Number(saved.gpxJumpThresholdMeters) >= 0 ? Number(saved.gpxJumpThresholdMeters) : 5000 }
  };

  if (!window.maplibregl || !window.turf) {
    alert('De kaart- of routebibliotheek kon niet worden geladen. Vernieuw de pagina.');
    return;
  }

  function status(text, options = {}) {
    const element = $('status');
    const settings = typeof options === 'number' ? { duration: options } : options;
    const shouldShow = settings.error === true || settings.force === true;
    if (!element) return;
    window.clearTimeout(state.statusTimer);
    if (!text) {
      element.hidden = true;
      element.textContent = '';
      return;
    }
    if (!shouldShow) {
      console.debug(`${APP_NAME}: ${text}`);
      return;
    }
    const duration = Number.isFinite(settings.duration) ? settings.duration : 5200;
    element.classList.toggle('is-error', settings.error === true);
    element.textContent = text;
    element.hidden = false;
    if (duration > 0) state.statusTimer = window.setTimeout(() => { element.hidden = true; }, duration);
  }

  window.addEventListener('error', event => {
    console.error('Onverwachte applicatiefout:', event.error || event.message);
    if (event.message) status(`Onverwachte fout: ${event.message}`, { error: true, duration: 8000 });
  });

  window.addEventListener('unhandledrejection', event => {
    const message = event.reason?.message || String(event.reason || 'Onbekende fout');
    console.error('Onverwachte asynchrone fout:', event.reason);
    status(`Onverwachte fout: ${message}`, { error: true, duration: 8000 });
  });

  const fmtDistance = (m) => m >= 1000
    ? `${(m / 1000).toFixed(m >= 10000 ? 0 : 1)} km`
    : `${Math.max(10, Math.round(m / 10) * 10)} m`;

  const fmtDuration = (ms) => {
    if (!Number.isFinite(ms) || ms <= 0) return '-';
    const minutes = Math.max(1, Math.round(ms / 60000));
    return minutes >= 60 ? `${Math.floor(minutes / 60)} u ${minutes % 60} min` : `${minutes} min`;
  };

  function setRemaining(distanceText, timeText) {
    if ($('remainingDistance')) $('remainingDistance').textContent = distanceText || '-';
    if ($('remainingTime')) $('remainingTime').textContent = timeText || '-';
    if ($('routeMeta')) $('routeMeta').textContent = [distanceText, timeText].filter(Boolean).join(' · ');
  }

  function isDesktop() {
    return window.matchMedia('(min-width: 900px) and (pointer: fine)').matches;
  }

  function isMobileDevice() {
    return !isDesktop() && (window.matchMedia('(pointer: coarse)').matches || Math.min(window.innerWidth, window.innerHeight) < 900);
  }

  function renderGpsIndicator() {
    const indicator = $('gpsAlert');
    if (!indicator) return;
    const needsGps = (state.entryMode === 'address' && state.startMode === 'gps')
      || state.pendingNavigationStart
      || (state.navigationActive && state.navigationSource === 'gps');
    const hasIssue = state.gpsStatus !== 'active';
    indicator.hidden = !needsGps || !hasIssue;
    if (indicator.hidden) return;
    const label = state.gpsStatus === 'searching'
      ? 'GPS zoeken…'
      : state.gpsStatus === 'error'
        ? 'GPS niet actief'
        : 'GPS uit';
    if ($('gpsAlertText')) $('gpsAlertText').textContent = label;
    indicator.title = state.gpsError || 'Tik om GPS opnieuw te starten';
    indicator.classList.toggle('is-searching', state.gpsStatus === 'searching');
    indicator.classList.toggle('is-error', state.gpsStatus === 'error');
  }

  function setFuelLoading(active) {
    state.fuelLoading = Boolean(active);
    const button = $('fuel');
    if (!button) return;
    button.disabled = state.fuelLoading || state.navigationPaused;
    button.classList.toggle('is-loading', state.fuelLoading);
    button.setAttribute('aria-busy', state.fuelLoading ? 'true' : 'false');
    button.title = state.fuelLoading ? 'Tankstations zoeken…' : 'Tankstation zoeken';
  }

  function cancelFuelSearch() {
    state.fuelSearchToken += 1;
    try { state.fuelAbortController?.abort(); } catch (_) {}
    state.fuelAbortController = null;
    setFuelLoading(false);
  }

  function setStartMode(mode, options = {}) {
    state.startMode = mode === 'manual' ? 'manual' : 'gps';
    const manual = state.startMode === 'manual';
    if ($('startMode')) {
      $('startMode').textContent = manual ? 'Hand' : 'GPS';
      $('startMode').classList.toggle('manual', manual);
    }
    if ($('startQuery')) {
      $('startQuery').disabled = !manual;
      $('startQuery').placeholder = manual ? 'Vul een vertrekadres in' : 'Vertrekpunt: mijn locatie';
      if (!manual) $('startQuery').value = state.current ? 'Mijn huidige locatie' : '';
    }
    if (!manual && options.startGps !== false && state.watchId === null) startGpsWatch();
    renderGpsIndicator();
  }

  function chooseAddressMode() {
    state.entryMode = 'address';
    if (isDesktop()) setStartMode('manual', { startGps: false });
    else setStartMode(state.startMode, { startGps: true });
    renderUi();
    window.setTimeout(() => $('destinationQuery')?.focus(), 80);
  }

  function chooseGpxMode() {
    state.gpxAppendMode = false;
    $('gpxFile')?.click();
  }

  function appendGpxMode() {
    state.gpxAppendMode = Boolean(state.gpxDocument);
    $('gpxFile')?.click();
  }

  function returnToModeChoice() {
    stopGpsWatch({ preservePosition: true });
    state.entryMode = null;
    state.startPoint = null;
    state.destinationPoint = null;
    state.destinationLabel = '';
    state.pickingStart = false;
    state.pickingDestination = false;
    map.getCanvas()?.classList.remove('map-pick-mode');
    if (state.startMarker) { state.startMarker.remove(); state.startMarker = null; }
    if (state.destinationMarker) { state.destinationMarker.remove(); state.destinationMarker = null; }
    if ($('startQuery')) $('startQuery').value = '';
    if ($('destinationQuery')) $('destinationQuery').value = '';
    if ($('searchResults')) $('searchResults').hidden = true;
    renderUi();
  }

  function persistSettings() {
    const payload = {
      apiKey: state.apiKey,
      profile: state.profile,
      autoFollow: state.autoFollow,
      keepAwake: state.keepAwake,
      avatar: state.avatar,
      customAvatar: state.customAvatar,
      gpxJumpThresholdMeters: state.gpxAnalysis.jumpThresholdMeters,
      gpxRouteMode: state.gpxRouteMode,
      gpxHybridToleranceMeters: state.gpxHybridToleranceMeters
    };
    try {
      localStorage.setItem(KEY, JSON.stringify(payload));
    } catch (error) {
      console.warn('Instellingen konden niet lokaal worden opgeslagen:', error);
      status('Instellingen konden niet volledig worden opgeslagen.', { error: true, duration: 6000 });
    }
  }

  async function requestWakeLock() {
    if (!state.keepAwake || !state.navigationActive || state.navigationPaused || document.visibilityState !== 'visible') return;
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== 'function') return;
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
    if (document.visibilityState !== 'visible') return;
    requestOrientationStep(state.navigationActive ? state.orientationStep : 0, { silent: true });
    if (state.navigationActive && !state.navigationPaused) requestWakeLock();
  });

  const map = new maplibregl.Map({
    container: 'map',
    style: {
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
    },
    center: [5.3, 52.1],
    zoom: 7,
    attributionControl: true
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: true }), 'top-right');

  map.on('load', () => {
    addGpxReferenceLayers();
    addRouteLayer('route-casing', '#ffffff', 13, 0.96);
    addRouteComponentLayers();
    addRouteLayer('route-traveled', '#94a3b8', 8, 0.72);
    addRouteLayer('route-remaining', '#2563eb', 8, 0.98);
    addRouteLayer('rejoin-casing', '#ffffff', 12, 0.94);
    addRouteLayer('rejoin-route', '#f97316', 7, 0.98);
    addGpxPreviewLayers();
    addGpxEditorLayers();
    addGpxAnalysisLayers();
    state.mapReady = true;
    if (state.route) updateRouteProgress(state.progressKm || 0);
    else if (state.gpxDocument) setGpxPreview(state.gpxDocument.parts);
    if (state.gpxAnalysis.active) showGpxAnalysisOnMap({ fit: false });
    if (state.gpxEditor.active) updateGpxPointLayer();
    renderUi();
    status('');
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

  function addGpxReferenceLayers() {
    map.addSource('gpx-original-reference', { type: 'geojson', data: emptyGeoJson() });
    map.addLayer({
      id: 'gpx-original-reference',
      type: 'line',
      source: 'gpx-original-reference',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#475569',
        'line-width': 3,
        'line-opacity': 0.7,
        'line-dasharray': [1.2, 1.5]
      }
    });
  }

  function addRouteComponentLayers() {
    map.addSource('route-components', { type: 'geojson', data: emptyGeoJson() });
    map.addLayer({
      id: 'route-components-casing',
      type: 'line',
      source: 'route-components',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 12, 'line-opacity': 0.96 }
    });
    map.addLayer({
      id: 'route-components-lines',
      type: 'line',
      source: 'route-components',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': [
          'match', ['get', 'kind'],
          'matched', '#2563eb',
          'exact', '#f97316',
          'connector', '#16a34a',
          'access', '#7c3aed',
          'unresolved', '#dc2626',
          '#2563eb'
        ],
        'line-width': 8,
        'line-opacity': 0.99
      }
    });
  }

  function clearRouteComponentLayers() {
    map.getSource('route-components')?.setData(emptyGeoJson());
    map.getSource('gpx-original-reference')?.setData(emptyGeoJson());
  }

  function addGpxPreviewLayers() {
    map.addSource('gpx-preview', { type: 'geojson', data: emptyGeoJson() });
    map.addLayer({
      id: 'gpx-preview-casing',
      type: 'line',
      source: 'gpx-preview',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': 11, 'line-opacity': 0.9 }
    });
    map.addLayer({
      id: 'gpx-preview-lines',
      type: 'line',
      source: 'gpx-preview',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': ['coalesce', ['get', 'color'], '#2563eb'], 'line-width': 7, 'line-opacity': 0.96 }
    });
  }

  function setGpxPreview(parts, color = '#2563eb') {
    const source = map.getSource('gpx-preview');
    if (!source) return;
    const features = (parts || [])
      .filter(part => Array.isArray(part.coordinates) && part.coordinates.length >= 2)
      .map((part, index) => turf.lineString(part.coordinates, { color: part.color || color, partIndex: index }));
    source.setData(turf.featureCollection(features));
  }

  function clearGpxPreview() {
    map.getSource('gpx-preview')?.setData(emptyGeoJson());
  }

  function addGpxEditorLayers() {
    map.addSource('gpx-edit-points', { type: 'geojson', data: emptyGeoJson() });
    map.addLayer({
      id: 'gpx-edit-points',
      type: 'circle',
      source: 'gpx-edit-points',
      paint: {
        'circle-radius': ['case', ['boolean', ['get', 'selected'], false], 8, ['match', ['get', 'role'], 'start', 7, 'end', 7, 4]],
        'circle-color': ['case', ['boolean', ['get', 'selected'], false], '#dc2626', ['match', ['get', 'role'], 'start', '#0ea5e9', 'end', '#ef4444', '#2563eb']],
        'circle-stroke-color': '#ffffff',
        'circle-stroke-width': 2,
        'circle-opacity': 0.95
      }
    });
  }

  function addGpxAnalysisLayers() {
    map.addSource('gpx-analysis', { type: 'geojson', data: emptyGeoJson() });
    map.addLayer({
      id: 'gpx-analysis-casing', type: 'line', source: 'gpx-analysis',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#ffffff',
        'line-width': ['case', ['boolean', ['get', 'selected'], false], 13, 9],
        'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 0.98, 0.72]
      }
    });
    map.addLayer({
      id: 'gpx-analysis-lines', type: 'line', source: 'gpx-analysis',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['case', ['boolean', ['get', 'selected'], false], 8, 6],
        'line-opacity': ['case', ['boolean', ['get', 'selected'], false], 1, 0.58]
      }
    });
  }

  function emptyGeoJson() {
    return { type: 'FeatureCollection', features: [] };
  }

  function selectedGpxSegments() {
    return (state.gpxAnalysis.segments || []).filter(segment => state.gpxAnalysis.selectedIds.has(segment.id));
  }

  function preferredGpxSegments() {
    return selectedGpxSegments();
  }

  function renderUi() {
    const hasRoute = Boolean(state.route && state.route.coordinates?.length >= 2);
    const hasGpx = Boolean(state.gpxDocument);
    const availableSegments = state.gpxAnalysis.segments?.length || 0;
    const selectedSegments = preferredGpxSegments().length;
    const canPrepareGpx = hasGpx && selectedSegments > 0;
    const navigation = state.navigationActive;
    const choosing = !navigation && !hasRoute && !hasGpx && !state.entryMode;
    const planningAddress = !navigation && !hasRoute && !hasGpx && state.entryMode === 'address';

    document.body.classList.toggle('navigation-active', navigation);
    document.body.classList.toggle('navigation-paused', navigation && state.navigationPaused);
    document.body.classList.toggle('gpx-loaded', hasGpx);
    document.body.classList.toggle('route-ready', hasRoute);
    document.body.classList.toggle('choosing-mode', choosing);

    if ($('startChoice')) $('startChoice').hidden = !choosing;
    if ($('plannerCard')) $('plannerCard').hidden = !planningAddress;
    if ($('homeActions')) $('homeActions').hidden = true;
    if ($('modeBack')) $('modeBack').hidden = !planningAddress;
    if ($('settings')) $('settings').hidden = navigation;
    if ($('navigationPanel')) $('navigationPanel').hidden = !navigation;
    if ($('routePreview')) $('routePreview').hidden = navigation || (!hasRoute && !hasGpx);
    if ($('layoutToggle')) $('layoutToggle').hidden = !navigation || isDesktop();

    if ($('analyseGpx')) $('analyseGpx').hidden = !hasGpx;
    if ($('editGpx')) $('editGpx').hidden = !hasGpx;
    if ($('reverseGpx')) $('reverseGpx').hidden = !hasGpx;
    if ($('appendGpx')) $('appendGpx').hidden = !hasGpx;
    if ($('prepareGpxRoute')) {
      const button = $('prepareGpxRoute');
      button.hidden = !canPrepareGpx;
      button.disabled = state.gpxRoutePreparing;
      button.classList.toggle('is-loading', state.gpxRoutePreparing);
      button.setAttribute('aria-busy', state.gpxRoutePreparing ? 'true' : 'false');
      button.textContent = state.gpxRoutePreparing
        ? (state.gpxPrepareProgress || 'Rijroute maken…')
        : state.gpxRoutePrepared
          ? 'Wijzig rijmodus'
          : selectedSegments > 1
            ? `Kies rijmodus (${selectedSegments})`
            : 'Kies rijmodus';
    }
    if ($('prepareEditedGpx')) {
      $('prepareEditedGpx').disabled = state.gpxRoutePreparing;
      $('prepareEditedGpx').textContent = state.gpxRoutePreparing ? (state.gpxPrepareProgress || 'Rijroute maken…') : state.gpxRoutePrepared ? 'Wijzig rijmodus' : 'Kies rijmodus';
    }
    if ($('replaceGpx')) $('replaceGpx').hidden = !hasGpx;
    if ($('startNavigation')) {
      const canStart = hasRoute || canPrepareGpx;
      $('startNavigation').disabled = !canStart || state.gpxRoutePreparing;
      $('startNavigation').title = canStart ? 'Start navigatie' : 'Laad eerst een bruikbare route';
    }

    renderGpsIndicator();
    updatePauseButton();
    updateTurnAlert();
    updateGpxAnalysisSelectionUi();
    renderRoutePreview();
    applyLayoutMode();
    if (state.mapReady) {
      updateOriginalGpxReference();
      window.requestAnimationFrame(() => map.resize());
    }
  }

  function renderRoutePreview() {
    const preview = $('routePreview');
    if (!preview) return;
    const hasRoute = Boolean(state.route && state.route.coordinates?.length >= 2);
    const documentInfo = state.gpxDocument;

    if (!hasRoute && !documentInfo) {
      preview.hidden = true;
      return;
    }

    const breakdown = $('gpxRouteBreakdown');
    if (breakdown) breakdown.hidden = true;

    if (documentInfo) {
      const analysedCount = state.gpxAnalysis.segments.length || documentInfo.parts.length;
      const selectedCount = preferredGpxSegments().length;
      $('previewEyebrow').textContent = state.gpxRoutePrepared ? 'Rijroute klaar' : hasRoute ? 'GPX geselecteerd' : 'GPX geladen';
      $('previewTitle').textContent = documentInfo.fileName || 'GPX-route';
      if (state.gpxRoutePrepared && hasRoute) {
        const warnings = state.gpxPrepareWarnings?.length ? ` · ${state.gpxPrepareWarnings.length} aandachtspunt${state.gpxPrepareWarnings.length === 1 ? '' : 'en'}` : '';
        $('previewMessage').textContent = `${state.gpxPreparedMethod || 'GPX-route'}${warnings}. Grijs gestippeld toont de oorspronkelijke GPX.`;
        const summary = state.route.summary || componentSummary(state.route.components || []);
        if (breakdown) {
          breakdown.hidden = false;
          if ($('matchedRouteDistance')) $('matchedRouteDistance').textContent = fmtDistance(summary.matched || 0);
          if ($('exactRouteDistance')) $('exactRouteDistance').textContent = fmtDistance(summary.exact || 0);
          if ($('connectorRouteDistance')) $('connectorRouteDistance').textContent = fmtDistance((summary.connector || 0) + (summary.access || 0));
          if ($('unresolvedRouteDistance')) $('unresolvedRouteDistance').textContent = fmtDistance(summary.unresolved || 0);
          if ($('unresolvedRouteKind')) $('unresolvedRouteKind').hidden = !(summary.unresolved > 0);
        }
      } else if (hasRoute) {
        const selectedIds = selectedGpxSegments().map(segment => String(segment.id)).sort();
        const activeIds = (state.gpxActiveSegmentIds || []).map(id => String(id)).sort();
        const selectionChanged = selectedIds.length !== activeIds.length || selectedIds.some((id, index) => id !== activeIds[index]);
        $('previewMessage').textContent = selectionChanged
          ? `De trajectselectie is gewijzigd. Maak de rijroute opnieuw om ${selectedCount} gekozen traject${selectedCount === 1 ? '' : 'en'} samen te voegen.`
          : `${state.route.coordinates.length.toLocaleString('nl-NL')} GPX-punten geselecteerd. Kies hybride verwerking binnen ${state.gpxHybridToleranceMeters} meter of volg de GPX exact; alleen openingen worden dan verbonden.`;
      } else {
        $('previewMessage').textContent = `${analysedCount} traject${analysedCount === 1 ? '' : 'en'} gevonden. ${selectedCount} traject${selectedCount === 1 ? '' : 'en'} kunnen hybride of exact worden samengevoegd; pas de selectie zo nodig aan via Analyse.`;
      }
      $('previewDistance').textContent = hasRoute ? fmtDistance(state.route.distance) : fmtDistance(documentInfo.totalDistance);
      $('previewTime').textContent = hasRoute && state.route.time ? fmtDuration(state.route.time) : '-';
      $('previewSegments').textContent = String(analysedCount);
      return;
    }

    $('previewEyebrow').textContent = 'Route klaar';
    $('previewTitle').textContent = state.destinationLabel || 'Route naar bestemming';
    $('previewMessage').textContent = state.startLabel && state.destinationLabel
      ? `${state.startLabel} → ${state.destinationLabel}`
      : 'Controleer het overzicht en start daarna de navigatie.';
    $('previewDistance').textContent = fmtDistance(state.route.distance);
    $('previewTime').textContent = fmtDuration(state.route.time);
    $('previewSegments').textContent = '1';
  }

  function partsBounds(parts) {
    const bounds = new maplibregl.LngLatBounds();
    let count = 0;
    (parts || []).forEach(part => (part.coordinates || []).forEach(point => {
      bounds.extend(point);
      count += 1;
    }));
    return count ? bounds : null;
  }

  function mapPaddingForOverview() {
    if (isDesktop()) return { top: 90, bottom: 90, left: 70, right: 70 };
    const previewHeight = $('routePreview')?.hidden ? 100 : Math.min(260, $('routePreview')?.offsetHeight || 190);
    return { top: 135, bottom: previewHeight + 86, left: 34, right: 34 };
  }

  function setLineSource(id, coordinates) {
    const source = map.getSource(id);
    if (source) source.setData(coordinates && coordinates.length >= 2 ? turf.lineString(coordinates) : emptyGeoJson());
  }

  function routeIndexAtKm(cumulative, km) {
    if (!cumulative?.length) return 0;
    let low = 0;
    let high = cumulative.length - 1;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (cumulative[middle] < km) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  function splitRouteAtKm(coordinates, cumulative, progressKm) {
    const totalKm = cumulative[cumulative.length - 1] || 0;
    const clamped = Math.max(0, Math.min(totalKm, Number(progressKm) || 0));
    if (clamped <= 0.000001) return { traveled: [], remaining: coordinates };
    if (clamped >= totalKm - 0.000001) return { traveled: coordinates, remaining: [] };

    const nextIndex = Math.max(1, routeIndexAtKm(cumulative, clamped));
    const previousIndex = nextIndex - 1;
    const segmentStart = cumulative[previousIndex];
    const segmentEnd = cumulative[nextIndex];
    const fraction = segmentEnd > segmentStart ? (clamped - segmentStart) / (segmentEnd - segmentStart) : 0;
    const from = coordinates[previousIndex];
    const to = coordinates[nextIndex];
    const cut = [
      from[0] + (to[0] - from[0]) * fraction,
      from[1] + (to[1] - from[1]) * fraction
    ];
    return {
      traveled: [...coordinates.slice(0, nextIndex), cut],
      remaining: [cut, ...coordinates.slice(nextIndex)]
    };
  }

  function routeComponentFeatures(progressKm = 0) {
    if (!state.route?.components?.length) return [];
    const progress = Math.max(0, Number(progressKm) || 0);
    return state.route.components.flatMap((component, index) => {
      if (!component?.coordinates?.length || component.coordinates.length < 2) return [];
      const startKm = Number(component.startKm) || 0;
      const endKm = Number(component.endKm) || startKm;
      if (progress >= endKm - 0.000001) return [];
      let coordinates = component.coordinates;
      if (progress > startKm) {
        const cumulative = buildCumulativeKm(component.coordinates);
        coordinates = splitRouteAtKm(component.coordinates, cumulative, progress - startKm).remaining;
      }
      if (!coordinates || coordinates.length < 2) return [];
      return [turf.lineString(coordinates, {
        kind: component.kind || 'matched',
        label: component.label || `Deel ${index + 1}`
      })];
    });
  }

  function updateOriginalGpxReference() {
    const source = map.getSource('gpx-original-reference');
    if (!source) return;
    const parts = !state.navigationActive && Array.isArray(state.route?.originalParts) ? state.route.originalParts : [];
    const features = parts
      .filter(part => Array.isArray(part.coordinates) && part.coordinates.length >= 2)
      .map(part => turf.lineString(part.coordinates));
    source.setData(turf.featureCollection(features));
  }

  function updateRouteProgress(progressKm) {
    if (!state.route || state.route.coordinates.length < 2) return;
    const cumulative = state.route.cumulativeKm || buildCumulativeKm(state.route.coordinates);
    const { traveled, remaining } = splitRouteAtKm(state.route.coordinates, cumulative, progressKm);
    setLineSource('route-casing', state.route.coordinates);
    setLineSource('route-traveled', traveled);
    if (state.route.components?.length) {
      setLineSource('route-remaining', []);
      map.getSource('route-components')?.setData(turf.featureCollection(routeComponentFeatures(progressKm)));
    } else {
      map.getSource('route-components')?.setData(emptyGeoJson());
      setLineSource('route-remaining', remaining);
    }
    updateOriginalGpxReference();
  }

  function routeComponentAtKm(km) {
    const components = state.route?.components || [];
    const value = Math.max(0, Number(km) || 0);
    return components.find(component => value >= (Number(component.startKm) || 0) - 0.0001 && value <= (Number(component.endKm) || 0) + 0.0001) || null;
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


  async function calculateRouteViaPointsChunk(points) {
    const url = new URL('https://graphhopper.com/api/1/route');
    url.searchParams.set('key', state.apiKey);
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        profile: state.profile,
        locale: 'nl',
        instructions: true,
        points_encoded: false,
        calc_points: true,
        points: points.map(([lng, lat]) => [lng, lat])
      })
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) {}
      throw new Error(`Route via GPX-punten mislukt (${response.status})${detail ? `: ${detail}` : ''}.`);
    }
    const data = await response.json();
    const path = data.paths?.[0];
    if (!path?.points?.coordinates?.length) throw new Error('Geen rijroute door de GPX-punten gevonden.');
    return { coordinates: path.points.coordinates, distance: path.distance, time: path.time, instructions: path.instructions || [] };
  }

  async function calculateRouteViaPoints(points) {
    ensureKey();
    if (!Array.isArray(points) || points.length < 2) throw new Error('Er zijn minimaal twee routepunten nodig.');
    // Houd iedere aanvraag klein. Dit werkt ook met GraphHopper-abonnementen
    // die slechts een beperkt aantal locaties per routeaanvraag toestaan.
    const maxLocationsPerRequest = 5;
    if (points.length <= maxLocationsPerRequest) return calculateRouteViaPointsChunk(points);

    const chunks = [];
    for (let startIndex = 0; startIndex < points.length - 1; startIndex += maxLocationsPerRequest - 1) {
      const chunk = points.slice(startIndex, Math.min(points.length, startIndex + maxLocationsPerRequest));
      if (chunk.length >= 2) chunks.push(chunk);
      if (startIndex + maxLocationsPerRequest >= points.length) break;
    }

    const merged = { coordinates: [], distance: 0, time: 0, instructions: [] };
    for (let index = 0; index < chunks.length; index += 1) {
      state.gpxPrepareProgress = chunks.length > 1 ? `Alternatieve rijroute ${index + 1}/${chunks.length}…` : 'Alternatieve rijroute maken…';
      renderUi();
      const result = await calculateRouteViaPointsChunk(chunks[index]);
      const offset = Math.max(0, merged.coordinates.length - 1);
      merged.coordinates.push(...(index === 0 ? result.coordinates : result.coordinates.slice(1)));
      merged.distance += Number(result.distance) || 0;
      merged.time += Number(result.time) || 0;
      merged.instructions.push(...adjustInstructions(result.instructions, offset, 0));
    }
    if (merged.coordinates.length < 2) throw new Error('Geen bruikbare alternatieve rijroute gevonden.');
    return merged;
  }


  function cloneRouteData(route) {
    if (!route) return null;
    return {
      ...route,
      coordinates: (route.coordinates || []).map(point => [...point]),
      distance: Number(route.distance) || 0,
      time: Number(route.time) || 0,
      instructions: (route.instructions || []).map(item => ({ ...item, interval: Array.isArray(item.interval) ? [...item.interval] : item.interval })),
      components: (route.components || []).map(component => ({
        ...component,
        coordinates: (component.coordinates || []).map(point => [...point])
      })),
      originalParts: (route.originalParts || []).map(part => ({
        ...part,
        coordinates: (part.coordinates || []).map(point => [...point])
      })),
      summary: route.summary ? { ...route.summary } : undefined
    };
  }


  function gpxEditorHasChanges() {
    const original = state.gpxEditor.originalCoordinates || [];
    const edited = state.gpxEditor.editCoordinates || [];
    if (original.length !== edited.length) return true;
    for (let index = 0; index < original.length; index += 1) {
      const before = original[index];
      const after = edited[index];
      if (!before || !after || Math.abs(before[0] - after[0]) > 1e-9 || Math.abs(before[1] - after[1]) > 1e-9) return true;
    }
    return false;
  }

  function gpxXmlFromCoordinates(coordinates, name = 'GPX-route') {
    const points = coordinates.map(point => `      <trkpt lat="${point[1].toFixed(7)}" lon="${point[0].toFixed(7)}"></trkpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${APP_NAME} v${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n  <trk><name>${escapeXml(name)}</name><trkseg>\n${points}\n  </trkseg></trk>\n</gpx>`;
  }

  function sampleGpxCoordinates(coordinates, maxPoints = 2200) {
    if (coordinates.length <= maxPoints) return coordinates.map(point => [...point]);
    const sampled = [coordinates[0]];
    const step = (coordinates.length - 1) / (maxPoints - 1);
    for (let i = 1; i < maxPoints - 1; i += 1) sampled.push(coordinates[Math.round(i * step)]);
    sampled.push(coordinates[coordinates.length - 1]);
    return sampled.map(point => [...point]);
  }

  async function mapMatchGpxChunk(coordinates) {
    const url = new URL('https://graphhopper.com/api/1/match');
    Object.entries({ profile: state.profile, locale: 'nl', instructions: 'true', points_encoded: 'false', type: 'json', gps_accuracy: '30', key: state.apiKey }).forEach(([key, value]) => url.searchParams.set(key, value));
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/gpx+xml' },
      body: gpxXmlFromCoordinates(coordinates, state.gpxEditor.fileName || 'GPX-route')
    });
    if (!response.ok) {
      let detail = '';
      try { detail = (await response.json()).message || ''; } catch (_) {}
      const error = new Error(`GPX-kaartmatching mislukt (${response.status})${detail ? `: ${detail}` : ''}.`);
      error.status = response.status;
      throw error;
    }
    const data = await response.json();
    const path = data.paths?.[0] || data.path;
    const coordinatesOut = path?.points?.coordinates || data.points?.coordinates;
    if (!path || !Array.isArray(coordinatesOut) || coordinatesOut.length < 2) throw new Error('De kaartmatching leverde geen bruikbare rijroute op.');
    return { coordinates: coordinatesOut, distance: Number(path.distance) || 0, time: Number(path.time) || 0, instructions: path.instructions || [] };
  }

  function mergeMatchedRouteParts(parts) {
    const merged = { coordinates: [], distance: 0, time: 0, instructions: [] };
    parts.forEach((result, index) => {
      const overlap = index > 0 && merged.coordinates.length && result.coordinates.length
        && turf.distance(turf.point(merged.coordinates.at(-1)), turf.point(result.coordinates[0]), { units: 'kilometers' }) < 0.03;
      const offset = merged.coordinates.length - (overlap ? 1 : 0);
      merged.coordinates.push(...(overlap ? result.coordinates.slice(1) : result.coordinates));
      merged.distance += Number(result.distance) || 0;
      merged.time += Number(result.time) || 0;
      const instructions = index < parts.length - 1
        ? (result.instructions || []).filter(item => ![4, 5].includes(Number(item.sign)))
        : (result.instructions || []);
      merged.instructions.push(...adjustInstructions(instructions, Math.max(0, offset), 0));
    });
    return merged;
  }

  async function mapMatchGpxChunkAdaptive(coordinates, depth = 0) {
    try {
      return await mapMatchGpxChunk(coordinates);
    } catch (error) {
      const canSplit = coordinates.length > 35 && depth < 5 && [400, 413, 422].includes(Number(error.status));
      if (!canSplit) throw error;
      const middle = Math.floor(coordinates.length / 2);
      const left = coordinates.slice(0, middle + 1);
      const right = coordinates.slice(Math.max(0, middle));
      const first = await mapMatchGpxChunkAdaptive(left, depth + 1);
      const second = await mapMatchGpxChunkAdaptive(right, depth + 1);
      return mergeMatchedRouteParts([first, second]);
    }
  }

  async function mapMatchGpx(coordinates, options = {}) {
    ensureKey();
    const label = options.label || 'Rijroute';
    const sampled = sampleGpxCoordinates(coordinates, 1800);
    const chunkSize = 450;
    const chunks = [];
    for (let start = 0; start < sampled.length - 1; start += chunkSize - 1) {
      const chunk = sampled.slice(start, Math.min(sampled.length, start + chunkSize));
      if (chunk.length >= 2) chunks.push(chunk);
      if (start + chunkSize >= sampled.length) break;
    }
    const results = [];
    for (let index = 0; index < chunks.length; index += 1) {
      state.gpxPrepareProgress = chunks.length > 1 ? `${label} · deel ${index + 1}/${chunks.length}…` : `${label}…`;
      renderUi();
      results.push(await mapMatchGpxChunkAdaptive(chunks[index]));
    }
    const merged = mergeMatchedRouteParts(results);
    if (merged.coordinates.length < 2) throw new Error('De kaartmatching leverde geen bruikbare rijroute op.');
    return merged;
  }

  async function fallbackRouteFromGpx(coordinates) {
    // Wanneer map matching niet beschikbaar is, houd de vorm beter vast door
    // via meerdere representatieve GPX-punten te routeren.
    const points = sampleGpxCoordinates(coordinates, Math.min(30, Math.max(8, Math.ceil(coordinates.length / 250))));
    return calculateRouteViaPoints(points);
  }

  function invalidatePreparedGpx() {
    state.gpxRoutePrepared = false;
    state.gpxPreparedMethod = '';
    state.gpxPrepareWarnings = [];
    state.gpxBaseRoute = null;
    state.gpxStartStrategy = null;
  }

  function cloneGpxSegment(segment) {
    return {
      ...segment,
      coordinates: (segment.coordinates || []).map(point => [...point])
    };
  }

  function orderedGpxSegmentsForJoin(segments) {
    const ordered = (segments || [])
      .filter(segment => Array.isArray(segment.coordinates) && segment.coordinates.length >= 2)
      .map(cloneGpxSegment);
    for (let index = 1; index < ordered.length; index += 1) {
      const previousEnd = ordered[index - 1].coordinates.at(-1);
      const next = ordered[index];
      const toStart = turf.distance(turf.point(previousEnd), turf.point(next.coordinates[0]), { units: 'kilometers' });
      const toEnd = turf.distance(turf.point(previousEnd), turf.point(next.coordinates.at(-1)), { units: 'kilometers' });
      if (toEnd + 0.02 < toStart) {
        next.coordinates.reverse();
        next.reversedForJoin = !next.reversedForJoin;
      }
    }
    return ordered;
  }

  function initialiseGpxEditorCoordinates(coordinates, options = {}) {
    const clean = (coordinates || []).filter(point => Array.isArray(point) && point.length >= 2).map(point => [...point]);
    if (clean.length < 2) throw new Error('De samengestelde GPX bevat te weinig punten.');
    state.gpxEditor = {
      active: false,
      fileName: options.fileName || state.gpxDocument?.fileName || 'route',
      originalCoordinates: clean.map(point => [...point]),
      editCoordinates: clean.map(point => [...point]),
      selectedIndices: new Set(),
      selectedMarker: null,
      boxMode: false,
      addMode: false,
      boxStart: null,
      boxElement: null,
      pointerId: null,
      history: []
    };
    state.startPoint = clean[0];
    state.destinationPoint = clean.at(-1);
    state.startLabel = 'Start GPX';
    state.destinationLabel = 'Einde GPX';
    setMarker('start', clean[0]);
    setMarker('destination', clean.at(-1));
  }

  function estimatedComponentTime(distanceMeters, kind = 'exact') {
    const speedKmh = state.profile === 'bike'
      ? (kind === 'exact' ? 17 : 21)
      : state.profile === 'foot'
        ? 5
        : (kind === 'exact' ? 42 : kind === 'connector' ? 55 : 65);
    return Math.max(0, Number(distanceMeters) || 0) / Math.max(1, speedKmh) * 3600;
  }

  function normalizedBearingDelta(from, to) {
    let value = (to - from + 540) % 360 - 180;
    if (value === -180) value = 180;
    return value;
  }

  function geometryInstructions(coordinates, label = 'GPX-spoor') {
    if (!Array.isArray(coordinates) || coordinates.length < 2) return [];
    const cumulative = buildCumulativeKm(coordinates);
    const totalKm = cumulative.at(-1) || 0;
    const instructions = [{ sign: 0, text: `Volg ${label}`, distance: 0, time: 0, interval: [0, 0] }];
    let lastInstructionKm = 0;
    for (let index = 2; index < coordinates.length - 2; index += 1) {
      const currentKm = cumulative[index] || 0;
      if (currentKm - lastInstructionKm < 0.09 || totalKm - currentKm < 0.06) continue;
      const beforeIndex = Math.max(0, routeIndexAtKm(cumulative, Math.max(0, currentKm - 0.045)) - 1);
      const afterIndex = Math.min(coordinates.length - 1, routeIndexAtKm(cumulative, Math.min(totalKm, currentKm + 0.045)));
      if (beforeIndex >= index || afterIndex <= index) continue;
      const incoming = turf.bearing(turf.point(coordinates[beforeIndex]), turf.point(coordinates[index]));
      const outgoing = turf.bearing(turf.point(coordinates[index]), turf.point(coordinates[afterIndex]));
      const delta = normalizedBearingDelta(incoming, outgoing);
      const absolute = Math.abs(delta);
      if (absolute < 38) continue;
      const right = delta > 0;
      let sign;
      let text;
      if (absolute < 72) {
        sign = right ? 1 : -1;
        text = `Houd ${right ? 'rechts' : 'links'} aan op het GPX-spoor`;
      } else if (absolute < 135) {
        sign = right ? 2 : -2;
        text = `Ga ${right ? 'rechts' : 'links'} op het GPX-spoor`;
      } else {
        sign = right ? 3 : -3;
        text = `Sla scherp ${right ? 'rechts' : 'links'} af op het GPX-spoor`;
      }
      instructions.push({ sign, text, distance: 0, time: 0, interval: [index, index] });
      lastInstructionKm = currentKm;
    }
    instructions.push({ sign: 4, text: 'Einde van dit GPX-deel', distance: 0, time: 0, interval: [coordinates.length - 1, coordinates.length - 1] });
    return instructions;
  }

  function exactRouteComponent(coordinates, options = {}) {
    const clean = (coordinates || []).map(point => [...point]);
    const distance = clean.length >= 2 ? turf.length(turf.lineString(clean), { units: 'kilometers' }) * 1000 : 0;
    return {
      kind: options.kind || 'exact',
      label: options.label || 'Exact GPX-deel',
      coordinates: clean,
      distance,
      time: estimatedComponentTime(distance, options.kind || 'exact'),
      instructions: options.instructions || geometryInstructions(clean, options.label || 'het GPX-spoor'),
      reason: options.reason || ''
    };
  }

  function routeResultComponent(route, kind, label, extra = {}) {
    return {
      kind,
      label,
      coordinates: (route.coordinates || []).map(point => [...point]),
      distance: Number(route.distance) || 0,
      time: Number(route.time) || 0,
      instructions: (route.instructions || []).map(item => ({ ...item, interval: Array.isArray(item.interval) ? [...item.interval] : item.interval })),
      ...extra
    };
  }

  function componentSummary(components) {
    const summary = { matched: 0, exact: 0, connector: 0, unresolved: 0, access: 0 };
    (components || []).forEach(component => {
      const key = Object.prototype.hasOwnProperty.call(summary, component.kind) ? component.kind : 'exact';
      summary[key] += Number(component.distance) || (component.coordinates?.length >= 2 ? turf.length(turf.lineString(component.coordinates), { units: 'kilometers' }) * 1000 : 0);
    });
    return summary;
  }

  function composeRouteComponents(components, options = {}) {
    const cleaned = (components || []).filter(component => component?.coordinates?.length >= 2);
    const merged = { coordinates: [], distance: 0, time: 0, instructions: [], components: [], originalParts: (options.originalParts || []).map(cloneGpxPart) };
    cleaned.forEach((component, componentIndex) => {
      const coordinates = component.coordinates.map(point => [...point]);
      const hasOverlap = merged.coordinates.length > 0
        && turf.distance(turf.point(merged.coordinates.at(-1)), turf.point(coordinates[0]), { units: 'meters' }) < 8;
      const startIndex = merged.coordinates.length - (hasOverlap ? 1 : 0);
      merged.coordinates.push(...(hasOverlap ? coordinates.slice(1) : coordinates));
      const endIndex = merged.coordinates.length - 1;
      const geometryDistance = turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000;
      const distance = Number(component.distance) || geometryDistance;
      const time = Number(component.time) || estimatedComponentTime(distance, component.kind);
      const localInstructions = (component.instructions?.length ? component.instructions : geometryInstructions(coordinates, component.kind === 'exact' ? 'het GPX-spoor' : 'de route'));
      const filteredInstructions = componentIndex < cleaned.length - 1
        ? localInstructions.filter(item => ![4, 5].includes(Number(item.sign)))
        : localInstructions;
      merged.instructions.push(...adjustInstructions(filteredInstructions, Math.max(0, startIndex), 0));
      merged.distance += distance;
      merged.time += time;
      merged.components.push({
        ...component,
        coordinates,
        distance,
        time,
        startIndex: Math.max(0, startIndex),
        endIndex: Math.max(0, endIndex)
      });
    });
    if (merged.coordinates.length < 2) throw new Error('De GPX leverde geen bruikbare route op.');
    merged.summary = componentSummary(merged.components);
    return merged;
  }

  function sampleLineCoordinates(coordinates, maxPoints = 80) {
    if (!Array.isArray(coordinates) || coordinates.length <= maxPoints) return (coordinates || []).map(point => [...point]);
    const line = turf.lineString(coordinates);
    const total = turf.length(line, { units: 'kilometers' });
    if (!Number.isFinite(total) || total <= 0) return sampleGpxCoordinates(coordinates, maxPoints);
    const result = [];
    for (let index = 0; index < maxPoints; index += 1) {
      result.push(turf.along(line, total * index / (maxPoints - 1), { units: 'kilometers' }).geometry.coordinates);
    }
    return result;
  }

  function percentile(values, ratio = 0.95) {
    if (!values.length) return Infinity;
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1))];
  }

  function distancesToLineMeters(coordinates, lineCoordinates, maxSamples = 70) {
    if (!coordinates?.length || !lineCoordinates?.length) return [];
    const line = turf.lineString(lineCoordinates);
    return sampleLineCoordinates(coordinates, maxSamples).map(point => {
      const snapped = turf.nearestPointOnLine(line, turf.point(point), { units: 'kilometers' });
      return turf.distance(turf.point(point), snapped, { units: 'meters' });
    });
  }

  function assessHybridMatch(originalCoordinates, matchedCoordinates, toleranceMeters) {
    const originalLine = turf.lineString(originalCoordinates);
    const matchedLine = turf.lineString(matchedCoordinates);
    const originalLength = Math.max(0.001, turf.length(originalLine, { units: 'kilometers' }));
    const matchedLength = Math.max(0.001, turf.length(matchedLine, { units: 'kilometers' }));
    const originalToMatched = distancesToLineMeters(originalCoordinates, matchedCoordinates);
    const matchedToOriginal = distancesToLineMeters(matchedCoordinates, originalCoordinates);
    const startDistance = turf.distance(turf.point(originalCoordinates[0]), turf.point(matchedCoordinates[0]), { units: 'meters' });
    const endDistance = turf.distance(turf.point(originalCoordinates.at(-1)), turf.point(matchedCoordinates.at(-1)), { units: 'meters' });
    const p95 = Math.max(percentile(originalToMatched), percentile(matchedToOriginal));
    const maxDistance = Math.max(...originalToMatched, ...matchedToOriginal);
    const lengthRatio = matchedLength / originalLength;
    const accepted = p95 <= toleranceMeters
      && maxDistance <= toleranceMeters
      && startDistance <= toleranceMeters
      && endDistance <= toleranceMeters
      && lengthRatio >= 0.68
      && lengthRatio <= 1.48;
    return { accepted, p95, maxDistance, startDistance, endDistance, lengthRatio };
  }

  function splitCoordinatesNearHalf(coordinates) {
    const cumulative = buildCumulativeKm(coordinates);
    const total = cumulative.at(-1) || 0;
    let splitIndex = routeIndexAtKm(cumulative, total / 2);
    splitIndex = Math.max(2, Math.min(coordinates.length - 3, splitIndex));
    return [coordinates.slice(0, splitIndex + 1), coordinates.slice(splitIndex)];
  }

  function chunkCoordinatesByDistance(coordinates, maxKm = 18) {
    if (coordinates.length < 2) return [];
    const chunks = [];
    let current = [coordinates[0]];
    let distance = 0;
    for (let index = 1; index < coordinates.length; index += 1) {
      const segmentKm = turf.distance(turf.point(coordinates[index - 1]), turf.point(coordinates[index]), { units: 'kilometers' });
      if (current.length >= 3 && distance + segmentKm > maxKm) {
        chunks.push(current);
        current = [coordinates[index - 1], coordinates[index]];
        distance = segmentKm;
      } else {
        current.push(coordinates[index]);
        distance += segmentKm;
      }
    }
    if (current.length >= 2) chunks.push(current);
    return chunks;
  }

  async function hybridiseGpxWindow(coordinates, toleranceMeters, context, depth = 0) {
    const geometryKm = turf.length(turf.lineString(coordinates), { units: 'kilometers' });
    const label = context.label || 'GPX-deel';
    try {
      const sampleCount = Math.max(10, Math.min(78, Math.ceil(geometryKm * 7) + 4));
      const sampled = sampleLineCoordinates(coordinates, sampleCount);
      const matched = await mapMatchGpxChunkAdaptive(sampled);
      const assessment = assessHybridMatch(coordinates, matched.coordinates, toleranceMeters);
      if (assessment.accepted) {
        return [routeResultComponent(matched, 'matched', `${label} · op weg`, { assessment })];
      }
      if (depth < 5 && geometryKm > 0.75 && coordinates.length >= 6) {
        const [left, right] = splitCoordinatesNearHalf(coordinates);
        const first = await hybridiseGpxWindow(left, toleranceMeters, context, depth + 1);
        const second = await hybridiseGpxWindow(right, toleranceMeters, context, depth + 1);
        return first.concat(second);
      }
      return [exactRouteComponent(coordinates, { label: `${label} · exact behouden`, reason: `Afwijking ${Math.round(assessment.p95)} m` })];
    } catch (error) {
      console.debug(`${label}: dit deel blijft exact GPX.`, error);
      if (depth < 4 && geometryKm > 1.2 && coordinates.length >= 8) {
        const [left, right] = splitCoordinatesNearHalf(coordinates);
        const first = await hybridiseGpxWindow(left, toleranceMeters, context, depth + 1);
        const second = await hybridiseGpxWindow(right, toleranceMeters, context, depth + 1);
        return first.concat(second);
      }
      return [exactRouteComponent(coordinates, { label: `${label} · exact behouden`, reason: 'Niet betrouwbaar aan een weg te koppelen' })];
    }
  }

  async function hybridiseGpxSegment(segment, index, total, toleranceMeters) {
    const windows = chunkCoordinatesByDistance(segment.coordinates, 18);
    const components = [];
    for (let windowIndex = 0; windowIndex < windows.length; windowIndex += 1) {
      state.gpxPrepareProgress = `Hybride route · traject ${index + 1}/${total}${windows.length > 1 ? ` · deel ${windowIndex + 1}/${windows.length}` : ''}…`;
      renderUi();
      const label = segment.name || `Traject ${index + 1}`;
      components.push(...await hybridiseGpxWindow(windows[windowIndex], toleranceMeters, { label }));
    }
    return components;
  }

  async function connectorComponent(from, to, label, warnings) {
    const gapMeters = turf.distance(turf.point(from), turf.point(to), { units: 'meters' });
    if (gapMeters <= 25) return null;
    if (state.apiKey) {
      try {
        const connector = await calculateRoute([from, to]);
        return routeResultComponent(connector, 'connector', label);
      } catch (error) {
        console.warn(`${label} kon niet over de weg worden berekend:`, error);
        warnings.push(`${label} kon niet automatisch over de weg worden opgelost.`);
      }
    } else {
      warnings.push(`${label} is niet berekend omdat geen GraphHopper API-key is ingesteld.`);
    }
    return exactRouteComponent([from, to], { kind: 'unresolved', label: `${label} · controle nodig`, reason: 'Rechte noodverbinding' });
  }

  async function buildRouteFromGpxSegments(segments, options = {}) {
    const routeMode = options.routeMode === 'exact' ? 'exact' : 'hybrid';
    const toleranceMeters = Number(options.toleranceMeters) || 30;
    if (routeMode === 'hybrid') ensureKey();
    const ordered = orderedGpxSegmentsForJoin(segments);
    if (!ordered.length) throw new Error('Selecteer minimaal één bruikbaar GPX-traject.');

    const components = [];
    const warnings = [];
    for (let index = 0; index < ordered.length; index += 1) {
      const segment = ordered[index];
      const segmentComponents = routeMode === 'hybrid'
        ? await hybridiseGpxSegment(segment, index, ordered.length, toleranceMeters)
        : [exactRouteComponent(segment.coordinates, { label: segment.name || `Traject ${index + 1}` })];

      if (components.length && segmentComponents.length) {
        state.gpxPrepareProgress = `Verbinding ${index}/${ordered.length - 1} berekenen…`;
        renderUi();
        const connector = await connectorComponent(
          components.at(-1).coordinates.at(-1),
          segmentComponents[0].coordinates[0],
          `Verbinding tussen traject ${index} en ${index + 1}`,
          warnings
        );
        if (connector) components.push(connector);
      }
      components.push(...segmentComponents);
    }

    const route = composeRouteComponents(components, { originalParts: ordered });
    const exactCount = route.components.filter(component => component.kind === 'exact').length;
    const unresolvedCount = route.components.filter(component => component.kind === 'unresolved').length;
    if (routeMode === 'hybrid' && exactCount) warnings.push(`${exactCount} deel${exactCount === 1 ? '' : 'en'} exact als GPX behouden omdat wegmatching niet binnen ${toleranceMeters} meter bleef.`);
    if (unresolvedCount) warnings.push(`${unresolvedCount} verbinding${unresolvedCount === 1 ? '' : 'en'} moet op de kaart worden gecontroleerd.`);
    route.summary = componentSummary(route.components);
    const uniqueWarnings = [...new Set(warnings)];
    const method = routeMode === 'exact'
      ? `GPX exact · ${ordered.length} traject${ordered.length === 1 ? '' : 'en'}`
      : `Hybride · maximaal ${toleranceMeters} m afwijking`;
    route.routeMode = routeMode;
    route.toleranceMeters = toleranceMeters;
    route.method = method;
    route.warnings = uniqueWarnings;
    return {
      route,
      ordered,
      warnings: uniqueWarnings,
      routeMode,
      toleranceMeters,
      method
    };
  }

  function applyPreparedGpxRoute(prepared) {
    const result = cloneRouteData(prepared.route);
    state.gpxRoutePrepared = true;
    state.gpxPreparedMethod = prepared.method;
    state.gpxPrepareWarnings = prepared.warnings || [];
    state.gpxRouteMode = prepared.routeMode || state.gpxRouteMode;
    state.gpxHybridToleranceMeters = Number(prepared.toleranceMeters) || state.gpxHybridToleranceMeters;
    state.gpxActiveSegmentIds = (prepared.ordered || []).map(segment => segment.id).filter(id => id !== undefined);
    initialiseGpxEditorCoordinates(result.coordinates);
    drawRoute(result, 'gpx', { skipOverview: true });
    state.gpxBaseRoute = cloneRouteData(state.route);
  }

  function preparationSegments(options = {}) {
    if (Array.isArray(options.segments)) {
      return options.segments.filter(segment => segment?.coordinates?.length >= 2).map(cloneGpxSegment);
    }
    const useEdited = options.useEdited === true || (state.mode === 'gpx' && gpxEditorHasChanges());
    if (useEdited && state.gpxEditor.editCoordinates.length >= 2) {
      return [{
        id: state.gpxActiveSegmentIds.length === 1 ? state.gpxActiveSegmentIds[0] : 'bewerkt',
        name: state.gpxEditor.fileName || 'Bewerkte GPX',
        coordinates: state.gpxEditor.editCoordinates.map(point => [...point])
      }];
    }
    return preferredGpxSegments().map(cloneGpxSegment);
  }

  function openGpxRouteMode(options = {}) {
    const segments = preparationSegments(options);
    if (!segments.length) {
      status('Selecteer minimaal één GPX-traject.', { error: true });
      return false;
    }
    state.gpxPendingPreparation = {
      segments,
      closeAnalysisOnSuccess: options.closeAnalysisOnSuccess === true,
      closeEditorOnSuccess: options.closeEditorOnSuccess === true,
      startAfterSuccess: options.startAfterSuccess === true
    };
    if ($('gpxHybridTolerance')) $('gpxHybridTolerance').value = String(state.gpxHybridToleranceMeters);
    if ($('gpxRouteModeSummary')) {
      $('gpxRouteModeSummary').textContent = `${segments.length} traject${segments.length === 1 ? '' : 'en'} geselecteerd. Bestaande GPX-delen blijven altijd beschikbaar voor controle.`;
    }
    if ($('gpxRouteModeSheet')) $('gpxRouteModeSheet').hidden = false;
    if ($('backdrop')) $('backdrop').hidden = false;
    return true;
  }

  function closeGpxRouteMode(options = {}) {
    if ($('gpxRouteModeSheet')) $('gpxRouteModeSheet').hidden = true;
    if (options.keepPending !== true) state.gpxPendingPreparation = null;
    syncBackdrop();
  }

  async function chooseGpxRouteMode(routeMode) {
    const pending = state.gpxPendingPreparation;
    if (!pending) return;
    state.gpxRouteMode = routeMode === 'exact' ? 'exact' : 'hybrid';
    const tolerance = Number($('gpxHybridTolerance')?.value);
    if ([10, 20, 30, 50].includes(tolerance)) state.gpxHybridToleranceMeters = tolerance;
    persistSettings();
    closeGpxRouteMode({ keepPending: true });
    state.gpxPendingPreparation = null;
    await prepareGpxRoute({ ...pending, routeMode: state.gpxRouteMode, toleranceMeters: state.gpxHybridToleranceMeters });
  }

  async function prepareGpxRoute(options = {}) {
    if (state.gpxRoutePreparing) return false;
    const segments = preparationSegments(options);
    if (!segments.length) {
      status('Selecteer minimaal één GPX-traject.', { error: true });
      return false;
    }
    if (!options.routeMode) {
      openGpxRouteMode({ ...options, segments });
      return false;
    }

    state.gpxRoutePreparing = true;
    state.gpxPrepareProgress = options.routeMode === 'exact' ? 'Exacte GPX samenstellen…' : 'Hybride route voorbereiden…';
    ['prepareGpxRoute', 'prepareEditedGpx', 'useSelectedGpxSegment'].forEach(id => {
      const button = $(id);
      if (button) { button.disabled = true; button.classList.add('is-loading'); button.setAttribute('aria-busy', 'true'); }
    });
    renderUi();
    try {
      const prepared = await buildRouteFromGpxSegments(segments, {
        routeMode: options.routeMode,
        toleranceMeters: options.toleranceMeters
      });
      state.gpxRouteMode = prepared.routeMode;
      state.gpxHybridToleranceMeters = prepared.toleranceMeters;
      applyPreparedGpxRoute(prepared);
      if (options.closeAnalysisOnSuccess) closeGpxAnalysis();
      if (options.closeEditorOnSuccess) closeGpxEditor();
      showOverview();
      if (options.startAfterSuccess) window.setTimeout(() => startNavigation(), 0);
      return true;
    } catch (error) {
      invalidatePreparedGpx();
      status(error.message, { error: true, duration: 9000 });
      return false;
    } finally {
      state.gpxRoutePreparing = false;
      state.gpxPrepareProgress = '';
      ['prepareGpxRoute', 'prepareEditedGpx', 'useSelectedGpxSegment'].forEach(id => {
        const button = $(id);
        if (button) { button.disabled = false; button.classList.remove('is-loading'); button.setAttribute('aria-busy', 'false'); }
      });
      renderUi();
    }
  }

  function prepareSelectedGpxSegments() {
    const selected = selectedGpxSegments();
    if (!selected.length) return status('Selecteer minimaal één traject om een rijroute te maken.', { error: true });
    openGpxRouteMode({ segments: selected, closeAnalysisOnSuccess: true });
  }

  function prepareEditedGpxRoute() {
    openGpxRouteMode({ useEdited: true, closeEditorOnSuccess: true });
  }

  function setMarker(type, point) {
    if (!point) return;
    const color = type === 'start' ? '#0ea5e9' : '#ef4444';
    const key = type === 'start' ? 'startMarker' : 'destinationMarker';
    if (!state[key]) state[key] = new maplibregl.Marker({ color }).setLngLat(point).addTo(map);
    else state[key].setLngLat(point);
  }

  const AVATAR_EMOJI = {
    'car-blue': '🚙',
    'car-red': '🚗',
    'car-racing': '🏎️',
    'motor': '🏍️',
    'scooter': '🛵'
  };

  function createAvatarElement() {
    const element = document.createElement('div');
    element.className = 'navigation-avatar';
    if (state.avatar === 'custom' && state.customAvatar) {
      element.classList.add('photo-avatar');
      element.style.backgroundImage = `url(${state.customAvatar})`;
    } else {
      element.textContent = AVATAR_EMOJI[state.avatar] || AVATAR_EMOJI.motor;
    }
    return element;
  }

  function refreshCurrentMarker() {
    if (!state.current) return;
    if (state.marker) state.marker.remove();
    state.marker = new maplibregl.Marker({ element: createAvatarElement(), anchor: 'center' })
      .setLngLat(state.current)
      .addTo(map);
  }

  function setCurrentPosition(point, options = {}) {
    if (!Array.isArray(point) || point.length < 2) return;
    state.current = point;
    if (!state.marker) refreshCurrentMarker();
    else state.marker.setLngLat(point);
    if (options.source && $('devSource')) $('devSource').textContent = options.source;
    if ($('devPosition')) $('devPosition').textContent = `${point[1].toFixed(5)}, ${point[0].toFixed(5)}`;
    if (state.navigationActive || options.forceNavigationUpdate) {
      updateNavigation(point, options.speedMps || 0, options.heading, options.progressKm);
    }
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

  function drawRoute(data, mode, options = {}) {
    stopSimulationTimer();
    const coordinates = Array.isArray(data?.coordinates) ? data.coordinates.map(point => [...point]) : [];
    if (coordinates.length < 2) throw new Error('De route bevat te weinig punten.');
    state.route = {
      ...data,
      coordinates,
      distance: Number(data.distance) || turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000,
      time: Number(data.time) || 0,
      instructions: Array.isArray(data.instructions) ? data.instructions.map(item => ({ ...item, interval: Array.isArray(item.interval) ? [...item.interval] : item.interval })) : [],
      components: (data.components || []).map(component => ({ ...component, coordinates: (component.coordinates || []).map(point => [...point]) })),
      originalParts: (data.originalParts || []).map(part => ({ ...part, coordinates: (part.coordinates || []).map(point => [...point]) })),
      summary: data.summary ? { ...data.summary } : undefined
    };
    state.route.cumulativeKm = buildCumulativeKm(coordinates);
    state.route.totalKm = state.route.cumulativeKm[state.route.cumulativeKm.length - 1] || state.route.distance / 1000;
    state.route.components.forEach(component => {
      const startIndex = Math.max(0, Math.min(coordinates.length - 1, Number(component.startIndex) || 0));
      const endIndex = Math.max(startIndex, Math.min(coordinates.length - 1, Number(component.endIndex) || startIndex));
      component.startIndex = startIndex;
      component.endIndex = endIndex;
      component.startKm = state.route.cumulativeKm[startIndex] || 0;
      component.endKm = state.route.cumulativeKm[endIndex] || component.startKm;
      component.distance = Number(component.distance) || Math.max(0, (component.endKm - component.startKm) * 1000);
    });
    state.original = coordinates.map(point => [...point]);
    state.mode = mode;
    state.progressKm = 0;
    state.simulation.distanceKm = 0;
    state.follow = false;
    state.offCount = 0;
    updateRouteProgress(0);
    setLineSource('rejoin-casing', []);
    setLineSource('rejoin-route', []);
    clearGpxPreview();

    const first = state.route.instructions[0];
    const firstText = first ? translateInstruction(first.text) : mode === 'gpx' ? 'Volg de GPX-route' : 'Volg de route';
    $('instruction').textContent = firstText;
    $('nextDistance').textContent = 'Start';
    $('maneuverIcon').textContent = first ? maneuverSymbol(first.sign, firstText) : '↑';
    state.nextManeuver = null;
    updateTurnAlert();
    setRemaining(fmtDistance(state.route.distance), state.route.time ? fmtDuration(state.route.time) : '-');
    renderUi();
    updateDeveloper();
    if (!options.skipOverview) showOverview();
  }



  function showOverview() {
    let bounds = null;
    if (state.route?.coordinates?.length >= 2) {
      bounds = partsBounds([{ coordinates: state.route.coordinates }]);
    } else if (state.gpxDocument?.parts?.length) {
      bounds = partsBounds(state.gpxDocument.parts);
    }
    if (!bounds) return status('Er is nog geen route om te tonen.', { error: true });
    map.fitBounds(bounds, { padding: mapPaddingForOverview(), duration: 550, maxZoom: 16, bearing: 0, pitch: 0 });
    state.follow = false;
    status('Route-overzicht');
  }



  function getStartPoint() {
    if (state.startMode === 'manual') {
      if (!state.startPoint) throw new Error('Kies eerst een handmatig vertrekpunt.');
      return state.startPoint;
    }
    if (!state.current || state.gpsStatus !== 'active') throw new Error('Wacht tot GPS actief is, of kies Handmatig.');
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
      status('Route berekenen…', { duration: 0 });
      const data = await calculateRoute([start, state.destinationPoint]);
      state.gpxDocument = null;
      state.gpxAnalysis.sourceParts = [];
      state.gpxAnalysis.segments = [];
      clearGpxPreview();
      setMarker('start', start);
      setMarker('destination', state.destinationPoint);
      state.entryMode = 'address';
      drawRoute(data, 'address');
      status(`Route klaar: ${fmtDistance(data.distance)}`);
    } catch (error) {
      status(error.message, { error: true, duration: 6000 });
    }
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
    const nextMode = state.startMode === 'gps' ? 'manual' : 'gps';
    if (nextMode === 'manual' && !state.navigationActive) stopGpsWatch({ preservePosition: true });
    setStartMode(nextMode, { startGps: nextMode === 'gps' });
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
    if (state.gpxEditor.active && !state.gpxEditor.boxMode) {
      const existing = map.queryRenderedFeatures(event.point, { layers: ['gpx-edit-points'] });
      if (state.gpxEditor.addMode) {
        if (!existing.length) insertGpxPoint([event.lngLat.lng, event.lngLat.lat]);
        return;
      }
      // Niet elk punt hoeft als cirkel gerenderd te worden bij grote GPX-bestanden.
      // Klikken op de lijn selecteert daarom ook het dichtstbijzijnde echte punt.
      if (!existing.length) {
        let nearestIndex = -1;
        let nearestPixels = 19;
        state.gpxEditor.editCoordinates.forEach((coordinate, index) => {
          const projected = map.project(coordinate);
          const distance = Math.hypot(projected.x - event.point.x, projected.y - event.point.y);
          if (distance < nearestPixels) { nearestPixels = distance; nearestIndex = index; }
        });
        if (nearestIndex >= 0) {
          toggleGpxIndex(nearestIndex);
          return;
        }
      }
    }
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

  function clearGpsWatchdog() {
    if (state.gpsWatchdog) window.clearTimeout(state.gpsWatchdog);
    state.gpsWatchdog = null;
  }

  function scheduleGpsWatchdog() {
    clearGpsWatchdog();
    state.gpsWatchdog = window.setTimeout(() => {
      if (state.watchId !== null && Date.now() - state.gpsLastFixAt > 18000) {
        state.gpsStatus = 'error';
        state.gpsError = 'Geen recente GPS-positie ontvangen.';
        renderGpsIndicator();
        if ($('gpxStartSheet') && !$('gpxStartSheet').hidden) updateGpxStartChoiceDistances();
      }
    }, 19000);
  }

  function stopGpsWatch(options = {}) {
    if (state.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.watchId);
    }
    state.watchId = null;
    state.pendingNavigationStart = false;
    state.pendingGpxStartStrategy = null;
    state.gpxStartWaiting = false;
    state.gpsStatus = 'idle';
    state.gpsError = '';
    clearGpsWatchdog();
    if (options.preservePosition === false) {
      state.current = null;
      if (state.marker) { state.marker.remove(); state.marker = null; }
    }
    renderGpsIndicator();
  }

  function startGpsWatch() {
    if (state.watchId !== null) return;
    if (!navigator.geolocation) {
      state.gpsStatus = 'error';
      state.gpsError = 'Deze browser ondersteunt geen locatiebepaling.';
      renderGpsIndicator();
      if ($('gpxStartSheet') && !$('gpxStartSheet').hidden) {
        setGpxStartFeedback(state.gpsError, { error: true });
        updateGpxStartChoiceDistances();
      } else {
        status(state.gpsError, { error: true });
      }
      return;
    }
    state.gpsStatus = 'searching';
    state.gpsError = '';
    renderGpsIndicator();
    state.watchId = navigator.geolocation.watchPosition(
      pos => {
        const point = [pos.coords.longitude, pos.coords.latitude];
        state.gpsStatus = 'active';
        state.gpsError = '';
        state.gpsLastFixAt = Date.now();
        scheduleGpsWatchdog();
        setCurrentPosition(point, { source: 'Echte GPS', speedMps: pos.coords.speed || 0, heading: pos.coords.heading });
        if (state.startMode === 'gps') {
          state.startPoint = point;
          state.startLabel = 'Mijn huidige locatie';
          if ($('startQuery')) $('startQuery').value = 'Mijn huidige locatie';
        }
        if (state.pendingNavigationStart && state.route) {
          const strategy = state.pendingGpxStartStrategy;
          state.pendingNavigationStart = false;
          if (strategy) {
            state.gpxStartWaiting = false;
            updateGpxStartButtons();
            startGpxWithStrategy(strategy).catch(error => {
              state.gpxStartWaiting = false;
              if ($('gpxStartSheet') && !$('gpxStartSheet').hidden) {
                setGpxStartFeedback(error.message, { error: true, retry: true });
              } else {
                status(error.message, { error: true, duration: 8000 });
              }
            });
          } else {
            state.pendingGpxStartStrategy = null;
            beginGpsNavigation();
          }
        }
        if ($('gpxStartSheet') && !$('gpxStartSheet').hidden) updateGpxStartChoiceDistances();
        renderGpsIndicator();
      },
      error => {
        state.pendingNavigationStart = false;
        state.gpxStartWaiting = false;
        state.gpsStatus = 'error';
        state.gpsError = gpsErrorMessage(error);
        if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
        state.watchId = null;
        clearGpsWatchdog();
        renderGpsIndicator();
        if ($('gpxStartSheet') && !$('gpxStartSheet').hidden) {
          setGpxStartFeedback(state.gpsError, { error: true, retry: true });
          updateGpxStartChoiceDistances();
        } else {
          status(state.gpsError, { error: true, duration: 7000 });
        }
      },
      { enableHighAccuracy: true, maximumAge: 1500, timeout: 15000 }
    );
  }

  function toggleGps() {
    if (state.watchId === null) startGpsWatch();
    else stopGpsWatch({ preservePosition: true });
  }



  function updatePauseButton() {
    const stopButton = $('stopNavigation');
    const resumeButton = $('resumeNavigation');
    if (!stopButton) return;
    stopButton.textContent = '✕';
    stopButton.classList.remove('resume-button');
    if (state.navigationPaused) {
      stopButton.title = 'Navigatie definitief stoppen';
      stopButton.setAttribute('aria-label', 'Navigatie definitief stoppen');
      if (resumeButton) resumeButton.hidden = false;
    } else {
      stopButton.title = 'Navigatie pauzeren';
      stopButton.setAttribute('aria-label', 'Navigatie pauzeren');
      if (resumeButton) resumeButton.hidden = true;
    }
    setFuelLoading(state.fuelLoading);
  }

  function beginGpsNavigation() {
    if (!state.route || !state.current) return;
    closeGpxStartSheet();
    state.navigationSource = 'gps';
    state.navigationPaused = false;
    state.follow = true;
    setNavigationMode(true);
    updatePauseButton();
    updateNavigation(state.current, 0, null);
    status('Navigatie gestart');
  }

  function updateGpxStartButtons() {
    const busy = Boolean(state.gpxStartWaiting);
    ['gpxNavigateToStart', 'gpxJoinNearest'].forEach(id => {
      const button = $(id);
      if (!button) return;
      button.disabled = busy;
      button.setAttribute('aria-busy', busy ? 'true' : 'false');
    });
  }

  function setGpxStartFeedback(text, options = {}) {
    const feedback = $('gpxStartFeedback');
    const retry = $('gpxRetryGps');
    if (!feedback) return;
    feedback.hidden = !text;
    feedback.classList.toggle('is-error', options.error === true);
    feedback.classList.toggle('is-loading', options.loading === true);
    if ($('gpxStartFeedbackText')) $('gpxStartFeedbackText').textContent = text || '';
    if (retry) retry.hidden = options.retry !== true;
    updateGpxStartButtons();
  }

  function updateGpxStartChoiceDistances() {
    const base = state.gpxBaseRoute || state.route;
    const startText = $('gpxStartDistanceText');
    const nearestText = $('gpxNearestDistanceText');
    if (!base?.coordinates?.length) {
      if (startText) startText.textContent = 'Rijroute is nog niet gereed';
      if (nearestText) nearestText.textContent = 'Rijroute is nog niet gereed';
      return;
    }
    if (!state.current || state.gpsStatus !== 'active') {
      const text = state.gpsStatus === 'error' ? 'GPS-locatie niet beschikbaar' : 'GPS-locatie wordt opgehaald…';
      if (startText) startText.textContent = text;
      if (nearestText) nearestText.textContent = text;
      if (state.gpsStatus === 'error') {
        setGpxStartFeedback(state.gpsError || 'De GPS-locatie kon niet worden opgehaald.', { error: true, retry: true });
      } else {
        setGpxStartFeedback('Even wachten terwijl joepjoepGO je huidige locatie bepaalt.', { loading: true });
      }
      return;
    }
    const current = turf.point(state.current);
    const toStart = turf.distance(current, turf.point(base.coordinates[0]), { units: 'kilometers' });
    const nearest = turf.nearestPointOnLine(turf.lineString(base.coordinates), current, { units: 'kilometers' });
    const toNearest = turf.distance(current, nearest, { units: 'kilometers' });
    if (startText) startText.textContent = `Startpunt op ongeveer ${fmtDistance(toStart * 1000)} hemelsbreed`;
    if (nearestText) nearestText.textContent = `Dichtstbijzijnde instapplek op ongeveer ${fmtDistance(toNearest * 1000)} hemelsbreed`;
    if (!state.gpxStartWaiting) setGpxStartFeedback('');
  }

  function openGpxStartSheet() {
    if (!$('gpxStartSheet')) return;
    state.gpxStartWaiting = false;
    $('gpxStartSheet').hidden = false;
    $('backdrop').hidden = false;
    if (!state.current || state.gpsStatus !== 'active') startGpsWatch();
    updateGpxStartButtons();
    updateGpxStartChoiceDistances();
  }

  function closeGpxStartSheet(options = {}) {
    if ($('gpxStartSheet')) $('gpxStartSheet').hidden = true;
    state.gpxStartWaiting = false;
    updateGpxStartButtons();
    setGpxStartFeedback('');
    if (options.cancelPending !== false) {
      state.pendingNavigationStart = false;
      state.pendingGpxStartStrategy = null;
    }
    syncBackdrop();
  }

  function retryGpxGps() {
    if (state.watchId !== null && navigator.geolocation) {
      navigator.geolocation.clearWatch(state.watchId);
      state.watchId = null;
    }
    clearGpsWatchdog();
    state.gpsError = '';
    state.gpsStatus = 'idle';
    state.gpxStartWaiting = Boolean(state.pendingGpxStartStrategy);
    if (state.gpxStartWaiting) state.pendingNavigationStart = true;
    setGpxStartFeedback('GPS-locatie opnieuw ophalen…', { loading: true });
    startGpsWatch();
    updateGpxStartChoiceDistances();
  }

  function adjustInstructions(instructions, offset, cutIndex = 0) {
    return (instructions || []).filter(item => !Array.isArray(item.interval) || item.interval[1] >= cutIndex).map(item => {
      if (!Array.isArray(item.interval)) return { ...item };
      return { ...item, interval: [offset + Math.max(0, item.interval[0] - cutIndex), offset + Math.max(0, item.interval[1] - cutIndex)] };
    });
  }

  function trimRouteFromKm(base, locationKm) {
    const coordinates = base.coordinates || [];
    if (coordinates.length < 2) return cloneRouteData(base);
    const cumulative = base.cumulativeKm || buildCumulativeKm(coordinates);
    const totalKm = cumulative[cumulative.length - 1] || 0;
    const clampedKm = Math.max(0, Math.min(totalKm, Number(locationKm) || 0));
    if (clampedKm <= 0.00001) return cloneRouteData(base);

    if (base.components?.length) {
      const clippedComponents = [];
      let rollingStartKm = 0;
      base.components.forEach(component => {
        const localCoordinates = (component.coordinates || []).map(point => [...point]);
        if (localCoordinates.length < 2) return;
        const localCumulative = buildCumulativeKm(localCoordinates);
        const localTotalKm = localCumulative.at(-1) || 0;
        const componentStartKm = Number.isFinite(Number(component.startKm)) ? Number(component.startKm) : rollingStartKm;
        const componentEndKm = Number.isFinite(Number(component.endKm)) ? Number(component.endKm) : componentStartKm + localTotalKm;
        rollingStartKm = componentEndKm;
        if (componentEndKm <= clampedKm + 0.000001) return;

        let keptCoordinates = localCoordinates;
        let keptInstructions = (component.instructions || []).map(item => ({ ...item, interval: Array.isArray(item.interval) ? [...item.interval] : item.interval }));
        let keptFraction = 1;
        if (clampedKm > componentStartKm + 0.000001) {
          const localCutKm = Math.max(0, Math.min(localTotalKm, clampedKm - componentStartKm));
          const nextIndex = Math.max(1, routeIndexAtKm(localCumulative, localCutKm));
          const previousIndex = nextIndex - 1;
          keptCoordinates = splitRouteAtKm(localCoordinates, localCumulative, localCutKm).remaining;
          keptInstructions = adjustInstructions(keptInstructions, 0, previousIndex);
          keptFraction = localTotalKm > 0 ? Math.max(0, (localTotalKm - localCutKm) / localTotalKm) : 1;
        }
        if (keptCoordinates.length < 2) return;
        const geometryDistance = turf.length(turf.lineString(keptCoordinates), { units: 'kilometers' }) * 1000;
        clippedComponents.push({
          ...component,
          coordinates: keptCoordinates,
          distance: geometryDistance,
          time: (Number(component.time) || estimatedComponentTime(Number(component.distance) || localTotalKm * 1000, component.kind)) * keptFraction,
          instructions: keptInstructions,
          startIndex: undefined,
          endIndex: undefined,
          startKm: undefined,
          endKm: undefined
        });
      });
      if (clippedComponents.length) {
        const composed = composeRouteComponents(clippedComponents, { originalParts: base.originalParts || [] });
        return {
          ...cloneRouteData(base),
          ...composed,
          routeMode: base.routeMode,
          toleranceMeters: base.toleranceMeters,
          method: base.method,
          warnings: Array.isArray(base.warnings) ? [...base.warnings] : undefined
        };
      }
    }

    const nextIndex = Math.max(1, routeIndexAtKm(cumulative, clampedKm));
    const previousIndex = nextIndex - 1;
    const segmentStart = cumulative[previousIndex] || 0;
    const segmentEnd = cumulative[nextIndex] || segmentStart;
    const fraction = segmentEnd > segmentStart ? (clampedKm - segmentStart) / (segmentEnd - segmentStart) : 0;
    const from = coordinates[previousIndex];
    const to = coordinates[nextIndex];
    const cut = [from[0] + (to[0] - from[0]) * fraction, from[1] + (to[1] - from[1]) * fraction];
    const remainingCoordinates = [cut, ...coordinates.slice(nextIndex)];
    const remainingFraction = totalKm > 0 ? Math.max(0, (totalKm - clampedKm) / totalKm) : 1;
    return {
      ...cloneRouteData(base),
      coordinates: remainingCoordinates,
      distance: (Number(base.distance) || totalKm * 1000) * remainingFraction,
      time: (Number(base.time) || 0) * remainingFraction,
      instructions: adjustInstructions(base.instructions, 0, previousIndex),
      components: [],
      summary: undefined
    };
  }

  function combineAccessAndGpx(access, remaining) {
    if (!access?.coordinates?.length) return cloneRouteData(remaining);
    if (remaining?.components?.length) {
      const accessComponent = routeResultComponent(access, 'access', 'Aanrijroute naar GPX');
      const composed = composeRouteComponents([accessComponent, ...remaining.components], { originalParts: remaining.originalParts || [] });
      return {
        ...cloneRouteData(remaining),
        ...composed,
        routeMode: remaining.routeMode,
        toleranceMeters: remaining.toleranceMeters,
        method: remaining.method,
        warnings: Array.isArray(remaining.warnings) ? [...remaining.warnings] : undefined
      };
    }
    const accessEnd = access.coordinates.at(-1);
    const gpxStart = remaining.coordinates[0];
    const samePoint = turf.distance(turf.point(accessEnd), turf.point(gpxStart), { units: 'meters' }) < 8;
    const coordinates = access.coordinates.concat(samePoint ? remaining.coordinates.slice(1) : remaining.coordinates);
    const offset = Math.max(0, access.coordinates.length - (samePoint ? 1 : 0));
    return {
      ...cloneRouteData(remaining),
      coordinates,
      distance: (Number(access.distance) || 0) + (Number(remaining.distance) || 0),
      time: (Number(access.time) || 0) + (Number(remaining.time) || 0),
      instructions: adjustInstructions(access.instructions, 0, 0).concat(adjustInstructions(remaining.instructions, offset, 0))
    };
  }

  async function startGpxWithStrategy(strategy) {
    if (state.gpxStartWaiting) return;
    const base = cloneRouteData(state.gpxBaseRoute || state.route);
    if (!base || base.coordinates.length < 2) throw new Error('De GPX-rijroute is niet gereed.');
    state.gpxStartStrategy = strategy;

    if (!state.current || state.gpsStatus !== 'active') {
      state.pendingNavigationStart = true;
      state.pendingGpxStartStrategy = strategy;
      state.gpxStartWaiting = true;
      updateGpxStartButtons();
      setGpxStartFeedback('GPS-locatie ophalen voordat de aanrijroute wordt berekend…', { loading: true });
      startGpsWatch();
      updateGpxStartChoiceDistances();
      return;
    }

    state.gpxStartWaiting = true;
    updateGpxStartButtons();
    setGpxStartFeedback(strategy === 'nearest' ? 'Dichtstbijzijnde instapplek bepalen…' : 'Aanrijroute naar het startpunt berekenen…', { loading: true });
    let remaining = base;
    let joinPoint = base.coordinates[0];
    if (strategy === 'nearest') {
      const nearest = turf.nearestPointOnLine(turf.lineString(base.coordinates), turf.point(state.current), { units: 'kilometers' });
      const locationKm = Number(nearest.properties.location || 0);
      remaining = trimRouteFromKm(base, locationKm);
      joinPoint = remaining.coordinates[0];
    }

    const accessDistance = turf.distance(turf.point(state.current), turf.point(joinPoint), { units: 'kilometers' });
    if (accessDistance > 0.05) {
      const access = await calculateRoute([state.current, joinPoint]);
      drawRoute(combineAccessAndGpx(access, remaining), 'gpx', { skipOverview: true });
    } else {
      drawRoute(remaining, 'gpx', { skipOverview: true });
    }
    state.pendingNavigationStart = false;
    state.pendingGpxStartStrategy = null;
    state.gpxStartWaiting = false;
    closeGpxStartSheet({ cancelPending: false });
    beginGpsNavigation();
  }

  async function startNavigation() {
    if (state.gpxDocument) {
      if (!state.gpxRoutePrepared) {
        openGpxRouteMode({ startAfterSuccess: true });
        return;
      }
      if (!state.route || state.route.coordinates.length < 2) {
        return status('De GPX kon niet als rijroute worden opgebouwd.', { error: true });
      }
      if (isDesktop()) {
        drawRoute(cloneRouteData(state.gpxBaseRoute || state.route), 'gpx', { skipOverview: true });
        if ($('developerPanel')) $('developerPanel').hidden = false;
        return;
      }
      openGpxStartSheet();
      return;
    }

    if (!state.route || state.route.coordinates.length < 2) {
      return status('Bereken eerst een route.', { error: true });
    }
    if (isDesktop()) {
      if ($('developerPanel')) $('developerPanel').hidden = false;
      return;
    }
    if (state.watchId !== null && state.current && state.gpsStatus === 'active') {
      beginGpsNavigation();
      return;
    }
    state.pendingNavigationStart = true;
    startGpsWatch();
    renderGpsIndicator();
  }

  function updateNavigation(point, speedMps, heading, knownProgressKm) {
    if ($('devSpeed')) $('devSpeed').textContent = `${Math.round(speedMps * 3.6)} km/u`;
    if (!state.navigationActive || state.navigationPaused) return;
    if (!state.route || state.route.coordinates.length < 2) return;

    const line = turf.lineString(state.route.coordinates);
    const cumulative = state.route.cumulativeKm || buildCumulativeKm(state.route.coordinates);
    const geometryTotalKm = Math.max(0.001, state.route.totalKm || cumulative[cumulative.length - 1] || turf.length(line, { units: 'kilometers' }));
    let snappedLocation;
    let routePointIndex;
    let offKm;

    if (Number.isFinite(knownProgressKm)) {
      snappedLocation = Math.max(0, Math.min(geometryTotalKm, Number(knownProgressKm)));
      routePointIndex = routeIndexAtKm(cumulative, snappedLocation);
      offKm = 0;
    } else {
      const snap = turf.nearestPointOnLine(line, turf.point(point), { units: 'kilometers' });
      snappedLocation = Number(snap.properties.location || 0);
      routePointIndex = Number(snap.properties.index || 0);
      offKm = turf.distance(turf.point(point), snap, { units: 'kilometers' });
    }

    state.progressKm = Math.max(state.progressKm, snappedLocation);
    updateRouteProgress(state.progressKm);
    if ($('devOffRoute')) $('devOffRoute').textContent = `${Math.round(offKm * 1000)} m`;

    const percentage = Math.min(100, Math.round(state.progressKm / geometryTotalKm * 100));
    if ($('devProgress')) $('devProgress').textContent = `${percentage}%`;
    const remainingFraction = Math.max(0, (geometryTotalKm - state.progressKm) / geometryTotalKm);
    const remainingMeters = Math.max(0, state.route.distance * remainingFraction);
    const estimatedTime = state.route.time > 0
      ? state.route.time * remainingFraction
      : (geometryTotalKm * remainingFraction) / (state.profile === 'bike' ? 22 : state.profile === 'foot' ? 5 : 70) * 3600000;
    setRemaining(fmtDistance(remainingMeters), fmtDuration(estimatedTime));

    updateInstructionByIndex(routePointIndex);

    if (state.autoFollow && (state.follow || speedMps > 1.2 || state.simulation.playing)) {
      state.follow = true;
      const derivedHeading = Number.isFinite(heading) ? heading : bearingAlongRoute(line, state.progressKm);
      const mapHeight = Math.max(300, map.getContainer().clientHeight || window.innerHeight);
      const offsetY = isDesktop() ? 0 : Math.min(185, Math.round(mapHeight * 0.24));
      map.easeTo({
        center: point,
        zoom: 15.8,
        pitch: 55,
        bearing: derivedHeading,
        offset: [0, offsetY],
        padding: { top: 12, bottom: 12, left: 12, right: 12 },
        duration: 330
      });
    }

    const activeComponent = routeComponentAtKm(state.progressKm);
    const exactGpxSection = state.mode === 'gpx' && ['exact', 'unresolved'].includes(activeComponent?.kind);
    if (exactGpxSection) {
      // Op een exact/offroad GPX-deel blijft het spoor leidend. De app stuurt de rijder
      // hier niet automatisch terug naar het gewone wegennet.
      state.offCount = 0;
    } else if ((state.mode === 'address' || state.mode === 'gpx') && offKm > 0.065) {
      state.offCount += 1;
    } else {
      state.offCount = 0;
    }
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

  function buildCumulativeKm(coordinates) {
    const values = [0];
    for (let i = 1; i < coordinates.length; i += 1) {
      values.push(values[i - 1] + turf.distance(turf.point(coordinates[i - 1]), turf.point(coordinates[i]), { units: 'kilometers' }));
    }
    return values;
  }

  function cumulativeRouteKm() {
    return state.route?.cumulativeKm || buildCumulativeKm(state.route?.coordinates || []);
  }



  function translateInstruction(text) {
    let value = String(text || 'Volg de route').trim();
    const replacements = [
      [/\bkeep left\b/gi, 'houd links aan'],
      [/\bkeep right\b/gi, 'houd rechts aan'],
      [/\bturn slight left\b/gi, 'ga schuin links'],
      [/\bturn slight right\b/gi, 'ga schuin rechts'],
      [/\bturn left\b/gi, 'sla linksaf'],
      [/\bturn right\b/gi, 'sla rechtsaf'],
      [/\bcontinue straight\b/gi, 'ga rechtdoor'],
      [/\bcontinue\b/gi, 'ga verder'],
      [/\band take\b/gi, 'en neem'],
      [/\btake\b/gi, 'neem'],
      [/\btoward\b/gi, 'richting'],
      [/\bat the roundabout\b/gi, 'op de rotonde'],
      [/\btake the (\d+)(?:st|nd|rd|th) exit\b/gi, 'neem de $1e afslag'],
      [/\bmake a u-turn\b/gi, 'keer om'],
      [/\barrive at destination\b/gi, 'bestemming bereikt']
    ];
    replacements.forEach(([pattern, replacement]) => { value = value.replace(pattern, replacement); });
    return value ? value.charAt(0).toUpperCase() + value.slice(1) : 'Volg de route';
  }



  function normalizeTurnText(text) {
    return String(text || '').toLocaleLowerCase('nl-NL').replace(/\s+/g, ' ').trim();
  }

  function maneuverSignFromText(text) {
    const value = normalizeTurnText(text);
    if (!value) return null;
    if (/bestemming bereikt|arrive at destination|aangekomen/.test(value)) return 4;
    if (/keer om|u-turn|u turn/.test(value)) return 8;
    if (/rotonde|roundabout/.test(value)) return 6;
    if (/houd links aan|links aanhouden|keep left/.test(value)) return -7;
    if (/houd rechts aan|rechts aanhouden|keep right/.test(value)) return 7;
    if (/scherp links|sharp left/.test(value)) return -3;
    if (/scherp rechts|sharp right/.test(value)) return 3;
    if (/schuin links|slight left/.test(value)) return -1;
    if (/schuin rechts|slight right/.test(value)) return 1;
    if (/linksaf|sla links|turn left|naar links/.test(value)) return -2;
    if (/rechtsaf|sla rechts|turn right|naar rechts/.test(value)) return 2;
    return null;
  }

  function resolvedManeuverSign(sign, text) {
    const numeric = Number(sign);
    const textSign = maneuverSignFromText(text);
    // GraphHopper gebruikt -7/7 voor links/rechts aanhouden. Bij oudere of
    // onvolledige antwoorden kan de tekst richting geven terwijl sign 0 blijft.
    if (textSign !== null && (!Number.isFinite(numeric) || numeric === 0 || Math.abs(textSign) === 7)) return textSign;
    return Number.isFinite(numeric) ? numeric : (textSign ?? 0);
  }

  function maneuverSymbol(sign, text = '') {
    const resolved = resolvedManeuverSign(sign, text);
    const symbols = {
      '-99': '?', '-98': '↶', '-8': '↶', '-7': '↖', '-6': '↗',
      '-3': '↙', '-2': '←', '-1': '↖', '0': '↑',
      '1': '↗', '2': '→', '3': '↘', '4': '🏁', '5': '🏁',
      '6': '↻', '7': '↗', '8': '↷', '9': '⛴'
    };
    return symbols[String(resolved)] || '↑';
  }

  function isUpcomingTurn(sign, text) {
    const resolved = resolvedManeuverSign(sign, text);
    return [-8, -7, -6, -3, -2, -1, 1, 2, 3, 6, 7, 8].includes(resolved);
  }

  function updateTurnAlert(distanceM, instruction) {
    const element = $('turnAlert');
    if (!element) return;
    if (Number.isFinite(distanceM) && instruction) {
      state.nextManeuver = {
        distanceM,
        sign: resolvedManeuverSign(instruction.sign, instruction.text),
        text: translateInstruction(instruction.text)
      };
    }
    const next = state.nextManeuver;
    const visible = Boolean(
      state.navigationActive
      && !state.navigationPaused
      && next
      && next.distanceM > 8
      && next.distanceM <= 500
      && isUpcomingTurn(next.sign, next.text)
    );
    element.hidden = !visible;
    if (!visible) return;
    element.setAttribute('aria-label', `${next.text} over ${fmtDistance(next.distanceM)}`);
    element.title = `${next.text} over ${fmtDistance(next.distanceM)}`;
  }

  function updateInstructionByIndex(index) {
    const instructions = state.route?.instructions || [];
    if (!instructions.length) {
      const text = state.mode === 'gpx' ? 'Volg de GPX-route' : 'Volg de route';
      $('instruction').textContent = text;
      $('nextDistance').textContent = state.mode === 'gpx' ? 'Op route' : 'Nu';
      if ($('devInstruction')) $('devInstruction').textContent = text;
      $('maneuverIcon').textContent = '↑';
      state.nextManeuver = null;
      updateTurnAlert();
      return;
    }

    const cumulative = cumulativeRouteKm();
    const progressKm = Math.max(0, Number(state.progressKm) || 0);
    const passToleranceKm = 0.012;
    const enriched = instructions.map((item, order) => {
      const targetIndex = Math.min(cumulative.length - 1, Math.max(0, Number(item.interval?.[0] ?? index)));
      return { item, order, targetIndex, startKm: cumulative[targetIndex] || 0 };
    });

    let selected = enriched.find(entry => entry.startKm >= progressKm - passToleranceKm);
    if (!selected) selected = enriched[enriched.length - 1];

    // Een puur 'rechtdoor'-segment vlak voor een echte splitsing is visueel
    // minder belangrijk. Toon dan alvast de eerstvolgende echte manoeuvre.
    if (resolvedManeuverSign(selected.item.sign, selected.item.text) === 0) {
      const nextAction = enriched.slice(selected.order + 1).find(entry => isUpcomingTurn(entry.item.sign, entry.item.text));
      if (nextAction) selected = nextAction;
    }

    const upcoming = selected.item;
    const distanceM = Math.max(0, (selected.startKm - progressKm) * 1000);
    const text = translateInstruction(upcoming.text);
    $('instruction').textContent = text;
    $('nextDistance').textContent = distanceM < 15 ? 'Nu' : `Over ${fmtDistance(distanceM)}`;
    if ($('devInstruction')) $('devInstruction').textContent = text;
    $('maneuverIcon').textContent = maneuverSymbol(upcoming.sign, text);
    updateTurnAlert(distanceM, upcoming);
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
    if (!routes[0]) return status('Geen geschikte aansluiting gevonden.', { error: true });
    setLineSource('rejoin-casing', routes[0].route.coordinates);
    setLineSource('rejoin-route', routes[0].route.coordinates);
    status(`Aansluitroute: ${fmtDistance(routes[0].route.distance)}`);
  }

  function nodeCoordinates(nodes) {
    return Array.from(nodes).map(node => [Number(node.getAttribute('lon')), Number(node.getAttribute('lat'))])
      .filter(([lng, lat]) => Number.isFinite(lng) && Number.isFinite(lat));
  }

  function parseGpx(xml) {
    const parts = [];
    Array.from(xml.querySelectorAll('trk')).forEach((track, trackIndex) => {
      const trackName = track.querySelector(':scope > name')?.textContent?.trim() || `Track ${trackIndex + 1}`;
      Array.from(track.querySelectorAll(':scope > trkseg')).forEach((segment, segmentIndex) => {
        const coordinates = nodeCoordinates(segment.querySelectorAll(':scope > trkpt'));
        if (coordinates.length >= 2) {
          parts.push({
            id: `trk-${trackIndex + 1}-${segmentIndex + 1}`,
            coordinates,
            name: trackName,
            type: 'tracksegment',
            trackIndex: trackIndex + 1,
            explicitIndex: segmentIndex + 1
          });
        }
      });
    });
    Array.from(xml.querySelectorAll('rte')).forEach((route, routeIndex) => {
      const name = route.querySelector(':scope > name')?.textContent?.trim() || `Route ${routeIndex + 1}`;
      const coordinates = nodeCoordinates(route.querySelectorAll(':scope > rtept'));
      if (coordinates.length >= 2) {
        parts.push({ id: `rte-${routeIndex + 1}`, coordinates, name, type: 'route', explicitIndex: routeIndex + 1 });
      }
    });
    if (!parts.length) {
      const coordinates = nodeCoordinates(xml.querySelectorAll('trkpt, rtept'));
      if (coordinates.length >= 2) parts.push({ id: 'gpx-1', coordinates, name: 'GPX-route', type: 'unknown', explicitIndex: 1 });
    }
    return { parts };
  }



  function median(values) {
    if (!values.length) return 0;
    const sorted = [...values].sort((a,b) => a-b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function analyseGpxParts(parts, jumpThresholdMeters = 5000) {
    const colors = ['#2563eb','#dc2626','#16a34a','#9333ea','#ea580c','#0891b2','#be123c','#65a30d','#4f46e5','#c026d3'];
    const segments = [];
    const jumpThresholdKm = jumpThresholdMeters > 0 ? jumpThresholdMeters / 1000 : Infinity;

    parts.forEach((part, partIndex) => {
      if (!part.coordinates?.length) return;
      const partName = part.sourceFile
        ? (part.name && part.name !== part.sourceFile ? `${part.sourceFile} · ${part.name}` : part.sourceFile)
        : (part.name || `Traject ${partIndex + 1}`);
      let current = [part.coordinates[0]];
      let reason = part.type === 'tracksegment' ? 'GPX-tracksegment' : part.type === 'route' ? 'GPX-route' : 'GPX-punten';

      for (let i = 1; i < part.coordinates.length; i += 1) {
        const gapKm = turf.distance(turf.point(part.coordinates[i - 1]), turf.point(part.coordinates[i]), { units: 'kilometers' });
        if (gapKm > jumpThresholdKm) {
          if (current.length >= 2) {
            segments.push({ coordinates: current, name: partName, reason: `${reason}; verbindingssprong van ${gapKm.toFixed(1)} km`, sourcePartIndex: partIndex });
          }
          current = [part.coordinates[i]];
          reason = 'Na gedetecteerde verbindingssprong';
        } else {
          current.push(part.coordinates[i]);
        }
      }
      if (current.length >= 2) segments.push({ coordinates: current, name: partName, reason, sourcePartIndex: partIndex });
    });

    return segments.map((segment, index) => ({
      ...segment,
      id: index + 1,
      color: colors[index % colors.length],
      distanceKm: turf.length(turf.lineString(segment.coordinates), { units: 'kilometers' })
    }));
  }



  function analysisMapPadding() {
    const sheet = $('gpxAnalysisSheet');
    if (isDesktop()) {
      const width = sheet && !sheet.hidden ? Math.min(520, sheet.offsetWidth || 440) : 0;
      return { top: 70, bottom: 70, left: 70, right: width + 42 };
    }
    const height = sheet && !sheet.hidden ? Math.min(window.innerHeight * 0.62, sheet.offsetHeight || window.innerHeight * 0.55) : 0;
    return { top: 70, bottom: Math.round(height + 28), left: 28, right: 28 };
  }

  function showGpxAnalysisOnMap(options = {}) {
    const source = map.getSource('gpx-analysis');
    if (!source) return;
    const features = state.gpxAnalysis.segments.map(segment => turf.lineString(segment.coordinates, {
      segmentId: segment.id,
      color: segment.color,
      name: segment.name,
      selected: state.gpxAnalysis.selectedIds.has(segment.id)
    }));
    source.setData(turf.featureCollection(features));
    clearGpxPreview();
    setLineSource('route-casing', []);
    setLineSource('route-traveled', []);
    setLineSource('route-remaining', []);
    if (options.fit !== false && features.length) {
      const bounds = new maplibregl.LngLatBounds();
      state.gpxAnalysis.segments.forEach(segment => segment.coordinates.forEach(point => bounds.extend(point)));
      map.fitBounds(bounds, { padding: analysisMapPadding(), duration: 500, maxZoom: 15, bearing: 0, pitch: 0 });
    }
  }

  function hideGpxAnalysisOnMap() {
    map.getSource('gpx-analysis')?.setData(emptyGeoJson());
    if (state.route) updateRouteProgress(state.progressKm || 0);
    else if (state.gpxDocument) setGpxPreview(state.gpxDocument.parts);
  }



  function markGpxSelectionChanged() {
    const selectedIds = selectedGpxSegments().map(segment => String(segment.id)).sort();
    const activeIds = (state.gpxActiveSegmentIds || []).map(id => String(id)).sort();
    const matchesActive = selectedIds.length === activeIds.length && selectedIds.every((id, index) => id === activeIds[index]);
    if (matchesActive) return;

    invalidatePreparedGpx();
    state.gpxActiveSegmentIds = [];
    if (state.gpxDocument && !state.gpxEditor.active) {
      state.route = null;
      state.original = [];
      state.mode = 'gpx-document';
      state.progressKm = 0;
      ['route-casing','route-traveled','route-remaining','rejoin-casing','rejoin-route'].forEach(id => setLineSource(id, []));
      setGpxPreview(state.gpxDocument.parts);
      const ordered = orderedGpxSegmentsForJoin(selectedGpxSegments());
      const first = ordered[0]?.coordinates?.[0];
      const last = ordered.at(-1)?.coordinates?.at(-1);
      if (first) { state.startPoint = first; setMarker('start', first); }
      if (last) { state.destinationPoint = last; setMarker('destination', last); }
    }
  }

  function updateGpxAnalysisSelectionUi() {
    const count = state.gpxAnalysis.selectedIds.size;
    if ($('gpxSegmentSelectionCount')) $('gpxSegmentSelectionCount').textContent = count
      ? `${count} traject${count === 1 ? '' : 'en'} geselecteerd`
      : 'Geen trajecten geselecteerd';
    if ($('exportSelectedGpxSegments')) $('exportSelectedGpxSegments').disabled = count === 0;
    if ($('useSelectedGpxSegment')) {
      const button = $('useSelectedGpxSegment');
      button.disabled = count === 0 || state.gpxRoutePreparing;
      button.textContent = state.gpxRoutePreparing
        ? (state.gpxPrepareProgress || 'Rijroute maken…')
        : count > 1
          ? `Maak 1 rijroute van ${count} trajecten`
          : 'Maak rijroute van traject';
    }
    if ($('editSelectedGpxSegment')) $('editSelectedGpxSegment').disabled = count !== 1 || state.gpxRoutePreparing;
  }



  function zoomToGpxSegment(segment) {
    const bounds = new maplibregl.LngLatBounds();
    segment.coordinates.forEach(point => bounds.extend(point));
    map.fitBounds(bounds, { padding: analysisMapPadding(), duration: 400, maxZoom: 16, bearing: 0, pitch: 0 });
  }

  function renderGpxAnalysis() {
    const list = $('gpxAnalysisList');
    if (!list) return;
    const segments = state.gpxAnalysis.segments;
    const thresholdDescription = state.gpxAnalysis.jumpThresholdMeters === 0
      ? 'Automatisch opknippen op verbindingssprongen staat uit.'
      : `Er wordt geknipt wanneer de rechte afstand tussen twee opeenvolgende GPX-punten groter is dan ${state.gpxAnalysis.jumpThresholdMeters.toLocaleString('nl-NL')} meter.`;
    const editInstruction = state.gpxAnalysis.intent === 'edit'
      ? ' Selecteer precies één traject en kies daarna Bewerk geselecteerd.'
      : '';
    $('gpxAnalysisSummary').textContent = segments.length === 1
      ? `Er is één doorlopend traject gevonden. ${thresholdDescription}${editInstruction || ' Je kunt dit traject direct omzetten naar een rijroute.'}`
      : `${segments.length} afzonderlijke trajecten gevonden. ${thresholdDescription}${editInstruction || ' Selecteer één of meer trajecten; joepjoepGO legt ze afzonderlijk op het wegennet en berekent de ontbrekende verbindingen ertussen.'}`;
    list.innerHTML = '';
    segments.forEach(segment => {
      const row = document.createElement('div');
      row.className = 'gpx-analysis-row';
      row.dataset.segmentId = String(segment.id);
      const checked = state.gpxAnalysis.selectedIds.has(segment.id);
      row.innerHTML = `<label class="gpx-segment-check" title="Selecteer traject"><input type="checkbox" ${checked ? 'checked' : ''} aria-label="Selecteer traject ${segment.id}"><span></span></label><span class="gpx-color-dot" style="background:${segment.color}"></span><div class="gpx-analysis-info"><strong>Traject ${segment.id}</strong><small>${escapeXml(segment.name)} · ${segment.distanceKm.toFixed(1)} km · ${segment.coordinates.length} punten</small><small>${escapeXml(segment.reason)}</small></div><div class="gpx-analysis-row-actions"><button class="icon-button edit-segment" title="Bewerk dit traject">✎</button><button class="icon-button zoom-segment" title="Toon op kaart">⌖</button><button class="icon-button export-segment" title="Exporteer apart">⇩</button></div>`;
      const checkbox = row.querySelector('input[type="checkbox"]');
      checkbox.onchange = () => {
        if (checkbox.checked) state.gpxAnalysis.selectedIds.add(segment.id);
        else state.gpxAnalysis.selectedIds.delete(segment.id);
        row.classList.toggle('selected', checkbox.checked);
        markGpxSelectionChanged();
        updateGpxAnalysisSelectionUi();
        renderUi();
      };
      row.classList.toggle('selected', checked);
      row.querySelector('.edit-segment').onclick = event => { event.stopPropagation(); editGpxSegment(segment); };
      row.querySelector('.zoom-segment').onclick = event => { event.stopPropagation(); zoomToGpxSegment(segment); };
      row.querySelector('.export-segment').onclick = event => { event.stopPropagation(); exportGpxSegment(segment); };
      row.querySelector('.gpx-analysis-info').onclick = () => zoomToGpxSegment(segment);
      list.appendChild(row);
    });
    updateGpxAnalysisSelectionUi();
  }

  function readGpxJumpThreshold() {
    const input = $('gpxJumpThreshold');
    const value = Number(input?.value);
    if (!Number.isFinite(value) || value < 0) throw new Error('Vul een geldige afstand van 0 meter of meer in.');
    return Math.round(value);
  }

  function rerunGpxAnalysis() {
    if (!state.gpxAnalysis.sourceParts.length) return status('Laad eerst een GPX-bestand.', { error: true });
    try {
      state.gpxAnalysis.jumpThresholdMeters = readGpxJumpThreshold();
    } catch (error) {
      return status(error.message, { error: true });
    }
    persistSettings();
    state.gpxAnalysis.segments = analyseGpxParts(state.gpxAnalysis.sourceParts, state.gpxAnalysis.jumpThresholdMeters);
    state.gpxAnalysis.selectedIds = state.gpxAnalysis.intent === 'edit'
      ? new Set()
      : new Set(state.gpxAnalysis.segments.map(segment => segment.id));
    invalidatePreparedGpx();
    state.gpxActiveSegmentIds = [];
    renderGpxAnalysis();
    showGpxAnalysisOnMap();
    renderUi();
    const thresholdText = state.gpxAnalysis.jumpThresholdMeters === 0
      ? 'zonder automatische knipgrens'
      : `met een knipgrens van ${state.gpxAnalysis.jumpThresholdMeters.toLocaleString('nl-NL')} meter`;
    status(`${state.gpxAnalysis.segments.length} traject${state.gpxAnalysis.segments.length === 1 ? '' : 'en'} gevonden ${thresholdText}.`);
  }




  function syncBackdrop() {
    const backdrop = $('backdrop');
    if (!backdrop) return;
    const modalOpen = Boolean(
      ($('settingsSheet') && !$('settingsSheet').hidden)
      || ($('fuelSheet') && !$('fuelSheet').hidden)
      || ($('gpxStartSheet') && !$('gpxStartSheet').hidden)
      || ($('gpxRouteModeSheet') && !$('gpxRouteModeSheet').hidden)
      || (!isDesktop() && $('gpxEditorSheet') && !$('gpxEditorSheet').hidden)
      || (!isDesktop() && $('gpxAnalysisSheet') && !$('gpxAnalysisSheet').hidden)
    );
    backdrop.hidden = !modalOpen;
  }

  function openGpxAnalysis(options = {}) {
    if (!state.gpxAnalysis.sourceParts.length) return status('Laad eerst een GPX-bestand.', { error: true });
    closeGpxEditor();
    state.gpxAnalysis.active = true;
    state.gpxAnalysis.intent = options.intent || null;
    $('gpxAnalysisSheet').hidden = false;
    $('backdrop').hidden = isDesktop();
    if ($('gpxJumpThreshold')) $('gpxJumpThreshold').value = String(state.gpxAnalysis.jumpThresholdMeters);

    if (!state.gpxAnalysis.segments.length) {
      rerunGpxAnalysis();
    } else {
      if (state.gpxAnalysis.intent === 'edit') {
        const activeSegment = state.gpxActiveSegmentIds.length === 1
          ? state.gpxAnalysis.segments.find(segment => String(segment.id) === String(state.gpxActiveSegmentIds[0]))
          : null;
        if (activeSegment) state.gpxAnalysis.selectedIds = new Set([activeSegment.id]);
        else if (state.gpxAnalysis.segments.length === 1) state.gpxAnalysis.selectedIds = new Set([state.gpxAnalysis.segments[0].id]);
      }
      renderGpxAnalysis();
      showGpxAnalysisOnMap();
      renderUi();
    }
    window.requestAnimationFrame(() => map.resize());
  }



  function closeGpxAnalysis() {
    state.gpxAnalysis.active = false;
    state.gpxAnalysis.intent = null;
    if ($('gpxAnalysisSheet')) $('gpxAnalysisSheet').hidden = true;
    hideGpxAnalysisOnMap();
    if ($('settingsSheet')?.hidden && $('fuelSheet')?.hidden && $('gpxEditorSheet')?.hidden) $('backdrop').hidden = true;
    window.requestAnimationFrame(() => map.resize());
  }



  function segmentGpxXml(segment) {
    const trackPoints = segment.coordinates.map(point => `      <trkpt lat="${point[1].toFixed(7)}" lon="${point[0].toFixed(7)}"></trkpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${APP_NAME} v${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml(state.gpxEditor.fileName)} - traject ${segment.id}</name></metadata>\n  <trk><name>${escapeXml(segment.name)} - traject ${segment.id}</name><trkseg>\n${trackPoints}\n  </trkseg></trk>\n</gpx>`;
  }



  function downloadText(text, fileName) {
    const blob = new Blob([text], { type: 'application/gpx+xml;charset=utf-8' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }

  function exportGpxSegment(segment) {
    const base = state.gpxEditor.fileName.replace(/\.gpx$/i,'') || 'route';
    downloadText(segmentGpxXml(segment), `${base}-traject-${segment.id}.gpx`);
    status(`Traject ${segment.id} geëxporteerd.`);
  }

  function exportAllGpxSegments() {
    state.gpxAnalysis.segments.forEach((segment, index) => setTimeout(() => exportGpxSegment(segment), index * 250));
  }

  function selectedGpxXml(segments) {
    const baseName = state.gpxEditor.fileName.replace(/\.gpx$/i, '') || 'route';
    const trackSegments = segments.map(segment => {
      const points = segment.coordinates.map(point => `      <trkpt lat="${point[1].toFixed(7)}" lon="${point[0].toFixed(7)}"></trkpt>`).join('\n');
      return `    <trkseg>\n${points}\n    </trkseg>`;
    }).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${APP_NAME} v${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml(baseName)} - samengestelde selectie</name></metadata>\n  <trk><name>${escapeXml(baseName)} - samengestelde selectie</name>\n${trackSegments}\n  </trk>\n</gpx>`;
  }



  function exportSelectedGpxSegments() {
    const selected = state.gpxAnalysis.segments.filter(segment => state.gpxAnalysis.selectedIds.has(segment.id));
    if (!selected.length) return status('Selecteer eerst minimaal één traject.', { error: true });
    const base = state.gpxEditor.fileName.replace(/\.gpx$/i,'') || 'route';
    downloadText(selectedGpxXml(selected), `${base}-selectie-${selected.length}-trajecten.gpx`);
    status(`${selected.length} traject${selected.length === 1 ? '' : 'en'} samengevoegd in één GPX.`);
  }

  function selectAllGpxSegments() {
    state.gpxAnalysis.selectedIds = new Set(state.gpxAnalysis.segments.map(segment => segment.id));
    markGpxSelectionChanged();
    renderGpxAnalysis();
    renderUi();
  }

  function clearGpxSegmentSelection() {
    state.gpxAnalysis.selectedIds.clear();
    markGpxSelectionChanged();
    renderGpxAnalysis();
    renderUi();
  }



  function activateGpxSegment(segment, options = {}) {
    if (!segment || !Array.isArray(segment.coordinates) || segment.coordinates.length < 2) {
      return status('Dit traject bevat te weinig punten.', { error: true });
    }
    const coordinates = segment.coordinates.map(point => [...point]);
    invalidatePreparedGpx();
    state.gpxActiveSegmentIds = segment.id !== undefined ? [segment.id] : [];
    const distance = turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000;
    initialiseGpxEditorCoordinates(coordinates);
    drawRoute({ coordinates, distance, time: 0, instructions: [] }, 'gpx', { skipOverview: options.skipOverview === true });
    renderUi();
    if (!options.skipOverview) showOverview();
  }

  async function useSelectedGpxSegment() {
    await prepareSelectedGpxSegments();
  }

  function editGpxSegment(segment) {
    if (!segment) return;
    activateGpxSegment(segment, { skipOverview: true });
    closeGpxAnalysis();
    openGpxEditor();
  }

  function editSelectedGpxSegment() {
    const selected = state.gpxAnalysis.segments.filter(segment => state.gpxAnalysis.selectedIds.has(segment.id));
    if (selected.length !== 1) return status('Selecteer precies één traject om te bewerken.', { error: true });
    editGpxSegment(selected[0]);
  }

  function gpxPointFeatures() {
    if (!state.gpxEditor.active) return [];
    const coordinates = state.gpxEditor.editCoordinates;
    const selected = state.gpxEditor.selectedIndices;
    if (!coordinates.length) return [];
    const maxVisible = isMobileDevice() ? 850 : 1400;
    const bounds = map.getBounds?.();
    const inView = [];
    coordinates.forEach((coordinate, index) => {
      if (!bounds || bounds.contains(coordinate)) inView.push(index);
    });
    const candidates = inView.length ? inView : coordinates.map((_, index) => index);
    const step = Math.max(1, Math.ceil(candidates.length / maxVisible));
    const indices = new Set([0, coordinates.length - 1, ...selected]);
    for (let index = 0; index < candidates.length; index += step) indices.add(candidates[index]);
    return [...indices]
      .sort((a, b) => a - b)
      .filter(index => coordinates[index])
      .map(index => turf.point(coordinates[index], { index, selected: selected.has(index), role: index === 0 ? 'start' : index === coordinates.length - 1 ? 'end' : 'point' }));
  }



  function updateGpxPointLayer() {
    const source = map.getSource('gpx-edit-points');
    if (source) source.setData(turf.featureCollection(gpxPointFeatures()));
    const selected = [...state.gpxEditor.selectedIndices].sort((a, b) => a - b);
    const count = selected.length;
    const pointCount = state.gpxEditor.editCoordinates.length;
    const last = pointCount - 1;
    const removable = selected.filter(index => index >= 0 && index < last);
    if ($('gpxSelectionCount')) $('gpxSelectionCount').textContent = count ? `${count} punt${count === 1 ? '' : 'en'} geselecteerd` : 'Geen punten geselecteerd';
    if ($('deleteSelectedGpx')) $('deleteSelectedGpx').disabled = removable.length === 0 || pointCount - removable.length < 2;
    if ($('clearGpxPointSelection')) $('clearGpxPointSelection').disabled = count === 0;
    if ($('moveGpxPointUp')) $('moveGpxPointUp').disabled = count === 0 || selected.some(index => index <= 0 || index >= last || index - 1 >= last);
    if ($('moveGpxPointDown')) $('moveGpxPointDown').disabled = count === 0 || selected.some(index => index < 0 || index >= last - 1 || index + 1 >= last);
    if ($('setGpxStartPoint')) $('setGpxStartPoint').disabled = count !== 1 || selected[0] === 0 || selected[0] === last;
    if ($('undoGpx')) $('undoGpx').disabled = !Array.isArray(state.gpxEditor.history) || state.gpxEditor.history.length === 0;
  }

  function removeSelectedMarker() {
    if (state.gpxEditor.selectedMarker) state.gpxEditor.selectedMarker.remove();
    state.gpxEditor.selectedMarker = null;
  }


  function pushGpxHistory() {
    if (!Array.isArray(state.gpxEditor.history)) state.gpxEditor.history = [];
    const snapshot = state.gpxEditor.editCoordinates.map(point => [...point]);
    const last = state.gpxEditor.history[state.gpxEditor.history.length - 1];
    const unchanged = last && last.length === snapshot.length && last.every((point, index) =>
      point[0] === snapshot[index][0] && point[1] === snapshot[index][1]
    );
    if (!unchanged) {
      state.gpxEditor.history.push(snapshot);
      const maxEntries = snapshot.length > 5000 ? 5 : 12;
      if (state.gpxEditor.history.length > maxEntries) state.gpxEditor.history.shift();
    }
    if ($('undoGpx')) $('undoGpx').disabled = state.gpxEditor.history.length === 0;
  }

  function undoGpx() {
    const snapshot = state.gpxEditor.history.pop();
    if (!snapshot) return status('Er is niets om ongedaan te maken.', { error: true });
    state.gpxEditor.editCoordinates = snapshot.map(point => [...point]);
    state.gpxEditor.selectedIndices.clear();
    removeSelectedMarker();
    drawEditedGpx();
    renderGpxEditorList();
    status('Laatste GPX-wijziging ongedaan gemaakt.');
  }

  function selectGpxIndices(indices, additive = false) {
    if (!additive) state.gpxEditor.selectedIndices.clear();
    indices.forEach(index => {
      if (index >= 0 && index < state.gpxEditor.editCoordinates.length) state.gpxEditor.selectedIndices.add(index);
    });
    removeSelectedMarker();
    if (state.gpxEditor.selectedIndices.size === 1) {
      const index = [...state.gpxEditor.selectedIndices][0];
      const marker = new maplibregl.Marker({ draggable: true, color: '#dc2626' })
        .setLngLat(state.gpxEditor.editCoordinates[index])
        .addTo(map);
      marker.on('dragstart', pushGpxHistory);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        state.gpxEditor.editCoordinates[index] = [p.lng, p.lat];
        invalidatePreparedGpx();
        drawEditedGpx();
        renderGpxEditorList();
      });
      state.gpxEditor.selectedMarker = marker;
    }
    updateGpxPointLayer();
    renderGpxEditorList();
  }

  function renderGpxEditorList() {
    const list = $('gpxPointList');
    if (!list) return;
    list.innerHTML = '';
    const points = state.gpxEditor.editCoordinates;
    const selected = state.gpxEditor.selectedIndices;
    const visibleIndices = new Set([0, points.length - 1, ...selected]);
    if (points.length <= 40) points.forEach((_, index) => visibleIndices.add(index));
    else {
      const step = Math.max(1, Math.ceil(points.length / 18));
      for (let i = 0; i < points.length; i += step) visibleIndices.add(i);
    }
    [...visibleIndices].sort((a,b) => a-b).forEach(index => {
      const point = points[index];
      if (!point) return;
      const row = document.createElement('div');
      row.className = `gpx-point-row${selected.has(index) ? ' is-selected' : ''}`;
      row.innerHTML = `<span class="gpx-point-number">${index + 1}</span><span class="gpx-point-coordinates"><strong>${index === 0 ? 'Startpunt' : index === points.length - 1 ? 'Eindpunt' : `Routepunt ${index + 1}`}</strong><br>${point[1].toFixed(5)}, ${point[0].toFixed(5)}</span>`;
      const actions = document.createElement('span');
      actions.className = 'gpx-point-row-actions';
      const up = document.createElement('button');
      up.className = 'gpx-point-move';
      up.textContent = '↑';
      up.title = 'Punt eerder in de route';
      up.disabled = index <= 0 || index >= points.length - 1;
      up.addEventListener('click', event => {
        event.stopPropagation();
        selectGpxIndices([index]);
        moveSelectedGpxPoint(-1);
      });
      const down = document.createElement('button');
      down.className = 'gpx-point-move';
      down.textContent = '↓';
      down.title = 'Punt later in de route';
      down.disabled = index >= points.length - 2;
      down.addEventListener('click', event => {
        event.stopPropagation();
        selectGpxIndices([index]);
        moveSelectedGpxPoint(1);
      });
      const makeStart = document.createElement('button');
      makeStart.className = 'gpx-point-start';
      makeStart.textContent = '⚑';
      makeStart.title = index === 0 ? 'Dit is het startpunt' : 'Maak dit punt het startpunt';
      makeStart.disabled = index === 0 || index === points.length - 1;
      makeStart.addEventListener('click', event => {
        event.stopPropagation();
        selectGpxIndices([index]);
        setSelectedAsGpxStart();
      });
      const remove = document.createElement('button');
      remove.className = 'gpx-point-remove';
      remove.textContent = '×';
      remove.title = index === 0 ? 'Verwijder huidig startpunt' : 'Verwijder punt';
      remove.disabled = index === points.length - 1 || points.length <= 2;
      remove.addEventListener('click', event => {
        event.stopPropagation();
        deleteGpxIndices([index]);
      });
      actions.append(up, down, makeStart, remove);
      row.addEventListener('click', () => {
        toggleGpxIndex(index);
        map.easeTo({ center: point, zoom: Math.max(map.getZoom(), 15), duration: 350 });
      });
      row.appendChild(actions);
      list.appendChild(row);
    });
  }

  function syncGpxEditorEndpoints() {
    const coordinates = state.gpxEditor.editCoordinates;
    if (!coordinates.length) return;
    state.startPoint = [...coordinates[0]];
    state.destinationPoint = [...coordinates.at(-1)];
    state.startLabel = 'Start GPX';
    state.destinationLabel = 'Einde GPX';
    setMarker('start', state.startPoint);
    setMarker('destination', state.destinationPoint);
  }

  function drawEditedGpx() {
    invalidatePreparedGpx();
    const coordinates = state.gpxEditor.editCoordinates;
    if (coordinates.length < 2) return;
    syncGpxEditorEndpoints();
    const distance = turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000;
    drawRoute({ coordinates: coordinates.map(point => [...point]), distance, time: 0, instructions: [] }, 'gpx', { skipOverview: true });
    updateGpxPointLayer();
  }




  function toggleGpxIndex(index) {
    const selected = state.gpxEditor.selectedIndices;
    if (selected.has(index)) selected.delete(index);
    else selected.add(index);
    selectGpxIndices([...selected], false);
  }

  function setAddGpxPointMode(active) {
    state.gpxEditor.addMode = Boolean(active);
    if (state.gpxEditor.addMode) setBoxSelectMode(false);
    document.body.classList.toggle('gpx-point-adding', state.gpxEditor.addMode);
    if ($('addGpxPoint')) {
      $('addGpxPoint').classList.toggle('active', state.gpxEditor.addMode);
      $('addGpxPoint').textContent = state.gpxEditor.addMode ? '✕ Annuleer toevoegen' : '＋ Punt toevoegen';
    }
  }

  function insertGpxPoint(point) {
    const coordinates = state.gpxEditor.editCoordinates;
    if (coordinates.length < 2) return;
    const nearest = turf.nearestPointOnLine(turf.lineString(coordinates), turf.point(point), { units: 'kilometers' });
    const segmentIndex = Math.max(0, Math.min(coordinates.length - 2, Number(nearest.properties.index || 0)));
    const insertIndex = segmentIndex + 1;
    pushGpxHistory();
    coordinates.splice(insertIndex, 0, [...point]);
    invalidatePreparedGpx();
    setAddGpxPointMode(false);
    selectGpxIndices([insertIndex]);
    drawEditedGpx();
    renderGpxEditorList();
  }

  function moveSelectedGpxPoint(delta) {
    const selected = new Set(state.gpxEditor.selectedIndices);
    if (!selected.size || ![-1, 1].includes(delta)) return;
    const last = state.gpxEditor.editCoordinates.length - 1;
    const ordered = [...selected].sort((a, b) => delta < 0 ? a - b : b - a);
    if (ordered.some(index => index < 0 || index >= last || index + delta < 0 || index + delta >= last)) return;
    pushGpxHistory();
    ordered.forEach(index => {
      const target = index + delta;
      if (selected.has(target)) return;
      const tmp = state.gpxEditor.editCoordinates[target];
      state.gpxEditor.editCoordinates[target] = state.gpxEditor.editCoordinates[index];
      state.gpxEditor.editCoordinates[index] = tmp;
      selected.delete(index);
      selected.add(target);
    });
    invalidatePreparedGpx();
    state.gpxEditor.selectedIndices = selected;
    removeSelectedMarker();
    drawEditedGpx();
    selectGpxIndices([...selected]);
  }

  function clearGpxPointSelection() {
    selectGpxIndices([], false);
  }

  function reverseGpxRoute() {
    if (state.mode === 'gpx' && state.gpxEditor.editCoordinates.length >= 2) {
      pushGpxHistory();
      state.gpxEditor.editCoordinates.reverse();
      state.gpxEditor.selectedIndices.clear();
      state.gpxActiveSegmentIds.reverse();
      removeSelectedMarker();
      invalidatePreparedGpx();
      drawEditedGpx();
      setMarker('start', state.gpxEditor.editCoordinates[0]);
      setMarker('destination', state.gpxEditor.editCoordinates.at(-1));
      state.startPoint = state.gpxEditor.editCoordinates[0];
      state.destinationPoint = state.gpxEditor.editCoordinates.at(-1);
      renderGpxEditorList();
      showOverview();
      return;
    }

    if (!state.gpxDocument || !state.gpxAnalysis.sourceParts.length) {
      return status('Laad eerst een GPX-bestand.', { error: true });
    }

    const reversedParts = state.gpxAnalysis.sourceParts
      .slice()
      .reverse()
      .map(part => ({ ...cloneGpxPart(part), coordinates: part.coordinates.slice().reverse().map(point => [...point]) }));
    state.gpxDocument.parts = reversedParts.map(cloneGpxPart);
    state.gpxAnalysis.sourceParts = reversedParts.map(cloneGpxPart);
    state.gpxAnalysis.segments = analyseGpxParts(reversedParts, state.gpxAnalysis.jumpThresholdMeters);
    state.gpxAnalysis.selectedIds = new Set(state.gpxAnalysis.segments.map(segment => segment.id));
    state.gpxActiveSegmentIds = [];
    invalidatePreparedGpx();
    state.route = null;
    state.original = [];
    state.mode = 'gpx-document';
    ['route-casing','route-traveled','route-remaining','rejoin-casing','rejoin-route'].forEach(id => setLineSource(id, []));
    setGpxPreview(reversedParts);
    const first = reversedParts[0]?.coordinates?.[0];
    const last = reversedParts.at(-1)?.coordinates?.at(-1);
    if (first) setMarker('start', first);
    if (last) setMarker('destination', last);
    state.startPoint = first || null;
    state.destinationPoint = last || null;
    renderUi();
    showOverview();
  }

  function setSelectedAsGpxStart() {
    const selected = [...state.gpxEditor.selectedIndices];
    if (selected.length !== 1) return status('Selecteer precies één punt als nieuw startpunt.', { error: true });
    const index = selected[0];
    const coordinates = state.gpxEditor.editCoordinates;
    const last = coordinates.length - 1;
    if (index === 0) return status('Dit punt is al het startpunt.');
    if (index <= 0 || index >= last) return status('Kies een routepunt vóór het eindpunt.', { error: true });

    const totalMeters = turf.length(turf.lineString(coordinates), { units: 'kilometers' }) * 1000;
    const closureDistance = turf.distance(turf.point(coordinates[0]), turf.point(coordinates.at(-1)), { units: 'meters' });
    const isClosedRoute = closureDistance <= Math.max(75, Math.min(250, totalMeters * 0.002));
    pushGpxHistory();

    if (isClosedRoute) {
      const duplicateClosure = closureDistance <= 50;
      const core = duplicateClosure ? coordinates.slice(0, -1) : coordinates.slice();
      const safeIndex = Math.min(index, core.length - 1);
      const rotated = core.slice(safeIndex).concat(core.slice(0, safeIndex));
      if (rotated.length < 2) return status('Dit punt kan niet als startpunt worden gebruikt.', { error: true });
      state.gpxEditor.editCoordinates = duplicateClosure ? rotated.concat([[...rotated[0]]]) : rotated;
    } else {
      const confirmed = window.confirm('Dit is geen gesloten rondrit. Alle punten vóór het gekozen startpunt worden verwijderd. Doorgaan?');
      if (!confirmed) {
        state.gpxEditor.history.pop();
        return;
      }
      state.gpxEditor.editCoordinates = coordinates.slice(index).map(point => [...point]);
    }

    state.gpxEditor.selectedIndices = new Set([0]);
    removeSelectedMarker();
    invalidatePreparedGpx();
    drawEditedGpx();
    selectGpxIndices([0]);
    renderGpxEditorList();
    showOverview();
    status('Nieuw GPX-startpunt ingesteld.');
  }

  function deleteGpxIndices(indices) {
    const pointCount = state.gpxEditor.editCoordinates.length;
    const last = pointCount - 1;
    const removable = [...new Set(indices)].filter(index => index >= 0 && index < last).sort((a,b) => b-a);
    if (!removable.length) return status('Het eindpunt blijft behouden; selecteer een ander punt om te verwijderen.', { error: true });
    if (pointCount - removable.length < 2) return status('Een GPX moet minimaal een start- en eindpunt behouden.', { error: true });
    const removedStart = removable.includes(0);
    pushGpxHistory();
    removable.forEach(index => state.gpxEditor.editCoordinates.splice(index, 1));
    state.gpxEditor.selectedIndices.clear();
    removeSelectedMarker();
    drawEditedGpx();
    renderGpxEditorList();
    status(removedStart
      ? `${removable.length} punt${removable.length === 1 ? '' : 'en'} verwijderd. Het eerstvolgende punt is nu het startpunt.`
      : `${removable.length} routepunt${removable.length === 1 ? '' : 'en'} verwijderd.`);
  }

  function deleteSelectedGpx() {
    deleteGpxIndices([...state.gpxEditor.selectedIndices]);
  }

  function setBoxSelectMode(active) {
    if (active && state.gpxEditor.addMode) setAddGpxPointMode(false);
    state.gpxEditor.boxMode = active;
    document.body.classList.toggle('gpx-box-selecting', active);
    if ($('boxSelectGpx')) {
      $('boxSelectGpx').classList.toggle('active', active);
      $('boxSelectGpx').textContent = active ? '✕ Stop selecteren' : '▭ Selectievak';
    }
    if (!active) {
      state.gpxEditor.boxElement?.remove();
      state.gpxEditor.boxElement = null;
      state.gpxEditor.boxStart = null;
      state.gpxEditor.pointerId = null;
      map.dragPan.enable();
      map.touchZoomRotate.enable();
    }
    status(active ? 'Sleep een selectievak over de GPX-route.' : 'Selectievak uitgeschakeld.');
  }



  function boxPoint(event) {
    const rect = map.getContainer().getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  }



  function beginGpxBoxSelection(event) {
    if (!state.gpxEditor.active || !state.gpxEditor.boxMode) return;
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    state.gpxEditor.pointerId = event.pointerId;
    map.getContainer().setPointerCapture?.(event.pointerId);
    map.dragPan.disable();
    map.touchZoomRotate.disable();
    state.gpxEditor.boxStart = boxPoint(event);
    const box = document.createElement('div');
    box.className = 'gpx-selection-box';
    map.getContainer().appendChild(box);
    state.gpxEditor.boxElement = box;
  }



  function moveGpxBoxSelection(event) {
    if (state.gpxEditor.pointerId !== event.pointerId || !state.gpxEditor.boxStart || !state.gpxEditor.boxElement) return;
    event.preventDefault();
    const current = boxPoint(event);
    const x = Math.min(state.gpxEditor.boxStart.x, current.x);
    const y = Math.min(state.gpxEditor.boxStart.y, current.y);
    const width = Math.abs(current.x - state.gpxEditor.boxStart.x);
    const height = Math.abs(current.y - state.gpxEditor.boxStart.y);
    Object.assign(state.gpxEditor.boxElement.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
  }



  function endGpxBoxSelection(event) {
    if (state.gpxEditor.pointerId !== event.pointerId || !state.gpxEditor.boxStart) return;
    event.preventDefault();
    if (event.type === 'pointercancel') {
      try { map.getContainer().releasePointerCapture?.(event.pointerId); } catch (_) {}
      map.dragPan.enable();
      map.touchZoomRotate.enable();
      setBoxSelectMode(false);
      status('Selectievak geannuleerd.');
      return;
    }
    const end = boxPoint(event);
    const start = state.gpxEditor.boxStart;
    const minX = Math.min(start.x, end.x);
    const maxX = Math.max(start.x, end.x);
    const minY = Math.min(start.y, end.y);
    const maxY = Math.max(start.y, end.y);
    const width = maxX - minX;
    const height = maxY - minY;
    const indices = [];
    if (width >= 4 && height >= 4) {
      state.gpxEditor.editCoordinates.forEach((coordinate, index) => {
        const projected = map.project(coordinate);
        if (projected.x >= minX && projected.x <= maxX && projected.y >= minY && projected.y <= maxY) indices.push(index);
      });
    }
    selectGpxIndices(indices, event.ctrlKey || event.metaKey);
    try { map.getContainer().releasePointerCapture?.(event.pointerId); } catch (_) {}
    map.dragPan.enable();
    map.touchZoomRotate.enable();
    setBoxSelectMode(false);
    status(indices.length ? `${indices.length} punten geselecteerd.` : 'Geen punten in het selectievak.');
  }



  function openGpxEditor() {
    if (state.mode !== 'gpx' || state.gpxEditor.editCoordinates.length < 2) {
      const segments = state.gpxAnalysis.segments || [];
      if (segments.length === 1) {
        activateGpxSegment(segments[0], { skipOverview: true });
        return openGpxEditor();
      }
      if (segments.length > 1) {
        openGpxAnalysis({ intent: 'edit' });
        return;
      }
      return status('Er is geen bruikbaar GPX-traject om te bewerken.', { error: true });
    }
    pauseSimulation();
    setNavigationMode(false);
    closeGpxAnalysis();
    state.gpxEditor.active = true;
    state.gpxEditor.selectedIndices.clear();
    document.body.classList.add('gpx-editing');
    $('gpxEditorSheet').hidden = false;
    $('backdrop').hidden = isDesktop();
    updateGpxPointLayer();
    renderGpxEditorList();
    showOverview();
    status('Klik een punt om het te verslepen of gebruik een selectievak.');
    window.requestAnimationFrame(() => map.resize());
  }



  function closeGpxEditor() {
    state.gpxEditor.active = false;
    setAddGpxPointMode(false);
    setBoxSelectMode(false);
    document.body.classList.remove('gpx-editing');
    removeSelectedMarker();
    state.gpxEditor.selectedIndices.clear();
    updateGpxPointLayer();
    if ($('gpxEditorSheet')) $('gpxEditorSheet').hidden = true;
    if ($('settingsSheet')?.hidden && $('fuelSheet')?.hidden && $('gpxAnalysisSheet')?.hidden) $('backdrop').hidden = true;
    window.requestAnimationFrame(() => map.resize());
  }



  function restoreGpx() {
    pushGpxHistory();
    state.gpxEditor.editCoordinates = state.gpxEditor.originalCoordinates.map(point => [...point]);
    state.gpxEditor.selectedIndices.clear();
    removeSelectedMarker();
    drawEditedGpx();
    renderGpxEditorList();
    showOverview();
    status('De oorspronkelijke GPX is hersteld.');
  }

  function escapeXml(value) {
    return String(value || '').replace(/[<>&"']/g, char => ({ '<':'&lt;', '>':'&gt;', '&':'&amp;', '"':'&quot;', "'":'&apos;' }[char]));
  }

  function exportGpx() {
    const coordinates = state.gpxEditor.editCoordinates;
    if (coordinates.length < 2) return status('Er zijn onvoldoende punten om te exporteren.', { error: true });
    const trackPoints = coordinates.map(point => `      <trkpt lat="${point[1].toFixed(7)}" lon="${point[0].toFixed(7)}"></trkpt>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="${APP_NAME} v${APP_VERSION}" xmlns="http://www.topografix.com/GPX/1/1">\n  <metadata><name>${escapeXml(state.gpxEditor.fileName)} bewerkt</name></metadata>\n  <trk><name>${escapeXml(state.gpxEditor.fileName)} bewerkt</name><trkseg>\n${trackPoints}\n  </trkseg></trk>\n</gpx>`;
    downloadText(xml, `${state.gpxEditor.fileName.replace(/\.gpx$/i,'') || 'route'}-bewerkt.gpx`);
    status('Bewerkte GPX geëxporteerd.');
  }




  function cloneGpxPart(part) {
    return { ...part, coordinates: (part.coordinates || []).map(point => [...point]) };
  }

  function orientPartsForJoin(parts) {
    const oriented = [];
    parts.forEach((part, index) => {
      const copy = cloneGpxPart(part);
      if (index > 0 && oriented.length) {
        const previousEnd = oriented[oriented.length - 1].coordinates.at(-1);
        const distanceToStart = turf.distance(turf.point(previousEnd), turf.point(copy.coordinates[0]), { units: 'kilometers' });
        const distanceToEnd = turf.distance(turf.point(previousEnd), turf.point(copy.coordinates.at(-1)), { units: 'kilometers' });
        if (distanceToEnd < distanceToStart) copy.coordinates.reverse();
      }
      oriented.push(copy);
    });
    return oriented;
  }

  async function joinGpxParts(parts) {
    const oriented = orientPartsForJoin(parts);
    const joined = [];
    for (const part of oriented) {
      if (!joined.length) {
        joined.push(...part.coordinates.map(point => [...point]));
        continue;
      }
      const from = joined.at(-1);
      const to = part.coordinates[0];
      const gapKm = turf.distance(turf.point(from), turf.point(to), { units: 'kilometers' });
      if (gapKm > 0.08 && state.apiKey) {
        try {
          const connector = await calculateRoute([from, to]);
          joined.push(...connector.coordinates.slice(1, -1));
        } catch (error) {
          console.warn('GPX-verbinding kon niet over de weg worden berekend:', error);
        }
      }
      joined.push(...part.coordinates.map(point => [...point]));
    }
    return joined;
  }

  async function loadGpx(event) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const append = state.gpxAppendMode && Boolean(state.gpxDocument);
    state.gpxAppendMode = false;

    let existingParts = [];
    let existingNames = [];
    if (append && state.gpxDocument) {
      existingNames = (state.gpxDocument.fileNames || [state.gpxDocument.fileName]).slice();
      const activeRouteCanReplaceDocument = state.mode === 'gpx'
        && state.gpxEditor.editCoordinates.length >= 2
        && (state.gpxRoutePrepared || gpxEditorHasChanges());
      existingParts = activeRouteCanReplaceDocument
        ? [{
            name: state.gpxEditor.fileName || state.gpxDocument.fileName || 'Actieve GPX-route',
            type: 'tracksegment',
            reason: 'Actieve samengestelde of bewerkte GPX-route',
            sourceFile: state.gpxDocument.fileName,
            coordinates: state.gpxEditor.editCoordinates.map(point => [...point])
          }]
        : state.gpxDocument.parts.map(cloneGpxPart);
    }

    const loadToken = state.gpxLoadToken + 1;
    state.gpxLoadToken = loadToken;
    if (!append) clearRoute({ silent: true, preserveGps: true, keepLoadToken: true });
    state.entryMode = 'gpx';
    renderUi();

    try {
      const loadedParts = [];
      for (const file of files) {
        const fileText = await file.text();
        if (loadToken !== state.gpxLoadToken) return;
        const xml = new DOMParser().parseFromString(fileText, 'application/xml');
        if (xml.querySelector('parsererror')) throw new Error(`${file.name} kon niet worden gelezen.`);
        const { parts } = parseGpx(xml);
        if (!parts.length) throw new Error(`Geen bruikbare routepunten gevonden in ${file.name}.`);
        parts.forEach(part => loadedParts.push({
          ...part,
          sourceFile: file.name.replace(/\.gpx$/i, ''),
          coordinates: part.coordinates.map(point => [...point])
        }));
      }

      const clonedParts = existingParts.concat(loadedParts).map(cloneGpxPart);
      const fileNames = existingNames.concat(files.map(file => file.name.replace(/\.gpx$/i, '') || 'route'));
      const totalDistance = clonedParts.reduce((sum, part) => sum + turf.length(turf.lineString(part.coordinates), { units: 'kilometers' }) * 1000, 0);
      const totalPoints = clonedParts.reduce((sum, part) => sum + part.coordinates.length, 0);
      const uniqueNames = [...new Set(fileNames)];
      const displayName = uniqueNames.length > 1 ? `${uniqueNames[0]} + ${uniqueNames.length - 1} GPX` : uniqueNames[0];
      state.gpxDocument = { fileName: displayName || 'route', fileNames: uniqueNames, parts: clonedParts, totalDistance, totalPoints };
      const analysedSegments = analyseGpxParts(clonedParts, state.gpxAnalysis.jumpThresholdMeters);
      state.gpxAnalysis = {
        sourceParts: clonedParts.map(cloneGpxPart),
        segments: analysedSegments,
        active: false,
        intent: null,
        selectedIds: new Set(analysedSegments.map(segment => segment.id)),
        jumpThresholdMeters: state.gpxAnalysis.jumpThresholdMeters
      };
      state.gpxEditor.fileName = state.gpxDocument.fileName;
      state.gpxActiveSegmentIds = [];
      state.startPoint = null;
      state.destinationPoint = null;
      state.startLabel = 'Start GPX';
      state.destinationLabel = 'Einde GPX';
      invalidatePreparedGpx();
      if ($('startQuery')) $('startQuery').value = '';
      if ($('destinationQuery')) $('destinationQuery').value = '';

      setGpxPreview(clonedParts);
      const bounds = partsBounds(clonedParts);
      if (bounds) map.fitBounds(bounds, { padding: mapPaddingForOverview(), duration: 550, maxZoom: 16 });

      if (analysedSegments.length === 1) {
        activateGpxSegment(analysedSegments[0], { skipOverview: true });
      } else {
        state.route = null;
        state.original = [];
        state.mode = 'gpx-document';
        ['route-casing','route-traveled','route-remaining','rejoin-casing','rejoin-route'].forEach(id => setLineSource(id, []));
        const ordered = orderedGpxSegmentsForJoin(analysedSegments);
        const first = ordered[0]?.coordinates?.[0];
        const last = ordered.at(-1)?.coordinates?.at(-1);
        if (first) setMarker('start', first);
        if (last) setMarker('destination', last);
        state.startPoint = first || null;
        state.destinationPoint = last || null;
        renderUi();
      }
      showOverview();
    } catch (error) {
      if (loadToken === state.gpxLoadToken) {
        if (!append) clearRoute({ silent: true, preserveGps: true, keepLoadToken: true });
        status(error.message, { error: true, duration: 8000 });
      }
    } finally {
      event.target.value = '';
    }
  }


  const ORIENTATION_STEPS = [
    { type: 'portrait-primary', layout: 'portrait', angle: 0, label: 'staand' },
    { type: 'landscape-primary', layout: 'landscape', angle: 90, label: 'liggend rechtsom' },
    { type: 'portrait-secondary', layout: 'portrait', angle: 180, label: 'ondersteboven' },
    { type: 'landscape-secondary', layout: 'landscape', angle: 270, label: 'liggend linksom' }
  ];

  function normaliseOrientationAngle(value) {
    const angle = Number(value);
    if (!Number.isFinite(angle)) return 0;
    return ((Math.round(angle / 90) * 90) % 360 + 360) % 360;
  }

  function physicalOrientationAngle() {
    const screenAngle = Number(screen.orientation?.angle);
    if (Number.isFinite(screenAngle)) return normaliseOrientationAngle(screenAngle);
    const legacyAngle = Number(window.orientation);
    if (Number.isFinite(legacyAngle)) return normaliseOrientationAngle(legacyAngle);
    return window.innerWidth > window.innerHeight ? 90 : 0;
  }

  function activeOrientationSpec() {
    return ORIENTATION_STEPS[state.orientationStep] || ORIENTATION_STEPS[0];
  }

  function clearSoftwareRotationClasses() {
    document.body.classList.remove('force-rotate-90', 'force-rotate-180', 'force-rotate-270');
  }

  function softwareRotationDelta() {
    if (isDesktop()) return 0;
    const target = activeOrientationSpec();
    if (screen.orientation?.type === target.type) return 0;
    return normaliseOrientationAngle(target.angle - physicalOrientationAngle());
  }

  function applyLayoutMode() {
    clearSoftwareRotationClasses();
    document.body.classList.remove('orientation-step-0', 'orientation-step-1', 'orientation-step-2', 'orientation-step-3');

    if (isDesktop()) {
      state.layoutMode = 'landscape';
      document.body.classList.add('orientation-step-0');
    } else {
      const target = activeOrientationSpec();
      state.layoutMode = target.layout;
      document.body.classList.add(`orientation-step-${state.orientationStep}`);
      const delta = softwareRotationDelta();
      if (delta === 90) document.body.classList.add('force-rotate-90');
      else if (delta === 180) document.body.classList.add('force-rotate-180');
      else if (delta === 270) document.body.classList.add('force-rotate-270');
    }

    document.body.classList.toggle('layout-portrait', state.layoutMode === 'portrait');
    document.body.classList.toggle('layout-landscape', state.layoutMode === 'landscape');

    const button = $('layoutToggle');
    if (button) {
      const next = ORIENTATION_STEPS[(state.orientationStep + 1) % ORIENTATION_STEPS.length];
      button.textContent = '↻';
      button.title = `Draai 90° naar ${next.label}`;
      button.setAttribute('aria-label', button.title);
      button.dataset.orientationStep = String(state.orientationStep);
    }
    if (state.mapReady) window.setTimeout(() => map.resize(), 100);
  }

  async function requestOrientationStep(step, options = {}) {
    if (isDesktop()) {
      state.orientationStep = 0;
      state.orientationNativeLocked = false;
      applyLayoutMode();
      return false;
    }

    const requestedStep = ((Number(step) % ORIENTATION_STEPS.length) + ORIENTATION_STEPS.length) % ORIENTATION_STEPS.length;
    state.orientationStep = requestedStep;
    const requestToken = ++state.orientationRequestToken;
    const target = ORIENTATION_STEPS[requestedStep];
    let locked = false;

    try {
      if (screen.orientation && typeof screen.orientation.lock === 'function') {
        await screen.orientation.lock(target.type);
        locked = true;
      }
    } catch (error) {
      if (!options.silent) console.debug(`Schermoriëntatie ${target.type} wordt softwarematig toegepast.`, error);
    }

    if (requestToken !== state.orientationRequestToken) return false;
    state.orientationNativeLocked = locked;
    applyLayoutMode();
    return locked;
  }

  async function toggleLayoutMode() {
    if (isDesktop() || !state.navigationActive) return;
    await requestOrientationStep(state.orientationStep + 1);
  }

  function setNavigationMode(active) {
    const wasActive = state.navigationActive;
    state.navigationActive = active;
    if (active) {
      if (!wasActive) {
        state.orientationStep = 0;
        state.layoutMode = 'portrait';
        state.orientationNativeLocked = false;
        requestOrientationStep(0, { silent: true });
      }
      if ($('developerPanel')) $('developerPanel').hidden = true;
      updatePauseButton();
      if (!state.navigationPaused) requestWakeLock();
    } else {
      state.navigationPaused = false;
      state.pendingNavigationStart = false;
      state.orientationStep = 0;
      state.layoutMode = 'portrait';
      state.orientationNativeLocked = false;
      requestOrientationStep(0, { silent: true });
      releaseWakeLock();
    }
    renderUi();
    requestAnimationFrame(() => map.resize());
  }


  function closeFuelSheet() {
    const sheet = $('fuelSheet');
    if (sheet) sheet.hidden = true;
    syncBackdrop();
  }


  function renderFuelChoices(candidates) {
    const box = $('fuelChoices');
    box.innerHTML = '';
    candidates.slice(0, 3).forEach((station, index) => {
      const button = document.createElement('button');
      button.className = 'fuel-choice';
      const routeAhead = Math.max(0, station.ahead - state.progressKm);
      const title = document.createElement('strong');
      title.textContent = `${index + 1}. ${station.name}`;
      const detail = document.createElement('span');
      detail.textContent = `${routeAhead.toFixed(1)} km verder op de route · ${Math.round(station.side * 1000)} m ernaast`;
      const add = document.createElement('span');
      add.className = 'fuel-add';
      add.textContent = 'Toevoegen ›';
      button.append(title, detail, add);
      button.addEventListener('click', () => chooseFuelStop(station));
      box.appendChild(button);
    });
  }

  async function chooseFuelStop(station) {
    const operationToken = ++state.fuelSearchToken;
    setFuelLoading(true);
    try {
      closeFuelSheet();
      const activeRoute = state.route;
      if (!activeRoute || !state.navigationActive) throw new Error('De navigatie is niet meer actief.');
      const destination = state.destinationPoint || activeRoute.coordinates[activeRoute.coordinates.length - 1];
      const start = state.current || turf.along(turf.lineString(activeRoute.coordinates), state.progressKm, { units: 'kilometers' }).geometry.coordinates;
      let dataRoute;
      let nextMode = state.mode;

      if (state.mode === 'gpx') {
        const originalLine = turf.lineString(activeRoute.coordinates);
        const totalKm = activeRoute.totalKm || turf.length(originalLine, { units: 'kilometers' });
        const rejoinKm = Math.min(totalKm, Math.max(state.progressKm + 0.8, station.ahead + 0.5));
        const rejoinPoint = turf.along(originalLine, rejoinKm, { units: 'kilometers' }).geometry.coordinates;
        const detour = await calculateRoute([start, station.point, rejoinPoint]);
        const remaining = rejoinKm < totalKm
          ? turf.lineSliceAlong(originalLine, rejoinKm, totalKm, { units: 'kilometers' }).geometry.coordinates
          : [];
        const coordinates = detour.coordinates.concat(remaining.length ? remaining.slice(1) : []);
        const remainingKm = remaining.length >= 2 ? turf.length(turf.lineString(remaining), { units: 'kilometers' }) : 0;
        const remainingTime = activeRoute.time > 0 && totalKm > 0 ? activeRoute.time * (remainingKm / totalKm) : 0;
        dataRoute = {
          coordinates,
          distance: detour.distance + remainingKm * 1000,
          time: detour.time + remainingTime,
          instructions: detour.instructions || []
        };
        nextMode = 'gpx';
      } else {
        dataRoute = await calculateRoute([start, station.point, destination]);
        nextMode = 'address';
        state.gpxDocument = null;
      }

      if (operationToken !== state.fuelSearchToken || !state.navigationActive) return;
      state.fuelStop = station;
      state.destinationPoint = destination;
      state.destinationLabel = state.destinationLabel || 'Bestemming';
      setMarker('destination', destination);
      drawRoute(dataRoute, nextMode, { skipOverview: true });
      state.navigationPaused = false;
      state.follow = true;
      state.navigationSource = state.navigationSource || 'gps';
      setNavigationMode(true);
      updatePauseButton();
    } catch (error) {
      if (operationToken === state.fuelSearchToken) status(error.message, { error: true, duration: 6500 });
    } finally {
      if (operationToken === state.fuelSearchToken) setFuelLoading(false);
    }
  }

  async function addNearestFuelStop() {
    if (state.fuelLoading) return;
    const operationToken = ++state.fuelSearchToken;
    setFuelLoading(true);
    try {
      if (!state.route || !state.current || !state.navigationActive) throw new Error('Start eerst de navigatie of simulatie.');
      const line = turf.lineString(state.route.coordinates);
      const total = turf.length(line, { units: 'kilometers' });
      const searchStart = Math.min(total, state.progressKm + 0.4);
      const searchEnd = Math.min(total, state.progressKm + 30);
      const sampleDistances = [];
      for (let km = searchStart; km <= searchEnd; km += 6) sampleDistances.push(km);
      if (!sampleDistances.length) sampleDistances.push(searchStart);
      const aroundParts = sampleDistances.map(km => {
        const p = turf.along(line, km, { units: 'kilometers' }).geometry.coordinates;
        return `node["amenity"="fuel"](around:5500,${p[1]},${p[0]});way["amenity"="fuel"](around:5500,${p[1]},${p[0]});`;
      }).join('');
      const query = `[out:json][timeout:20];(${aroundParts});out center tags;`;
      const endpoints = ['https://overpass.kumi.systems/api/interpreter', 'https://overpass-api.de/api/interpreter'];
      let data = null;
      for (const endpoint of endpoints) {
        if (operationToken !== state.fuelSearchToken) return;
        const controller = new AbortController();
        state.fuelAbortController = controller;
        const timer = window.setTimeout(() => controller.abort(), 12000);
        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
            body: `data=${encodeURIComponent(query)}`,
            signal: controller.signal
          });
          if (response.ok) {
            data = await response.json();
            break;
          }
        } catch (_) {
          // Probeer de volgende Overpass-server.
        } finally {
          window.clearTimeout(timer);
          if (state.fuelAbortController === controller) state.fuelAbortController = null;
        }
      }
      if (operationToken !== state.fuelSearchToken || !state.navigationActive) return;
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
        return { ...item, ahead, side, score: side * 12 + Math.max(0, ahead - state.progressKm) * 0.03 };
      }).filter(item => item.ahead > state.progressKm + .15 && item.ahead <= searchEnd + 2 && item.side <= 3)
        .sort((a,b) => a.score - b.score)
        .slice(0, 3);
      if (!candidates.length) throw new Error('Geen tankstation langs het komende deel van de route gevonden.');
      state.fuelCandidates = candidates;
      renderFuelChoices(candidates);
      $('fuelSheet').hidden = false;
      $('backdrop').hidden = false;
    } catch (error) {
      if (operationToken === state.fuelSearchToken) status(error.message, { error: true, duration: 6500 });
    } finally {
      if (operationToken === state.fuelSearchToken) setFuelLoading(false);
    }
  }



  function pauseNavigation() {
    if (!state.navigationActive || state.navigationPaused) return;
    state.navigationPaused = true;
    state.follow = false;
    updateTurnAlert();
    if (state.simulation.playing) stopSimulationTimer();
    releaseWakeLock();
    updatePauseButton();
    renderUi();
  }

  function resumeNavigation() {
    if (!state.navigationActive || !state.navigationPaused) return;
    state.navigationPaused = false;
    state.follow = true;
    updatePauseButton();
    updateTurnAlert();
    requestWakeLock();
    if (state.navigationSource === 'simulation') {
      toggleSimulation();
    } else {
      if (state.watchId === null) startGpsWatch();
      if (state.current) updateNavigation(state.current, 0, null);
      renderUi();
    }
  }

  function finishNavigation() {
    if (!state.navigationActive) return;
    const source = state.navigationSource;
    cancelFuelSearch();
    closeFuelSheet();
    stopSimulationTimer();
    state.navigationPaused = false;
    state.nextManeuver = null;
    updateTurnAlert();
    state.navigationSource = null;
    state.pendingNavigationStart = false;
    state.follow = false;
    if (source === 'gps') stopGpsWatch({ preservePosition: true });
    setNavigationMode(false);
    updatePauseButton();
    if (state.mode === 'gpx' && state.gpxBaseRoute) {
      const base = cloneRouteData(state.gpxBaseRoute);
      state.gpxStartStrategy = null;
      drawRoute(base, 'gpx', { skipOverview: true });
      setMarker('start', base.coordinates[0]);
      setMarker('destination', base.coordinates[base.coordinates.length - 1]);
    }
    if (state.route) showOverview();
  }

  function stopNavigation() {
    if (!state.navigationActive) return;
    if (!state.navigationPaused) pauseNavigation();
    else finishNavigation();
  }


  function toggleSimulation() {
    if (!state.route || state.route.coordinates.length < 2) return status('Bereken, laad of selecteer eerst een route.', { error: true });
    if (state.simulation.playing) return pauseSimulation();

    const line = turf.lineString(state.route.coordinates);
    const totalKm = state.route.totalKm || turf.length(line, { units: 'kilometers' });
    if (!Number.isFinite(state.simulation.distanceKm) || state.simulation.distanceKm < 0 || state.simulation.distanceKm >= totalKm - 0.001) {
      state.simulation.distanceKm = 0;
    }
    state.progressKm = state.simulation.distanceKm;
    updateRouteProgress(state.progressKm);

    const startPosition = turf.along(line, state.simulation.distanceKm, { units: 'kilometers' }).geometry.coordinates;
    const startHeading = bearingAlongRoute(line, state.simulation.distanceKm);
    state.follow = true;
    state.navigationSource = 'simulation';
    state.navigationPaused = false;
    setNavigationMode(true);
    setCurrentPosition(startPosition, { source: 'Simulatie', speedMps: 0, heading: startHeading, progressKm: state.simulation.distanceKm, forceNavigationUpdate: true });

    state.simulation.playing = true;
    state.simulation.lastTime = performance.now();
    state.simulation.lastRender = 0;
    if ($('simPlay')) {
      $('simPlay').textContent = '⏸ Pauze';
      $('simPlay').classList.add('active');
    }
    if ($('devSource')) $('devSource').textContent = 'Simulatie';
    updatePauseButton();
    status(state.simulation.distanceKm > 0 ? 'Routesimulatie hervat' : 'Routesimulatie gestart');
    state.simulation.timer = requestAnimationFrame(simulationFrame);
  }


  function pauseSimulation() {
    stopSimulationTimer();
    status('Simulatie gepauzeerd');
  }


  function resetSimulation() {
    stopSimulationTimer();
    state.simulation.distanceKm = 0;
    state.progressKm = 0;
    state.navigationPaused = false;
    updateRouteProgress(0);
    if (state.navigationSource === 'simulation') setNavigationMode(false);
    if (state.route && state.route.coordinates.length) {
      setCurrentPosition(state.route.coordinates[0], { source: 'Simulatie', speedMps: 0 });
      showOverview();
    }
    updateDeveloper();
    status('Simulatie teruggezet');
  }


  function simulationFrame(now) {
    if (!state.simulation.playing || !state.route || state.navigationPaused) return;
    const dt = Math.min(.1, (now - state.simulation.lastTime) / 1000);
    state.simulation.lastTime = now;
    const line = turf.lineString(state.route.coordinates);
    const totalKm = state.route.totalKm || turf.length(line, { units: 'kilometers' });
    const baseSpeedKmh = state.profile === 'bike' ? 22 : state.profile === 'foot' ? 5 : 70;
    const simulatedKmh = baseSpeedKmh * state.simulation.speedFactor;
    state.simulation.distanceKm += simulatedKmh * dt / 3600;
    if (state.simulation.distanceKm >= totalKm) {
      state.simulation.distanceKm = totalKm;
      const end = turf.along(line, totalKm, { units: 'kilometers' }).geometry.coordinates;
      setCurrentPosition(end, { source: 'Simulatie', speedMps: 0, heading: bearingAlongRoute(line, Math.max(0,totalKm-.05)), progressKm: totalKm, forceNavigationUpdate: true });
      stopSimulationTimer();
      state.navigationPaused = true;
      state.nextManeuver = null;
      updateTurnAlert();
      updatePauseButton();
      $('instruction').textContent = 'Bestemming bereikt';
      $('nextDistance').textContent = 'Nu';
      $('maneuverIcon').textContent = '🏁';
      setRemaining('0 m', '0 min');
      releaseWakeLock();
      status('Simulatie voltooid');
      return;
    }
    if (now - state.simulation.lastRender >= 80) {
      state.simulation.lastRender = now;
      const p = turf.along(line, state.simulation.distanceKm, { units: 'kilometers' }).geometry.coordinates;
      setCurrentPosition(p, {
        source: 'Simulatie',
        speedMps: baseSpeedKmh / 3.6,
        heading: bearingAlongRoute(line, state.simulation.distanceKm),
        progressKm: state.simulation.distanceKm,
        forceNavigationUpdate: true
      });
    }
    state.simulation.timer = requestAnimationFrame(simulationFrame);
  }


  function clearRoute(options = {}) {
    const { silent = false, preserveGps = false, keepLoadToken = false } = options || {};
    if (!keepLoadToken) state.gpxLoadToken += 1;
    stopSimulationTimer();
    cancelFuelSearch();
    releaseWakeLock();
    state.pendingNavigationStart = false;
    state.pendingGpxStartStrategy = null;
    state.navigationSource = null;
    state.navigationPaused = false;
    state.navigationActive = false;
    state.nextManeuver = null;
    updateTurnAlert();
    state.follow = false;
    state.pickingStart = false;
    state.pickingDestination = false;
    state.orientationStep = 0;
    state.layoutMode = 'portrait';
    state.orientationNativeLocked = false;
    state.simulation.lastRender = 0;
    map.getCanvas()?.classList.remove('map-pick-mode');
    requestOrientationStep(0, { silent: true });
    if (!preserveGps) stopGpsWatch({ preservePosition: true });
    state.route = null;
    state.original = [];
    state.mode = 'idle';
    state.entryMode = null;
    state.progressKm = 0;
    state.simulation.distanceKm = 0;
    state.offCount = 0;
    state.fuelStop = null;
    state.fuelCandidates = [];
    state.gpxRoutePreparing = false;
    state.gpxPrepareProgress = '';
    state.gpxRoutePrepared = false;
    state.gpxPreparedMethod = '';
    state.gpxPrepareWarnings = [];
    state.gpxBaseRoute = null;
    state.gpxActiveSegmentIds = [];
    state.gpxStartStrategy = null;
    state.gpxStartWaiting = false;
    state.gpxAppendMode = false;
    state.gpxPendingPreparation = null;
    state.gpxStartAfterPrepare = false;

    state.gpxEditor.boxElement?.remove();
    removeSelectedMarker();
    document.body.classList.remove('gpx-editing', 'gpx-box-selecting', 'gpx-point-adding');
    const threshold = state.gpxAnalysis.jumpThresholdMeters;
    state.gpxEditor = { active: false, fileName: 'route', originalCoordinates: [], editCoordinates: [], selectedIndices: new Set(), selectedMarker: null, boxMode: false, addMode: false, boxStart: null, boxElement: null, pointerId: null, history: [] };
    state.gpxAnalysis = { sourceParts: [], segments: [], active: false, intent: null, selectedIds: new Set(), jumpThresholdMeters: threshold };
    state.gpxDocument = null;

    ['gpxEditorSheet','gpxAnalysisSheet','gpxRouteModeSheet','gpxStartSheet','fuelSheet','settingsSheet'].forEach(id => { if ($(id)) $(id).hidden = true; });
    if ($('backdrop')) $('backdrop').hidden = true;
    map.getSource('gpx-analysis')?.setData(emptyGeoJson());
    map.getSource('gpx-edit-points')?.setData(emptyGeoJson());
    clearGpxPreview();
    clearRouteComponentLayers();
    ['route-casing','route-traveled','route-remaining','rejoin-casing','rejoin-route'].forEach(id => setLineSource(id, []));

    if (state.destinationMarker) { state.destinationMarker.remove(); state.destinationMarker = null; }
    if (state.startMarker) { state.startMarker.remove(); state.startMarker = null; }
    state.destinationPoint = null;
    state.destinationLabel = '';
    state.startPoint = state.startMode === 'gps' && preserveGps ? state.current : null;
    state.startLabel = state.startMode === 'gps' ? 'Mijn locatie' : '';
    if ($('destinationQuery')) $('destinationQuery').value = '';
    if ($('startQuery')) $('startQuery').value = state.startMode === 'gps' && state.current ? 'Mijn huidige locatie' : '';
    if ($('searchResults')) $('searchResults').hidden = true;

    $('instruction').textContent = 'Volg de route';
    $('nextDistance').textContent = 'Nu';
    setRemaining('-', '-');
    $('maneuverIcon').textContent = '↑';
    state.nextManeuver = null;
    updateTurnAlert();
    if ($('developerPanel')) $('developerPanel').hidden = true;
    updateDeveloper();
    renderUi();
    if (state.mapReady) map.easeTo({ bearing: 0, pitch: 0, duration: 250 });
    if (!silent) status('Route en GPX-gegevens gewist');
  }


  function updateDeveloper() {
    if (!state.route) {
      $('devProgress').textContent = '0%';
      $('devOffRoute').textContent = '-';
      $('devInstruction').textContent = '-';
    }
  }

  function updateAvatarChoiceUi() {
    document.querySelectorAll('.avatar-choice').forEach(button => {
      button.classList.toggle('selected', button.dataset.avatar === state.avatar);
      button.setAttribute('aria-pressed', button.dataset.avatar === state.avatar ? 'true' : 'false');
    });
    const uploadButton = $('uploadAvatarButton');
    if (uploadButton) uploadButton.classList.toggle('selected', state.avatar === 'custom');
  }

  function chooseAvatar(avatar) {
    state.avatar = avatar;
    updateAvatarChoiceUi();
    refreshCurrentMarker();
  }

  async function processAvatarFile(event) {
    const file = event.target.files && event.target.files[0];
    if (!file) return;
    if (!file.type.startsWith('image/')) return status('Kies een geldig afbeeldingsbestand.', { error: true });
    try {
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = dataUrl;
      });
      const size = 256;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight);
      const width = image.naturalWidth * scale;
      const height = image.naturalHeight * scale;
      context.drawImage(image, (size - width) / 2, (size - height) / 2, width, height);
      state.customAvatar = canvas.toDataURL('image/jpeg', 0.82);
      chooseAvatar('custom');
      status('Foto ingesteld als avatar. Klik Opslaan om te bewaren.');
    } catch (_) {
      status('De foto kon niet worden verwerkt.', { error: true });
    } finally {
      event.target.value = '';
    }
  }

  function openSettings() {
    $('apiKey').value = state.apiKey;
    $('vehicleProfile').value = state.profile;
    $('autoFollow').checked = state.autoFollow;
    $('keepAwake').checked = state.keepAwake;
    if ($('wakeLockSupport')) $('wakeLockSupport').textContent = 'wakeLock' in navigator
      ? 'Scherm wakker houden wordt door deze browser ondersteund.'
      : 'Deze browser ondersteunt het automatisch wakker houden van het scherm niet.';
    updateAvatarChoiceUi();
    $('settingsSheet').hidden = false;
    $('backdrop').hidden = false;
  }

  function closeSettings() {
    if ($('settingsSheet')) $('settingsSheet').hidden = true;
    syncBackdrop();
  }

  function saveSettings() {
    state.apiKey = $('apiKey').value.trim();
    state.profile = $('vehicleProfile').value;
    state.autoFollow = $('autoFollow').checked;
    state.keepAwake = $('keepAwake').checked;
    persistSettings();
    if (state.navigationActive && !state.navigationPaused) {
      if (state.keepAwake) requestWakeLock();
      else releaseWakeLock();
    }
    closeSettings();
    status('Instellingen opgeslagen');
  }

  function bind(id, eventName, handler) {
    const element = $(id);
    if (!element) { console.warn(`${APP_NAME} v${APP_VERSION}: element #${id} ontbreekt`); return; }
    element.addEventListener(eventName, handler);
  }

  bind('chooseAddressMode', 'click', chooseAddressMode);
  bind('chooseGpxMode', 'click', chooseGpxMode);
  bind('modeBack', 'click', returnToModeChoice);
  bind('gpsAlert', 'click', startGpsWatch);
  bind('startMode', 'click', toggleStartMode);
  bind('useMapStart', 'click', requestMapStart);
  bind('useMapDestination', 'click', () => requestMapPoint('destination'));
  bind('planRoute', 'click', planRoute);
  bind('replaceGpx', 'click', chooseGpxMode);
  bind('appendGpx', 'click', appendGpxMode);
  bind('prepareGpxRoute', 'click', () => openGpxRouteMode());
  bind('reverseGpx', 'click', reverseGpxRoute);
  bind('gpxFile', 'change', loadGpx);
  bind('editGpx', 'click', openGpxEditor);
  bind('analyseGpx', 'click', () => openGpxAnalysis());
  bind('closeGpxAnalysis', 'click', closeGpxAnalysis);
  bind('rerunGpxAnalysis', 'click', rerunGpxAnalysis);
  bind('gpxJumpThreshold', 'keydown', event => { if (event.key === 'Enter') rerunGpxAnalysis(); });
  bind('exportAllGpxSegments', 'click', exportAllGpxSegments);
  bind('exportSelectedGpxSegments', 'click', exportSelectedGpxSegments);
  bind('selectAllGpxSegments', 'click', selectAllGpxSegments);
  bind('clearGpxSegmentSelection', 'click', clearGpxSegmentSelection);
  bind('useSelectedGpxSegment', 'click', useSelectedGpxSegment);
  bind('editSelectedGpxSegment', 'click', editSelectedGpxSegment);
  bind('closeGpxEditor', 'click', closeGpxEditor);
  bind('restoreGpx', 'click', restoreGpx);
  bind('exportGpx', 'click', exportGpx);
  bind('prepareEditedGpx', 'click', prepareEditedGpxRoute);
  bind('setGpxStartPoint', 'click', setSelectedAsGpxStart);
  bind('addGpxPoint', 'click', () => setAddGpxPointMode(!state.gpxEditor.addMode));
  bind('boxSelectGpx', 'click', () => setBoxSelectMode(!state.gpxEditor.boxMode));
  bind('deleteSelectedGpx', 'click', deleteSelectedGpx);
  bind('clearGpxPointSelection', 'click', clearGpxPointSelection);
  bind('undoGpx', 'click', undoGpx);
  bind('moveGpxPointUp', 'click', () => moveSelectedGpxPoint(-1));
  bind('moveGpxPointDown', 'click', () => moveSelectedGpxPoint(1));
  bind('startNavigation', 'click', startNavigation);
  bind('overview', 'click', showOverview);
  bind('clear', 'click', clearRoute);
  bind('fuel', 'click', addNearestFuelStop);
  bind('layoutToggle', 'click', toggleLayoutMode);
  bind('closeFuelSheet', 'click', closeFuelSheet);
  bind('closeGpxRouteMode', 'click', closeGpxRouteMode);
  bind('chooseHybridGpxRoute', 'click', () => chooseGpxRouteMode('hybrid'));
  bind('chooseExactGpxRoute', 'click', () => chooseGpxRouteMode('exact'));
  bind('closeGpxStartSheet', 'click', closeGpxStartSheet);
  bind('gpxRetryGps', 'click', retryGpxGps);
  bind('gpxNavigateToStart', 'click', () => startGpxWithStrategy('start').catch(error => {
    state.gpxStartWaiting = false;
    setGpxStartFeedback(error.message, { error: true, retry: state.gpsStatus !== 'active' });
  }));
  bind('gpxJoinNearest', 'click', () => startGpxWithStrategy('nearest').catch(error => {
    state.gpxStartWaiting = false;
    setGpxStartFeedback(error.message, { error: true, retry: state.gpsStatus !== 'active' });
  }));
  bind('resumeNavigation', 'click', resumeNavigation);
  bind('stopNavigation', 'click', stopNavigation);
  bind('closeDeveloper', 'click', () => { const panel = $('developerPanel'); if (panel) panel.hidden = true; });
  bind('simPlay', 'click', toggleSimulation);
  bind('simReset', 'click', resetSimulation);
  bind('simSpeed', 'change', event => { state.simulation.speedFactor = Number(event.target.value); });
  bind('settings', 'click', openSettings);
  bind('closeSettings', 'click', closeSettings);
  bind('backdrop', 'click', () => { closeSettings(); closeFuelSheet(); closeGpxRouteMode(); closeGpxStartSheet(); closeGpxEditor(); closeGpxAnalysis(); });
  bind('saveSettings', 'click', saveSettings);
  document.querySelectorAll('.avatar-choice').forEach(button => button.addEventListener('click', () => chooseAvatar(button.dataset.avatar)));
  bind('uploadAvatarButton', 'click', () => $('avatarFile')?.click());
  bind('avatarFile', 'change', processAvatarFile);
  bind('destinationQuery', 'input', () => { state.destinationPoint = null; });
  bind('startQuery', 'input', () => { state.startPoint = null; });
  bind('destinationQuery', 'keydown', async event => { if (event.key === 'Enter') { try { await showSearchResults(event.target.value.trim(), 'destination'); } catch (error) { status(error.message, { error: true }); } } });
  bind('startQuery', 'keydown', async event => { if (event.key === 'Enter' && state.startMode === 'manual') { try { await showSearchResults(event.target.value.trim(), 'start'); } catch (error) { status(error.message, { error: true }); } } });

  map.on('click', 'gpx-analysis-lines', event => {
    if (!state.gpxAnalysis.active) return;
    const id = Number(event.features?.[0]?.properties?.segmentId);
    if (!Number.isFinite(id)) return;
    if (state.gpxAnalysis.selectedIds.has(id)) state.gpxAnalysis.selectedIds.delete(id);
    else state.gpxAnalysis.selectedIds.add(id);
    markGpxSelectionChanged();
    renderGpxAnalysis();
    renderUi();
    status(`Traject ${id} ${state.gpxAnalysis.selectedIds.has(id) ? 'geselecteerd' : 'gedeselecteerd'}.`);
  });
  map.on('mouseenter', 'gpx-analysis-lines', () => { if (state.gpxAnalysis.active) map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'gpx-analysis-lines', () => { if (!state.gpxEditor.active) map.getCanvas().style.cursor = ''; });

  map.on('click', 'gpx-edit-points', event => {
    if (!state.gpxEditor.active || state.gpxEditor.boxMode || state.gpxEditor.addMode) return;
    const index = Number(event.features?.[0]?.properties?.index);
    if (Number.isFinite(index)) toggleGpxIndex(index);
  });
  map.on('mouseenter', 'gpx-edit-points', () => { if (state.gpxEditor.active && !state.gpxEditor.boxMode) map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', 'gpx-edit-points', () => { map.getCanvas().style.cursor = ''; });
  map.on('moveend', () => { if (state.gpxEditor.active) updateGpxPointLayer(); });
  const mapContainer = map.getContainer();
  mapContainer.addEventListener('pointerdown', beginGpxBoxSelection, { passive: false });
  mapContainer.addEventListener('pointermove', moveGpxBoxSelection, { passive: false });
  window.addEventListener('pointerup', endGpxBoxSelection, { passive: false });
  window.addEventListener('pointercancel', endGpxBoxSelection, { passive: false });

  const syncViewportLayout = () => {
    applyLayoutMode();
    if (state.mapReady) window.requestAnimationFrame(() => map.resize());
  };
  window.addEventListener('resize', syncViewportLayout);
  screen.orientation?.addEventListener?.('change', syncViewportLayout);
  document.addEventListener('pointerdown', () => {
    requestOrientationStep(state.navigationActive ? state.orientationStep : 0, { silent: true });
  }, { once: true, capture: true });
  renderUi();
  requestOrientationStep(0, { silent: true });
  if ($('apiKey')) $('apiKey').value = state.apiKey;
  $('vehicleProfile').value = state.profile;
  $('autoFollow').checked = state.autoFollow;
  if ($('keepAwake')) $('keepAwake').checked = state.keepAwake;
  updateAvatarChoiceUi();
})();

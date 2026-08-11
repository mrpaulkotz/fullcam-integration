import 'mapbox-gl/dist/mapbox-gl.css';
import '@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css';
import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { polygon, featureCollection, point } from '@turf/helpers';
// @ts-ignore - Type definitions exist but module resolution fails
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
// @ts-ignore - Type definitions exist but module resolution fails
import turfUnion from '@turf/union';
// @ts-ignore - Type definitions exist but module resolution fails
import turfArea from '@turf/area';
// @ts-ignore - Type definitions exist but module resolution fails
import turfCentroid from '@turf/centroid';
import type { Feature, Polygon, MultiPolygon } from 'geojson';
import { calculatePolygonArea, calculateCentroid } from './calculations';
import { 
  getAustralianState, 
  getNearestRainfallSite, 
  getNearestMaxTempSite,
  fetchSiloWeatherData,
  classifyClimate
} from './weather';
import type { SiloWeatherData } from './weather';
import cattleRegBySa2Code from './data/cattle-reg-by-sa2.json';

type LocationSelectionDetail = {
  kind: 'point' | 'polygon' | 'parcels';
  latitude: number;
  longitude: number;
  state: string | null;
  sa4Name: string | null;
  sa2Name: string | null;
  cattleReg: string | null;
  parcelIds?: string[];
  elevation: number | null;
  selectedYears: string[];
  weatherDataByYear: { year: string; weatherData: SiloWeatherData | null }[];
  nearestRainfallSite: {
    stationName: string;
    id: string;
    distance: string;
  } | null;
  nearestMaxTempSite: {
    stationName: string;
    id: string;
    distance: string;
  } | null;
  areaSquareMeters?: number;
  areaHectares?: number;
  geometry?: any;
  summary: string;
};

function publishLocationSelection(detail: LocationSelectionDetail | null) {
  window.dispatchEvent(new CustomEvent('fullcam-location-selected', { detail }));
}

// Mapbox access token from environment variable
const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
mapboxgl.accessToken = mapboxAccessToken;

// Geoscape Maps API - used for the cadastre (land parcel) layer
const geoscapeApiKey = import.meta.env.VITE_GEOSCAPE_API_KEY || '';
const GEOSCAPE_API_BASE_URL = 'https://api.psma.com.au/v1/maps/geoscape_v1/';

// Queensland's public cadastral parcels service (free, no API key) - used for click-to-select parcels
const QLD_CADASTRE_MAPSERVER_URL = 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer';
const QLD_CADASTRE_QUERY_URL = `${QLD_CADASTRE_MAPSERVER_URL}/4/query`;
// Esri dynamic map services aren't pre-cached into {z}/{x}/{y} tiles; Mapbox GL's raster
// sources support the {bbox-epsg-3857} template specifically for this case.
const QLD_CADASTRE_RASTER_TILE_URL =
  `${QLD_CADASTRE_MAPSERVER_URL}/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:4&format=png32&transparent=true&f=image`;

/**
 * Query the QLD cadastre service for the parcel containing a point.
 * @returns The parcel feature (with lot/plan/lotplan/lot_area/locality/shire_name properties), or null if none found.
 */
async function fetchQldParcelAtPoint(lng: number, lat: number): Promise<Feature<Polygon | MultiPolygon> | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
    outFields: 'lot,plan,lotplan,lot_area,locality,shire_name',
    outSR: '4326',
    f: 'geojson',
  });

  try {
    const response = await fetch(`${QLD_CADASTRE_QUERY_URL}?${params.toString()}`);
    if (!response.ok) {
      console.error('Failed to query QLD cadastre parcel:', response.status);
      return null;
    }
    const data = await response.json();
    return data.features?.[0] ?? null;
  } catch (error) {
    console.error('Error querying QLD cadastre parcel:', error);
    return null;
  }
}

/**
 * Get elevation at a specific point using Mapbox Terrain-RGB tileset
 * @param lng Longitude
 * @param lat Latitude
 * @returns Elevation in meters, or null if unable to fetch
 */
async function getElevation(lng: number, lat: number): Promise<number | null> {
  try {
    // Calculate tile coordinates for zoom level 15 (max resolution for terrain data)
    const zoom = 15;
    const tileX = Math.floor((lng + 180) / 360 * Math.pow(2, zoom));
    const tileY = Math.floor((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * Math.pow(2, zoom));
    
    // Fetch the terrain RGB tile
    const tileUrl = `https://api.mapbox.com/v4/mapbox.terrain-rgb/${zoom}/${tileX}/${tileY}.pngraw?access_token=${mapboxgl.accessToken}`;
    
    const response = await fetch(tileUrl);
    if (!response.ok) {
      console.error('Failed to fetch terrain tile:', response.status);
      return null;
    }
    
    const blob = await response.blob();
    const img = await createImageBitmap(blob);
    
    // Create a canvas to read pixel data
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    
    ctx.drawImage(img, 0, 0);
    
    // Calculate pixel position within the tile
    const scale = Math.pow(2, zoom);
    const pixelX = Math.floor(((lng + 180) / 360 * scale - tileX) * 256);
    const pixelY = Math.floor(((1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale - tileY) * 256);
    
    // Get RGB values at the pixel
    const imageData = ctx.getImageData(pixelX, pixelY, 1, 1);
    const [R, G, B] = imageData.data;
    
    // Decode elevation using the Mapbox formula:
    // height = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1)
    const elevation = -10000 + ((R * 256 * 256 + G * 256 + B) * 0.1);
    
    return Math.round(elevation * 10) / 10; // Round to 1 decimal place
  } catch (error) {
    console.error('Error fetching elevation:', error);
    return null;
  }
}

/**
 * Build the HTML block describing SILO weather data for a single year.
 */
function buildWeatherInfoHtml(year: string, weatherData: SiloWeatherData | null, elevation: number | null): string {
  if (!weatherData) {
    return `<br><br>Unable to fetch weather data for ${year}`;
  }

  const climateClass = classifyClimate(weatherData, elevation);
  const climateClassFiveYearAverage = classifyClimate(weatherData.fiveYearAverages, elevation);
  const fiveYearAverageInfo = weatherData.fiveYearAverages
    ? `<br><br><strong>Five-year historical averages (${weatherData.fiveYearAverages.startYear}-${weatherData.fiveYearAverages.endYear}):</strong><br>` +
      `Rainfall: ${weatherData.fiveYearAverages.rainfall} mm<br>` +
      `Average temperature: ${weatherData.fiveYearAverages.avgTemp}°C<br>` +
      `Average maximum temperature: ${weatherData.fiveYearAverages.maxTemp}°C<br>` +
      `Average minimum temperature: ${weatherData.fiveYearAverages.minTemp}°C<br>` +
      `Frost days: ${weatherData.fiveYearAverages.frostDays}<br>` +
      `Morton potential ET: ${weatherData.fiveYearAverages.mpot} mm<br>` +
      `Rainfall/ET ratio: ${(weatherData.fiveYearAverages.rainfall / weatherData.fiveYearAverages.mpot).toFixed(2)}<br>` +
      `<strong>Climate classification: ${climateClassFiveYearAverage}</strong>`
    : '';

  return `<br><br><strong>SILO Weather Data (${year}):</strong><br>` +
    `Total annual rainfall: ${weatherData.rainfall} mm<br>` +
    `Average temperature: ${weatherData.avgTemp}°C<br>` +
    `Average maximum temperature: ${weatherData.maxTemp}°C<br>` +
    `Average minimum temperature: ${weatherData.minTemp}°C<br>` +
    `Frost days (min temp < 0°C): ${weatherData.frostDays}<br>` +
    `Total Morton potential ET: ${weatherData.mpot} mm<br>` +
    `Rainfall/ET ratio: ${(weatherData.rainfall / weatherData.mpot).toFixed(2)}<br>` +
    `<strong>Climate classification: ${climateClass}</strong>` +
    fiveYearAverageInfo;
}

/**
 * Build the plain-text summary lines describing SILO weather data for a single year.
 */
function buildWeatherSummaryLines(year: string, weatherData: SiloWeatherData | null, elevation: number | null): string[] {
  const lines: string[] = [`SILO Weather Data (${year}):`];

  if (weatherData) {
    lines.push(
      `Total annual rainfall: ${weatherData.rainfall} mm`,
      `Average temperature: ${weatherData.avgTemp}°C`,
      `Average maximum temperature: ${weatherData.maxTemp}°C`,
      `Average minimum temperature: ${weatherData.minTemp}°C`,
      `Frost days (min temp < 0°C): ${weatherData.frostDays}`,
      `Total Morton potential ET: ${weatherData.mpot} mm`,
      `Rainfall/ET ratio: ${(weatherData.rainfall / weatherData.mpot).toFixed(2)}`,
      `Climate classification: ${classifyClimate(weatherData, elevation)}`,
    );

    if (weatherData.fiveYearAverages) {
      const fiveYearAverages = weatherData.fiveYearAverages;
      lines.push(
        `Five-year historical averages (${fiveYearAverages.startYear}-${fiveYearAverages.endYear}):`,
        `Rainfall: ${fiveYearAverages.rainfall} mm`,
        `Average temperature: ${fiveYearAverages.avgTemp}°C`,
        `Average maximum temperature: ${fiveYearAverages.maxTemp}°C`,
        `Average minimum temperature: ${fiveYearAverages.minTemp}°C`,
        `Frost days: ${fiveYearAverages.frostDays}`,
        `Morton potential ET: ${fiveYearAverages.mpot} mm`,
        `Rainfall/ET ratio: ${(fiveYearAverages.rainfall / fiveYearAverages.mpot).toFixed(2)}`,
        `Climate classification: ${classifyClimate(fiveYearAverages, elevation)}`,
      );
    }
  } else {
    lines.push(`Unable to fetch weather data for ${year}`);
  }

  return lines;
}

export function initializeMap(): mapboxgl.Map {
  if (!mapboxAccessToken) {
    const coordinates = document.getElementById('coordinates');
    if (coordinates) {
      coordinates.textContent = 'Mapbox access token is not set. Add VITE_MAPBOX_ACCESS_TOKEN to your .env file to enable the map.';
    }

    return {
      remove() {},
    } as unknown as mapboxgl.Map;
  }

  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [133.75953414518108, -25.806755647793132],
    zoom: 3,
    transformRequest: (url, resourceType) => {
      if ((resourceType === 'Source' || resourceType === 'Tile') && url.startsWith(GEOSCAPE_API_BASE_URL)) {
        return { url, headers: { Authorization: geoscapeApiKey } };
      }
      return { url };
    },
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  // Toggle between map styles
  let isSatellite = false;
  const styleToggle = document.getElementById('style-toggle')!;
  styleToggle.addEventListener('click', function() {
    if (isSatellite) {
      map.setStyle('mapbox://styles/mapbox/streets-v12');
      this.textContent = 'Switch to Satellite';
    } else {
      map.setStyle('mapbox://styles/mapbox/satellite-streets-v12');
      this.textContent = 'Switch to Street';
    }
    isSatellite = !isSatellite;
  });

  // Add drawing controls
  const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: {
      point: true,
      polygon: true,
      trash: true
    },
    defaultMode: 'simple_select',
  });

  // Re-add draw control after style changes
  map.on('style.load', function() {
    if (!map.hasControl(draw)) {
      map.addControl(draw);
    }

    map.addSource('weather-stations-max-temp', {
      type: 'vector',
      url: 'mapbox://pkotzzneagcrc.bu76470e'
    });
    map.addLayer({
      'id': 'weather-stations-max-temp-data',
      'type': 'circle',
      'source': 'weather-stations-max-temp',
      'source-layer': 'weather_stations_max_temp-6sezsw',
      'paint': {
        'circle-radius': 4,
        'circle-color': '#ffff00',
        'circle-opacity': 1
      }
    });

    map.addSource('weather-stations-rainfall', {
      type: 'vector',
      url: 'mapbox://pkotzzneagcrc.7pof2u7h'
    });
    map.addLayer({
      'id': 'weather-stations-rainfall-data',
      'type': 'circle',
      'source': 'weather-stations-rainfall',
      'source-layer': 'weather_stations_rainfall-0gek19',
      'paint': {
        'circle-radius': 4,
        'circle-color': '#ff00ff',
        'circle-opacity': 0.3
      }
    });

    map.addSource('abs-sa2', {
      type: 'vector',
      url: 'mapbox://pkotzzneagcrc.6j1aiouc'
    });

    map.addLayer({
      'id': 'abs-sa2-layer',
      'type': 'fill',
      'source': 'abs-sa2',
      'source-layer': 'SA2_2021_AUST_SHP_GDA2020-ct84g1',
      'paint': {
        'fill-color': 'transparent',
        'fill-outline-color': '#0000ff'
      }
    });

    map.addSource('geoscape-cadastre', {
      type: 'vector',
      tiles: [`${GEOSCAPE_API_BASE_URL}cadastre/{z}/{x}/{y}.pbf`],
    });
    map.addLayer({
      'id': 'geoscape-cadastre-layer',
      'type': 'line',
      'source': 'geoscape-cadastre',
      'source-layer': 'cadastre',
      'paint': {
        'line-color': '#54365a',
        'line-width': 1
      }
    });

    // All QLD cadastral parcel boundaries, always visible (raster export from Esri's dynamic
    // map service - there's no pre-cached vector tileset available for free)
    map.addSource('qld-cadastre', {
      type: 'raster',
      tiles: [QLD_CADASTRE_RASTER_TILE_URL],
      tileSize: 256,
    });
    map.addLayer({
      'id': 'qld-cadastre-layer',
      'type': 'raster',
      'source': 'qld-cadastre',
    });

    // Highlight layer for parcels selected via click-to-select
    map.addSource('selected-parcels', {
      type: 'geojson',
      data: featureCollection([]),
    });
    map.addLayer({
      'id': 'selected-parcels-fill',
      'type': 'fill',
      'source': 'selected-parcels',
      'paint': {
        'fill-color': '#ff9900',
        'fill-opacity': 0.35
      }
    });
    map.addLayer({
      'id': 'selected-parcels-outline',
      'type': 'line',
      'source': 'selected-parcels',
      'paint': {
        'line-color': '#ff9900',
        'line-width': 2
      }
    });

    // Style changes (e.g. satellite toggle) re-add sources/layers, so restore any in-progress selection
    renderSelectedParcels();
  });

  map.addControl(draw);

  // Click-to-select cadastral parcels (QLD only for now) - builds up a set of parcels
  // whose union becomes the "property boundary" fed into runAreaLookup.
  let isSelectingParcels = false;
  const selectedParcels = new Map<string, Feature<Polygon | MultiPolygon>>();
  const selectParcelsToggle = document.getElementById('select-parcels-toggle')!;
  const useParcelSelectionBtn = document.getElementById('use-parcel-selection') as HTMLButtonElement;
  const parcelSelectionStatus = document.getElementById('parcel-selection-status')!;

  function renderSelectedParcels() {
    const source = map.getSource('selected-parcels') as mapboxgl.GeoJSONSource | undefined;
    source?.setData(featureCollection([...selectedParcels.values()]) as any);
  }

  function updateParcelSelectionStatus() {
    if (selectedParcels.size === 0) {
      parcelSelectionStatus.textContent = '';
      useParcelSelectionBtn.style.display = 'none';
      return;
    }
    const totalAreaHectares = turfArea(featureCollection([...selectedParcels.values()]) as any) / 10000;
    const lotPlans = [...selectedParcels.keys()];
    parcelSelectionStatus.textContent =
      `${selectedParcels.size} parcel${selectedParcels.size > 1 ? 's' : ''} selected (${lotPlans.join(', ')}) - ${totalAreaHectares.toFixed(2)} ha total. Click "Use this boundary" to continue.`;
    useParcelSelectionBtn.style.display = '';
  }

  function clearParcelSelection() {
    selectedParcels.clear();
    renderSelectedParcels();
    updateParcelSelectionStatus();
  }

  selectParcelsToggle.addEventListener('click', () => {
    isSelectingParcels = !isSelectingParcels;
    selectParcelsToggle.textContent = isSelectingParcels ? 'Cancel Parcel Selection' : 'Select Parcels';
    map.getCanvas().style.cursor = isSelectingParcels ? 'crosshair' : '';
    if (isSelectingParcels) {
      // Parcel selection and the point/polygon draw flow are mutually exclusive
      draw.deleteAll();
      document.getElementById('coordinates')!.innerHTML = 'Click parcels on the map to select them';
    } else {
      clearParcelSelection();
    }
  });

  map.on('click', async (e) => {
    if (!isSelectingParcels) return;

    const parcel = await fetchQldParcelAtPoint(e.lngLat.lng, e.lngLat.lat);
    if (!parcel) {
      if (selectedParcels.size === 0) {
        parcelSelectionStatus.textContent = 'No cadastral parcel found at that location';
      }
      return;
    }

    const key = (parcel.properties?.lotplan as string | undefined) ?? String(parcel.properties?.objectid ?? `${e.lngLat.lng},${e.lngLat.lat}`);
    if (selectedParcels.has(key)) {
      selectedParcels.delete(key);
    } else {
      selectedParcels.set(key, parcel);
    }
    renderSelectedParcels();
    updateParcelSelectionStatus();
  });

  useParcelSelectionBtn.addEventListener('click', async () => {
    const features = [...selectedParcels.values()];
    if (features.length === 0) return;

    const merged = features.reduce<Feature<Polygon | MultiPolygon> | null>(
      (acc, f) => (acc ? (turfUnion(acc, f) as Feature<Polygon | MultiPolygon> | null) ?? acc : f),
      null,
    );
    if (merged) {
      await runAreaLookup('parcels', merged.geometry, [...selectedParcels.keys()]);
    }
  });

  // Store custom markers
  const customMarkers: { [key: string]: mapboxgl.Marker } = {};

  // Function to add custom marker for a point
  function addCustomMarker(feature: any) {
    if (feature.geometry.type === 'Point') {
      const [lng, lat] = feature.geometry.coordinates;
      const featureId = feature.id;

      // Remove existing marker if it exists
      if (customMarkers[featureId]) {
        customMarkers[featureId].remove();
      }

      // Create a custom marker element
      const el = document.createElement('div');
      el.className = 'custom-marker';

      // Create and add the marker
      const marker = new mapboxgl.Marker(el)
        .setLngLat([lng, lat])
        .addTo(map);

      customMarkers[featureId] = marker;
    }
  }

  // Function to remove custom marker
  function removeCustomMarker(featureId: string) {
    if (customMarkers[featureId]) {
      customMarkers[featureId].remove();
      delete customMarkers[featureId];
    }
  }

  // Listen for draw.create to add custom markers
  map.on('draw.create', (e: any) => {
    clearParcelSelection();
    e.features.forEach((feature: any) => {
      if (feature.geometry.type === 'Point') {
        addCustomMarker(feature);
      }
    });
    updateArea(e);
  });

  // Listen for draw.delete to remove custom markers
  map.on('draw.delete', (e: any) => {
    e.features.forEach((feature: any) => {
      if (feature.geometry.type === 'Point') {
        removeCustomMarker(feature.id);
      }
    });
    
    const data = draw.getAll();
    if (data.features.length === 0) {
      document.getElementById('coordinates')!.innerHTML = 'Add a point or polygon to the map to get location and weather information';
    } else {
      updateArea(e);
    }
  });

  // Listen for draw.update to update custom markers
  map.on('draw.update', (e: any) => {
    e.features.forEach((feature: any) => {
      if (feature.geometry.type === 'Point') {
        addCustomMarker(feature);
      }
    });
    updateArea(e);
  });

  // The abs-sa2-layer tileset's SA2 code property name isn't confirmed yet -
  // try known ABS ASGS field names until the layer is updated to a known schema.
  const SA2_CODE_PROPERTY_CANDIDATES = ['SA2_CODE21', 'SA2_MAIN21', 'SA2_MAIN16'];

  function getSa2Code(properties: Record<string, any>): string | null {
    for (const key of SA2_CODE_PROPERTY_CANDIDATES) {
      if (properties[key]) {
        return String(properties[key]);
      }
    }
    return null;
  }

  // Function to get SA2_NAME21 / SA4_NAME21 / Cattle_Reg from abs-sa2-layer at a location
  function getSA2Region(lng: number, lat: number): { sa2Name: string | null; sa4Name: string | null; cattleReg: string | null } {
    const empty = { sa2Name: null, sa4Name: null, cattleReg: null };
    try {
      // Check if layer exists
      if (!map.getLayer('abs-sa2-layer')) {
        console.log('abs-sa2-layer not found');
        return empty;
      }

      const pt = point([lng, lat]);

      // Query rendered features at the point location
      const screenPoint = map.project([lng, lat]);
      const features = map.queryRenderedFeatures(screenPoint, {
        layers: ['abs-sa2-layer']
      });

      console.log('SA2 features found at point:', features.length);

      // Find the feature that contains this point
      for (const feature of features) {
        if (feature.geometry.type === 'Polygon' || feature.geometry.type === 'MultiPolygon') {
          try {
            // Use turf to check if point is inside polygon
            const isInside = booleanPointInPolygon(pt, feature.geometry as any);

            if (isInside && feature.properties) {
              const sa2Name = feature.properties['SA2_NAME21'] || null;
              const sa4Name = feature.properties['SA4_NAME21'] || null;
              const sa2Code = getSa2Code(feature.properties);
              const cattleReg = sa2Code ? (cattleRegBySa2Code as Record<string, string>)[sa2Code] || null : null;
              console.log('Found SA2 region:', sa2Name, 'SA4 region:', sa4Name, 'SA2 code:', sa2Code, 'Cattle_Reg:', cattleReg);
              return { sa2Name, sa4Name, cattleReg };
            }
          } catch (e) {
            // Skip invalid geometries
            continue;
          }
        }
      }

      console.log('No SA2/SA4 region found - may need to zoom in for data to load');
    } catch (error) {
      console.error('Error querying SA2/SA4 region:', error);
    }
    return empty;
  }

  // Runs the full state/weather/elevation/SA2/rainfall lookup pipeline for an area (a drawn
  // polygon, or the union of one or more click-selected cadastral parcels) and publishes it.
  async function runAreaLookup(
    kind: 'polygon' | 'parcels',
    geometry: Polygon | MultiPolygon,
    parcelIds?: string[],
  ): Promise<void> {
    const yearSelect = document.getElementById('year-select') as HTMLSelectElement;
    const selectedYears = Array.from(yearSelect.selectedOptions).map((option) => option.value);

    // Keep the existing draw-polygon path on its original hand-rolled math; only merged
    // multi-parcel MultiPolygons use turf, since calculatePolygonArea/calculateCentroid don't support them.
    let areaInSquareMeters: number;
    let centroid: { lng: number; lat: number };
    if (geometry.type === 'Polygon') {
      areaInSquareMeters = calculatePolygonArea(geometry.coordinates);
      centroid = calculateCentroid(geometry.coordinates);
    } else {
      areaInSquareMeters = turfArea(geometry);
      const centroidFeature = turfCentroid(geometry);
      centroid = { lng: centroidFeature.geometry.coordinates[0], lat: centroidFeature.geometry.coordinates[1] };
    }
    const areaInHectares = areaInSquareMeters / 10000;
    const headerLabel = kind === 'parcels'
      ? `Parcels selected${parcelIds && parcelIds.length ? ` (${parcelIds.join(', ')})` : ''}`
      : 'Polygon selected';

    // Show loading message
    document.getElementById('coordinates')!.innerHTML = `Calculating ${kind === 'parcels' ? 'parcel' : 'polygon'} data...`;

    const state = await getAustralianState(centroid.lng, centroid.lat);
    const weatherDataByYear = await Promise.all(
      selectedYears.map(async (year) => ({
        year,
        weatherData: await fetchSiloWeatherData(centroid.lat, centroid.lng, year),
      })),
    );
    const elevation = await getElevation(centroid.lng, centroid.lat);
    const nearestRainfallSite = getNearestRainfallSite(map, centroid.lng, centroid.lat);
    const nearestMaxTempSite = getNearestMaxTempSite(map, centroid.lng, centroid.lat);
    const { sa2Name, sa4Name, cattleReg } = getSA2Region(centroid.lng, centroid.lat);

    console.log(`${kind} centroid:`, { latitude: centroid.lat, longitude: centroid.lng, state, elevation, weatherDataByYear, sa2Name, sa4Name, cattleReg });

    let elevationInfo = '';
    if (elevation !== null) {
      elevationInfo = `<br>Elevation (centroid): ${elevation} m`;
    }

    const weatherInfo = weatherDataByYear
      .map(({ year, weatherData }) => buildWeatherInfoHtml(year, weatherData, elevation))
      .join('');

    let RainfallSiteInfo = '';
    if (nearestRainfallSite) {
      const props = nearestRainfallSite.properties;
      RainfallSiteInfo = `<br><br>Nearest Rainfall Site:<br>Station: ${props.station_name || props.name || 'N/A'}<br>ID: ${props.site || props.id || 'N/A'}<br>Distance: ${nearestRainfallSite.distance} km`;
    }

    let MaxTempSiteInfo = '';
    if (nearestMaxTempSite) {
      const props = nearestMaxTempSite.properties;
      MaxTempSiteInfo = `<br><br>Nearest Max Temp Site:<br>Station: ${props.station_name || props.name || 'N/A'}<br>ID: ${props.site || props.id || 'N/A'}<br>Distance: ${nearestMaxTempSite.distance} km`;
    }

    let sa4Info = '';
    if (sa4Name) {
      sa4Info = `<br><br><strong>SA4 Region:</strong> ${sa4Name}`;
    } else {
      sa4Info = `<br><br><strong>SA4 Region:</strong> No SA4 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again`;
    }

    let sa2Info = '';
    if (sa2Name) {
      sa2Info = `<br><strong>SA2 Region:</strong> ${sa2Name}`;
    } else {
      sa2Info = `<br><strong>SA2 Region:</strong> No SA2 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again`;
    }

    let cattleRegInfo = '';
    if (cattleReg) {
      cattleRegInfo = `<br><strong>Cattle Region:</strong> ${cattleReg}`;
    }

    document.getElementById('coordinates')!.innerHTML =
      `${headerLabel}<br>Area: ${areaInHectares.toFixed(2)} hectares<br>(${areaInSquareMeters.toFixed(2)} m²)<br>Centroid:<br>Latitude: ${centroid.lat.toFixed(6)}<br>Longitude: ${centroid.lng.toFixed(6)}${elevationInfo}<br>State: ${state}${sa4Info}${sa2Info}${cattleRegInfo}${weatherInfo}${RainfallSiteInfo}${MaxTempSiteInfo}`;

    const summaryLines: (string | null)[] = [
      headerLabel,
      `Area: ${areaInHectares.toFixed(2)} hectares`,
      `(${areaInSquareMeters.toFixed(2)} m²)`,
      'Centroid:',
      `Latitude: ${centroid.lat.toFixed(6)}`,
      `Longitude: ${centroid.lng.toFixed(6)}`,
      elevation !== null ? `Elevation (centroid): ${elevation} m` : null,
      `State: ${state}`,
      sa4Name
        ? `SA4 Region: ${sa4Name}`
        : 'SA4 Region: No SA4 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again',
      sa2Name
        ? `SA2 Region: ${sa2Name}`
        : 'SA2 Region: No SA2 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again',
      cattleReg ? `Cattle Region: ${cattleReg}` : null,
      ...weatherDataByYear.flatMap(({ year, weatherData }) =>
        buildWeatherSummaryLines(year, weatherData, elevation),
      ),
    ];

    if (nearestRainfallSite) {
      const props = nearestRainfallSite.properties;
      summaryLines.push(
        'Nearest Rainfall Site:',
        `Station: ${props.station_name || props.name || 'N/A'}`,
        `ID: ${props.site || props.id || 'N/A'}`,
        `Distance: ${nearestRainfallSite.distance} km`,
      );
    }

    if (nearestMaxTempSite) {
      const props = nearestMaxTempSite.properties;
      summaryLines.push(
        'Nearest Max Temp Site:',
        `Station: ${props.station_name || props.name || 'N/A'}`,
        `ID: ${props.site || props.id || 'N/A'}`,
        `Distance: ${nearestMaxTempSite.distance} km`,
      );
    }

    publishLocationSelection({
      kind,
      latitude: centroid.lat,
      longitude: centroid.lng,
      state,
      sa4Name,
      sa2Name,
      cattleReg,
      parcelIds,
      elevation,
      selectedYears,
      weatherDataByYear,
      nearestRainfallSite: nearestRainfallSite ? {
        stationName: nearestRainfallSite.properties.station_name || nearestRainfallSite.properties.name || 'N/A',
        id: String(nearestRainfallSite.properties.site || nearestRainfallSite.properties.id || 'N/A'),
        distance: nearestRainfallSite.distance,
      } : null,
      nearestMaxTempSite: nearestMaxTempSite ? {
        stationName: nearestMaxTempSite.properties.station_name || nearestMaxTempSite.properties.name || 'N/A',
        id: String(nearestMaxTempSite.properties.site || nearestMaxTempSite.properties.id || 'N/A'),
        distance: nearestMaxTempSite.distance,
      } : null,
      areaSquareMeters: areaInSquareMeters,
      areaHectares: areaInHectares,
      geometry,
      summary: summaryLines.filter(Boolean).join('\n'),
    });
  }

  async function updateArea(e: any) {
    const data = draw.getAll();
    const selectedFeatures = e.features || [];
    const yearSelect = document.getElementById('year-select') as HTMLSelectElement;
    const selectedYears = Array.from(yearSelect.selectedOptions).map((option) => option.value);

    if (selectedFeatures.length > 0) {
      const feature = selectedFeatures[0];

      // Check if it's a point (marker)
      if (feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates;
        
        // Show loading message
        document.getElementById('coordinates')!.innerHTML = 'Loading weather and elevation data...';
        
        const state = await getAustralianState(lng, lat);
        const weatherDataByYear = await Promise.all(
          selectedYears.map(async (year) => ({
            year,
            weatherData: await fetchSiloWeatherData(lat, lng, year),
          })),
        );
        const elevation = await getElevation(lng, lat);
        const nearestRainfallSite = getNearestRainfallSite(map, lng, lat);
        const nearestMaxTempSite = getNearestMaxTempSite(map, lng, lat);
        const { sa2Name, sa4Name, cattleReg } = getSA2Region(lng, lat);

        console.log('Marker coordinates:', { latitude: lat, longitude: lng, state, elevation, weatherDataByYear, sa2Name, sa4Name, cattleReg });

        let elevationInfo = '';
        if (elevation !== null) {
          elevationInfo = `<br>Elevation: ${elevation} m`;
        }

        const weatherInfo = weatherDataByYear
          .map(({ year, weatherData }) => buildWeatherInfoHtml(year, weatherData, elevation))
          .join('');

        let RainfallSiteInfo = '';
        if (nearestRainfallSite) {
          const props = nearestRainfallSite.properties;
          RainfallSiteInfo = `<br><br>Nearest Rainfall Site:<br>Station: ${props.station_name || props.name || 'N/A'}<br>ID: ${props.site || props.id || 'N/A'}<br>Distance: ${nearestRainfallSite.distance} km`;
        }

        let MaxTempSiteInfo = '';
        if (nearestMaxTempSite) {
          const props = nearestMaxTempSite.properties;
          MaxTempSiteInfo = `<br><br>Nearest Max Temp Site:<br>Station: ${props.station_name || props.name || 'N/A'}<br>ID: ${props.site || props.id || 'N/A'}<br>Distance: ${nearestMaxTempSite.distance} km`;
        }

        let sa4Info = '';
        if (sa4Name) {
          sa4Info = `<br><br><strong>SA4 Region:</strong> ${sa4Name}`;
        } else {
          sa4Info = `<br><br><strong>SA4 Region:</strong> No SA4 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again`;
        }

        let sa2Info = '';
        if (sa2Name) {
          sa2Info = `<br><strong>SA2 Region:</strong> ${sa2Name}`;
        } else {
          sa2Info = `<br><strong>SA2 Region:</strong> No SA2 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again`;
        }

        let cattleRegInfo = '';
        if (cattleReg) {
          cattleRegInfo = `<br><strong>Cattle Region:</strong> ${cattleReg}`;
        }

        document.getElementById('coordinates')!.innerHTML =
          `Marker selected<br>Latitude: ${lat.toFixed(6)}<br>Longitude: ${lng.toFixed(6)}${elevationInfo}<br>State: ${state}${sa4Info}${sa2Info}${cattleRegInfo}${weatherInfo}${RainfallSiteInfo}${MaxTempSiteInfo}`;

        const pointSummaryLines: (string | null)[] = [
          'Marker selected',
          `Latitude: ${lat.toFixed(6)}`,
          `Longitude: ${lng.toFixed(6)}`,
          elevation !== null ? `Elevation: ${elevation} m` : null,
          `State: ${state}`,
          sa4Name
            ? `SA4 Region: ${sa4Name}`
            : 'SA4 Region: No SA4 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again',
          sa2Name
            ? `SA2 Region: ${sa2Name}`
            : 'SA2 Region: No SA2 region found - zoom in until you see the SA2 boundaries and add the pin or polygon again',
          cattleReg ? `Cattle Region: ${cattleReg}` : null,
          ...weatherDataByYear.flatMap(({ year, weatherData }) =>
            buildWeatherSummaryLines(year, weatherData, elevation),
          ),
        ];

        if (nearestRainfallSite) {
          const props = nearestRainfallSite.properties;
          pointSummaryLines.push(
            'Nearest Rainfall Site:',
            `Station: ${props.station_name || props.name || 'N/A'}`,
            `ID: ${props.site || props.id || 'N/A'}`,
            `Distance: ${nearestRainfallSite.distance} km`,
          );
        }

        if (nearestMaxTempSite) {
          const props = nearestMaxTempSite.properties;
          pointSummaryLines.push(
            'Nearest Max Temp Site:',
            `Station: ${props.station_name || props.name || 'N/A'}`,
            `ID: ${props.site || props.id || 'N/A'}`,
            `Distance: ${nearestMaxTempSite.distance} km`,
          );
        }

        publishLocationSelection({
          kind: 'point',
          latitude: lat,
          longitude: lng,
          state,
          sa4Name,
          sa2Name,
          cattleReg,
          elevation,
          selectedYears,
          weatherDataByYear,
          nearestRainfallSite: nearestRainfallSite ? {
            stationName: nearestRainfallSite.properties.station_name || nearestRainfallSite.properties.name || 'N/A',
            id: String(nearestRainfallSite.properties.site || nearestRainfallSite.properties.id || 'N/A'),
            distance: nearestRainfallSite.distance,
          } : null,
          nearestMaxTempSite: nearestMaxTempSite ? {
            stationName: nearestMaxTempSite.properties.station_name || nearestMaxTempSite.properties.name || 'N/A',
            id: String(nearestMaxTempSite.properties.site || nearestMaxTempSite.properties.id || 'N/A'),
            distance: nearestMaxTempSite.distance,
          } : null,
          geometry: feature.geometry,
          summary: pointSummaryLines.filter(Boolean).join('\n'),
        });
      }
      // Check if it's a polygon
      else if (feature.geometry.type === 'Polygon') {
        await runAreaLookup('polygon', feature.geometry);
      }
    } else if (data.features.length === 0) {
      document.getElementById('coordinates')!.innerHTML = 'Draw on the map';
      publishLocationSelection(null);
    } else {
      document.getElementById('coordinates')!.innerHTML =
        `Features: ${data.features.length}<br>Select a feature to view details`;
      publishLocationSelection(null);
    }
  }

  map.on('draw.selectionchange', updateArea);

  // Listen for year selection changes
  document.getElementById('year-select')!.addEventListener('change', function() {
    const data = draw.getAll();
    if (data.features.length > 0) {
      const selectedFeatures = draw.getSelected();
      if (selectedFeatures.features.length > 0) {
        updateArea({ features: selectedFeatures.features });
      }
    }
  });

  return map;
}

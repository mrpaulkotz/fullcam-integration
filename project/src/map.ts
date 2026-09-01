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
// @ts-ignore - Type definitions exist but module resolution fails
import turfBbox from '@turf/bbox';
// @ts-ignore - No type definitions published for this package
import toGeoJSON from '@mapbox/togeojson';
import JSZip from 'jszip';
import type { Feature, FeatureCollection, Point, Polygon, MultiPolygon } from 'geojson';
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
import { getLeachingRisk } from './leaching';

/** The map's camera position - center (lng/lat) and zoom - at the time a selection was made. */
export type MapView = {
  center: [number, number];
  zoom: number;
};

export type LocationSelectionDetail = {
  kind: 'point' | 'polygon' | 'parcels';
  latitude: number;
  longitude: number;
  /** The map's pan/zoom at the moment of this selection - save alongside geometry/parcelKeys
   * and pass back via SavedLocationSelection.mapView to restore the same view on reload. */
  mapView: MapView;
  state: string | null;
  sa4Name: string | null;
  sa2Name: string | null;
  cattleReg: string | null;
  /** Soil leaching zone at this point - null if outside the classified raster's extent/NoData. */
  leachingRisk: boolean | null;
  /** Human-readable parcel labels (e.g. "QLD 3RP91637") for display only - not stable enough to re-query by. */
  parcelIds?: string[];
  /** Stable "STATE:objectid" identifiers - save these (not parcelIds) to restore a parcel selection later via SavedLocationSelection. */
  parcelKeys?: string[];
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

/** A previously-saved selection (from a LocationSelectionDetail this map published earlier)
 * to restore on init - pass to initializeMap(). Host apps have no other way to persist a
 * selection across page loads, since this map keeps no storage of its own. */
export type SavedLocationSelection = (
  | { kind: 'point'; geometry: Point }
  | { kind: 'polygon'; geometry: Polygon }
  | { kind: 'parcels'; parcelKeys: string[] }
) & {
  /** Optional - if provided (e.g. from a previous LocationSelectionDetail.mapView), the map
   * starts at this pan/zoom instead of the default Australia-wide view. */
  mapView?: MapView;
};

function publishLocationSelection(detail: LocationSelectionDetail | null) {
  window.dispatchEvent(new CustomEvent('fullcam-location-selected', { detail }));
}

// Mapbox access token from environment variable
const mapboxAccessToken = import.meta.env.VITE_MAPBOX_ACCESS_TOKEN || '';
mapboxgl.accessToken = mapboxAccessToken;

// Free, keyless state-government cadastral parcel services used for click-to-select parcels.
// Each state's Esri REST service uses different field names for its parcel identifier, and
// only MapServer-backed services (not FeatureServer) support the /export raster endpoint used
// for the "always visible" background boundary layer - VIC's is FeatureServer-only, so it has
// no rasterExportUrl and only participates in click-to-select, not the background layer.
type CadastreStateConfig = {
  name: string;
  queryUrl: string;
  outFields: string;
  idField: string;
  /** The service's true unique row id field (Esri OID) - used as the selection key, since
   * idField can be null/non-unique for non-lot features (easements, roads, etc). */
  objectIdField: string;
  rasterExportUrl?: string;
};

const CADASTRE_STATE_CONFIGS: CadastreStateConfig[] = [
  {
    name: 'QLD',
    queryUrl: 'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/4/query',
    outFields: 'objectid,lot,plan,lotplan,lot_area,locality,shire_name',
    idField: 'lotplan',
    objectIdField: 'objectid',
    rasterExportUrl:
      'https://spatial-gis.information.qld.gov.au/arcgis/rest/services/PlanningCadastre/LandParcelPropertyFramework/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:4&format=png32&transparent=true&f=image',
  },
  {
    name: 'NSW',
    queryUrl: 'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/9/query',
    outFields: 'objectid,lotidstring,lotnumber,planlabel,planlotarea',
    idField: 'lotidstring',
    objectIdField: 'objectid',
    // maps.six.nsw.gov.au is unreliable (occasional 500s / hangs on both /export and /query),
    // but showing parcels is preferred over not - click-select queries are timeout-guarded
    // (CADASTRE_QUERY_TIMEOUT_MS) so a bad request degrades gracefully rather than blocking.
    rasterExportUrl:
      'https://maps.six.nsw.gov.au/arcgis/rest/services/public/NSW_Cadastre/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:9&format=png32&transparent=true&f=image',
  },
  {
    name: 'VIC',
    queryUrl: 'https://services-ap1.arcgis.com/P744lA0wf4LlBZ84/ArcGIS/rest/services/Vicmap_Parcel/FeatureServer/0/query',
    outFields: 'OBJECTID,parcel_spi,parcel_lot_number,parcel_plan_number,Shape__Area',
    idField: 'parcel_spi',
    objectIdField: 'OBJECTID',
    // FeatureServer-only - no /export raster endpoint, so no background layer for VIC
  },
  {
    name: 'TAS',
    queryUrl: 'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreParcels/MapServer/0/query',
    outFields: 'OBJECTID,PID,VOLUME,FOLIO,MEAS_AREA,PROP_NAME',
    idField: 'PID',
    objectIdField: 'OBJECTID',
    rasterExportUrl:
      'https://services.thelist.tas.gov.au/arcgis/rest/services/Public/CadastreParcels/MapServer/export?bbox={bbox-epsg-3857}&bboxSR=3857&imageSR=3857&size=256,256&layers=show:0&format=png32&transparent=true&f=image',
  },
];

// QLD's own cadastre layer enforces minScale: 1,000,000 server-side (~zoom 9.2); used as the
// client-side minzoom for all cadastre background layers so parcels only render once legible.
const CADASTRE_PARCEL_MIN_ZOOM = 10;

// The leaching-map tileset (pkotzzneagcrc.8uf3g8) has real tile data only up to its native
// maxzoom (4, matching its ~10km/pixel source resolution). Beyond that, Mapbox synthesizes an
// overzoomed tile - and that path drops the layer's alpha transparency, rendering solid black
// instead (reproduces in Mapbox Studio's own preview too, so it's a Mapbox-side limitation, not
// something fixable here). Capping the layer's own maxzoom hides it before that kicks in, rather
// than showing the broken black fill. The true/false answer at a point is unaffected - it's read
// from the source raster directly (see leaching.ts), not from this tileset, at any zoom.
const LEACHING_LAYER_MAX_ZOOM = 2.5;

// Some state cadastre services (NSW's in particular) are prone to hanging indefinitely rather
// than erroring out. Since queries fan out to all states in parallel via Promise.all, one hung
// request would otherwise stall every click selection regardless of which state matched.
const CADASTRE_QUERY_TIMEOUT_MS = 8000;

function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timeout));
}

/**
 * Run an Esri REST cadastre query and return its first feature, tagged with which state config
 * matched. Shared by point/objectId lookups below, which differ only in which query params they send.
 */
async function queryFirstParcel(
  config: CadastreStateConfig,
  extraParams: Record<string, string>,
): Promise<Feature<Polygon | MultiPolygon> | null> {
  const params = new URLSearchParams({
    outFields: config.outFields,
    outSR: '4326',
    f: 'geojson',
    ...extraParams,
  });

  try {
    const response = await fetchWithTimeout(`${config.queryUrl}?${params.toString()}`, CADASTRE_QUERY_TIMEOUT_MS);
    if (!response.ok) {
      console.error(`Failed to query ${config.name} cadastre parcel:`, response.status);
      return null;
    }
    const data = await response.json();
    const feature = data.features?.[0];
    if (!feature) return null;
    return { ...feature, properties: { ...feature.properties, __cadastreState: config.name } };
  } catch (error) {
    console.error(`Error querying ${config.name} cadastre parcel:`, error);
    return null;
  }
}

/**
 * Query a state cadastre service for the parcel containing a point.
 * @returns The parcel feature tagged with which state config matched, or null if none found.
 */
async function fetchParcelAtPoint(
  config: CadastreStateConfig,
  lng: number,
  lat: number,
): Promise<Feature<Polygon | MultiPolygon> | null> {
  return queryFirstParcel(config, {
    geometry: `${lng},${lat}`,
    geometryType: 'esriGeometryPoint',
    inSR: '4326',
    spatialRel: 'esriSpatialRelIntersects',
  });
}

/**
 * Query a state cadastre service for a specific parcel by its Esri object id - used to restore
 * a previously-saved parcel selection (see SavedLocationSelection) without needing a point to click.
 */
async function fetchParcelByObjectId(
  config: CadastreStateConfig,
  objectId: string,
): Promise<Feature<Polygon | MultiPolygon> | null> {
  return queryFirstParcel(config, { objectIds: objectId });
}

/**
 * Query all configured state cadastre services in parallel for the parcel at a point.
 * At most one state's service should ever return a match for a given point.
 */
async function fetchParcelAtPointAnyState(lng: number, lat: number): Promise<Feature<Polygon | MultiPolygon> | null> {
  const results = await Promise.all(
    CADASTRE_STATE_CONFIGS.map((config) => fetchParcelAtPoint(config, lng, lat)),
  );
  return results.find((result): result is Feature<Polygon | MultiPolygon> => result !== null) ?? null;
}

/** Build a human-readable, state-prefixed parcel identifier for display purposes only. */
function getParcelDisplayId(parcel: Feature<Polygon | MultiPolygon>): string {
  const stateName = parcel.properties?.__cadastreState as string | undefined;
  const config = CADASTRE_STATE_CONFIGS.find((c) => c.name === stateName);
  const idValue = config ? parcel.properties?.[config.idField] : undefined;
  return `${stateName ?? '?'} ${idValue ?? 'unknown parcel'}`;
}

/**
 * Build the selection/dedup key for a parcel, using each service's guaranteed-unique Esri
 * object id rather than the lot/plan display field - that field can be null or ambiguous for
 * non-lot features (easements, roads), which previously caused unrelated parcels to collide
 * and wrongly deselect each other.
 */
function getParcelKey(parcel: Feature<Polygon | MultiPolygon>): string | null {
  const stateName = parcel.properties?.__cadastreState as string | undefined;
  const config = CADASTRE_STATE_CONFIGS.find((c) => c.name === stateName);
  const objectId = config ? parcel.properties?.[config.objectIdField] : undefined;
  if (objectId === undefined || objectId === null) return null;
  return `${stateName}:${objectId}`;
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

/**
 * Build the HTML fragment describing the soil leaching zone at a point - empty string if the
 * point falls outside the classified raster's extent or in a NoData cell.
 */
function buildLeachingInfoHtml(leachingRisk: boolean | null): string {
  if (leachingRisk === null) return '';
  return `<br><strong>Is in leaching zone:</strong> ${leachingRisk ? 'Yes' : 'No'}`;
}

function buildLeachingSummaryLine(leachingRisk: boolean | null): string | null {
  if (leachingRisk === null) return null;
  return `Is in leaching zone: ${leachingRisk ? 'Yes' : 'No'}`;
}

export function initializeMap(initialSelection?: SavedLocationSelection): mapboxgl.Map {
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
    center: initialSelection?.mapView?.center ?? [133.75953414518108, -25.806755647793132],
    zoom: initialSelection?.mapView?.zoom ?? 3,
  });

  map.addControl(new mapboxgl.NavigationControl(), 'top-right');

  function getMapView(): MapView {
    const center = map.getCenter();
    return { center: [center.lng, center.lat], zoom: map.getZoom() };
  }

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

  // Toggle the soil leaching zone overlay - re-applied after style changes in the
  // style.load handler below, since setStyle() wipes and re-adds all layers.
  let leachingLayerVisible = false;
  const leachingLayerToggle = document.getElementById('leaching-layer-toggle') as HTMLInputElement | null;
  const leachingZoomNotice = document.getElementById('leaching-zoom-notice')!;

  // The layer itself is hidden past LEACHING_LAYER_MAX_ZOOM (see its definition for why) - this
  // just tells the user their toggle is still "on" rather than letting it look like it broke.
  function updateLeachingZoomNotice() {
    leachingZoomNotice.textContent =
      leachingLayerVisible && map.getZoom() >= LEACHING_LAYER_MAX_ZOOM
        ? 'Leaching map visually hidden when zoomed in, but still active. Zoom out to see the leaching zone map layer.'
        : '';
  }

  leachingLayerToggle?.addEventListener('change', () => {
    leachingLayerVisible = leachingLayerToggle.checked;
    if (map.getLayer('leaching-map-layer')) {
      map.setLayoutProperty('leaching-map-layer', 'visibility', leachingLayerVisible ? 'visible' : 'none');
    }
    updateLeachingZoomNotice();
  });
  map.on('zoom', updateLeachingZoomNotice);

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
      // Hidden - kept as a source-only layer so querySourceFeatures (getNearestMaxTempSite) still works.
      'layout': {
        'visibility': 'none'
      },
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
      // Hidden - kept as a source-only layer so querySourceFeatures (getNearestRainfallSite) still works.
      'layout': {
        'visibility': 'none'
      },
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

    // All cadastral parcel boundaries, for each state whose service supports raster export
    // (VIC is FeatureServer-only and has no background layer - see config above). QLD's own
    // service enforces minScale: 1,000,000 server-side (~zoom 9.2) - matched here as a client-side
    // minzoom, applied uniformly, so tiles aren't even requested until parcels are legible.
    CADASTRE_STATE_CONFIGS.forEach((config) => {
      if (!config.rasterExportUrl) return;
      const sourceId = `cadastre-${config.name.toLowerCase()}`;
      map.addSource(sourceId, {
        type: 'raster',
        tiles: [config.rasterExportUrl!],
        tileSize: 256,
        minzoom: CADASTRE_PARCEL_MIN_ZOOM,
      });
      map.addLayer({
        'id': `${sourceId}-layer`,
        'type': 'raster',
        'source': sourceId,
      });
    });

    // Soil leaching zone overlay (visual only - the click-to-check true/false answer is read
    // from the original raster directly via leaching.ts, not from this tileset; see there for why).
    // Hidden by default and toggled via the "Show leaching map" checkbox.
    map.addSource('leaching-map', {
      type: 'raster',
      url: 'mapbox://pkotzzneagcrc.8uf3g8',
    });
    map.addLayer({
      'id': 'leaching-map-layer',
      'type': 'raster',
      'source': 'leaching-map',
      'maxzoom': LEACHING_LAYER_MAX_ZOOM,
      'layout': {
        'visibility': 'none'
      }
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

    // Highlight layer for an uploaded KML/KMZ boundary that couldn't be added to MapboxDraw
    // (MapboxDraw only supports a single Polygon - disjoint multi-part shapes render here instead).
    map.addSource('kml-boundary', {
      type: 'geojson',
      data: featureCollection([]),
    });
    map.addLayer({
      'id': 'kml-boundary-fill',
      'type': 'fill',
      'source': 'kml-boundary',
      'paint': {
        'fill-color': '#2196f3',
        'fill-opacity': 0.25
      }
    });
    map.addLayer({
      'id': 'kml-boundary-outline',
      'type': 'line',
      'source': 'kml-boundary',
      'paint': {
        'line-color': '#2196f3',
        'line-width': 2
      }
    });

    // Style changes (e.g. satellite toggle) re-add sources/layers, so restore any in-progress selection
    renderSelectedParcels();
    renderKmlBoundary();
    map.setLayoutProperty('leaching-map-layer', 'visibility', leachingLayerVisible ? 'visible' : 'none');
  });

  map.addControl(draw);

  // Click-to-select cadastral parcels - builds up a set of parcels whose union becomes the
  // "property boundary" fed into runAreaLookup.
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
    const lotPlans = [...selectedParcels.values()].map(getParcelDisplayId);
    parcelSelectionStatus.textContent =
      `${selectedParcels.size} parcel${selectedParcels.size > 1 ? 's' : ''} selected (${lotPlans.join(', ')}) - ${totalAreaHectares.toFixed(2)} ha total. Click "Use this boundary" to continue.`;
    useParcelSelectionBtn.style.display = '';
  }

  function clearParcelSelection() {
    selectedParcels.clear();
    renderSelectedParcels();
    updateParcelSelectionStatus();
  }

  // Displays an uploaded KML/KMZ boundary that couldn't be added to MapboxDraw (a MultiPolygon -
  // draw only supports a single Polygon). Cleared whenever another selection method takes over.
  let kmlBoundaryFeature: Feature<Polygon | MultiPolygon> | null = null;

  function renderKmlBoundary() {
    const source = map.getSource('kml-boundary') as mapboxgl.GeoJSONSource | undefined;
    source?.setData(featureCollection(kmlBoundaryFeature ? [kmlBoundaryFeature] : []) as any);
  }

  function clearKmlBoundary() {
    kmlBoundaryFeature = null;
    renderKmlBoundary();
  }

  selectParcelsToggle.addEventListener('click', () => {
    isSelectingParcels = !isSelectingParcels;
    selectParcelsToggle.textContent = isSelectingParcels ? 'Cancel Parcel Selection' : 'Select Parcels';
    map.getCanvas().style.cursor = isSelectingParcels ? 'crosshair' : '';
    clearKmlBoundary();
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

    const parcel = await fetchParcelAtPointAnyState(e.lngLat.lng, e.lngLat.lat);
    if (!parcel) {
      if (selectedParcels.size === 0) {
        parcelSelectionStatus.textContent = 'No cadastral parcel found at that location';
      }
      return;
    }

    const key = getParcelKey(parcel);
    if (!key) {
      console.error('Parcel has no object id, cannot select it:', parcel);
      return;
    }
    if (selectedParcels.has(key)) {
      selectedParcels.delete(key);
    } else {
      selectedParcels.set(key, parcel);
    }
    renderSelectedParcels();
    updateParcelSelectionStatus();
  });

  // Unions the current selectedParcels and runs the full lookup pipeline on the result - shared
  // by the "Use this boundary" button and by restoring a saved parcel selection on init, so both
  // end up in exactly the same state.
  async function finalizeParcelSelection() {
    const features = [...selectedParcels.values()];
    if (features.length === 0) return;

    const merged = features.reduce<Feature<Polygon | MultiPolygon> | null>(
      (acc, f) => (acc ? (turfUnion(acc, f) as Feature<Polygon | MultiPolygon> | null) ?? acc : f),
      null,
    );
    if (merged) {
      const parcelIds = features.map(getParcelDisplayId);
      const parcelKeys = features.map(getParcelKey).filter((key): key is string => key !== null);
      await runAreaLookup('parcels', merged.geometry, parcelIds, parcelKeys);
    }
  }

  useParcelSelectionBtn.addEventListener('click', finalizeParcelSelection);

  // Upload a .kml/.kmz file and use its polygon(s) as the area boundary - same downstream
  // pipeline (state/weather/elevation/SA2/rainfall lookup) as a drawn polygon or parcel selection.
  // .kmz is just a zip archive containing a .kml file (plus optional media) - unzip it first.
  async function extractKmlText(file: File): Promise<string | null> {
    if (!file.name.toLowerCase().endsWith('.kmz')) {
      return file.text();
    }
    const zip = await JSZip.loadAsync(file);
    const kmlEntry = Object.values(zip.files).find(
      (entry) => !entry.dir && entry.name.toLowerCase().endsWith('.kml'),
    );
    return kmlEntry ? kmlEntry.async('text') : null;
  }

  const kmlUploadInput = document.getElementById('kml-upload') as HTMLInputElement | null;
  kmlUploadInput?.addEventListener('change', async () => {
    const file = kmlUploadInput.files?.[0];
    if (!file) return;

    try {
      const text = await extractKmlText(file);
      if (text === null) {
        document.getElementById('coordinates')!.innerHTML = 'No .kml file found inside that .kmz archive';
        return;
      }
      const xmlDoc = new DOMParser().parseFromString(text, 'text/xml');
      if (xmlDoc.querySelector('parsererror')) {
        document.getElementById('coordinates')!.innerHTML = 'Could not read KML file - it does not appear to be valid XML';
        return;
      }

      const geojson = toGeoJSON.kml(xmlDoc) as FeatureCollection;
      const polygons = geojson.features.filter(
        (f): f is Feature<Polygon | MultiPolygon> =>
          f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon',
      );

      if (polygons.length === 0) {
        document.getElementById('coordinates')!.innerHTML = 'No polygon found in that KML file';
        return;
      }

      const merged = polygons.reduce<Feature<Polygon | MultiPolygon> | null>(
        (acc, f) => (acc ? (turfUnion(acc, f) as Feature<Polygon | MultiPolygon> | null) ?? acc : f),
        null,
      )!;

      clearParcelSelection();
      draw.deleteAll();

      if (merged.geometry.type === 'Polygon') {
        // Add as an editable draw feature, same as a hand-drawn polygon.
        clearKmlBoundary();
        draw.add({ type: 'Feature', geometry: merged.geometry, properties: {} } as any);
      } else {
        // Disjoint polygons that didn't merge into one ring - MapboxDraw can't hold a
        // MultiPolygon, so display it on its own highlight layer instead.
        kmlBoundaryFeature = merged;
        renderKmlBoundary();
      }

      // Pan/zoom so the uploaded shape fills most of the view without being cut off, then
      // run the full lookup (state/weather/elevation/SA2/rainfall) once the camera settles -
      // querying SA2/cadastre layers before the map has moved to a legible zoom returns nothing.
      const [minLng, minLat, maxLng, maxLat] = turfBbox(merged) as [number, number, number, number];
      await new Promise<void>((resolve) => {
        map.once('moveend', () => resolve());
        map.fitBounds([[minLng, minLat], [maxLng, maxLat]], { padding: 50 });
      });

      if (merged.geometry.type === 'Polygon') {
        const feature = draw.getAll().features[0];
        if (feature) await updateArea({ features: [feature] });
      } else {
        await runAreaLookup('polygon', merged.geometry);
      }
    } catch (error) {
      console.error('Error parsing KML file:', error);
      document.getElementById('coordinates')!.innerHTML = 'Error parsing KML file';
    } finally {
      kmlUploadInput.value = '';
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
    clearKmlBoundary();
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
    parcelKeys?: string[],
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
    const leachingRisk = await getLeachingRisk(centroid.lng, centroid.lat);

    console.log(`${kind} centroid:`, { latitude: centroid.lat, longitude: centroid.lng, state, elevation, weatherDataByYear, sa2Name, sa4Name, cattleReg, leachingRisk });

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

    const leachingInfo = buildLeachingInfoHtml(leachingRisk);

    document.getElementById('coordinates')!.innerHTML =
      `${headerLabel}<br>Area: ${areaInHectares.toFixed(2)} hectares<br>(${areaInSquareMeters.toFixed(2)} m²)<br>Centroid:<br>Latitude: ${centroid.lat.toFixed(6)}<br>Longitude: ${centroid.lng.toFixed(6)}${elevationInfo}<br>State: ${state}${sa4Info}${sa2Info}${cattleRegInfo}${leachingInfo}${weatherInfo}${RainfallSiteInfo}${MaxTempSiteInfo}`;

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
      buildLeachingSummaryLine(leachingRisk),
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
      mapView: getMapView(),
      state,
      sa4Name,
      sa2Name,
      cattleReg,
      leachingRisk,
      parcelIds,
      parcelKeys,
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
        const leachingRisk = await getLeachingRisk(lng, lat);

        console.log('Marker coordinates:', { latitude: lat, longitude: lng, state, elevation, weatherDataByYear, sa2Name, sa4Name, cattleReg, leachingRisk });

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

        const leachingInfo = buildLeachingInfoHtml(leachingRisk);

        document.getElementById('coordinates')!.innerHTML =
          `Marker selected<br>Latitude: ${lat.toFixed(6)}<br>Longitude: ${lng.toFixed(6)}${elevationInfo}<br>State: ${state}${sa4Info}${sa2Info}${cattleRegInfo}${leachingInfo}${weatherInfo}${RainfallSiteInfo}${MaxTempSiteInfo}`;

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
          buildLeachingSummaryLine(leachingRisk),
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
          mapView: getMapView(),
          state,
          sa4Name,
          sa2Name,
          cattleReg,
          leachingRisk,
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

  // Restore a selection a host app saved from a previous fullcam-location-selected event -
  // this map keeps no storage of its own, so hosts pass it back in on the next page load.
  async function applyInitialSelection(saved: SavedLocationSelection) {
    if (saved.kind === 'point' || saved.kind === 'polygon') {
      clearParcelSelection();
      draw.deleteAll();
      const [featureId] = draw.add({ type: 'Feature', geometry: saved.geometry, properties: {} } as any);
      const feature = draw.get(featureId)!;
      if (saved.kind === 'point') {
        addCustomMarker(feature);
      }
      await updateArea({ features: [feature] });
      return;
    }

    // kind === 'parcels'
    draw.deleteAll();
    isSelectingParcels = true;
    selectParcelsToggle.textContent = 'Cancel Parcel Selection';
    map.getCanvas().style.cursor = 'crosshair';

    const restoredParcels = await Promise.all(
      saved.parcelKeys.map(async (key) => {
        const [stateName, objectId] = key.split(':');
        const config = CADASTRE_STATE_CONFIGS.find((c) => c.name === stateName);
        if (!config || !objectId) {
          console.error('Cannot restore parcel with malformed key:', key);
          return null;
        }
        const parcel = await fetchParcelByObjectId(config, objectId);
        if (!parcel) {
          console.error(`Could not restore parcel ${key} - it may no longer exist`);
        }
        return parcel;
      }),
    );

    for (const parcel of restoredParcels) {
      if (!parcel) continue;
      const key = getParcelKey(parcel);
      if (key) {
        selectedParcels.set(key, parcel);
      }
    }

    renderSelectedParcels();
    updateParcelSelectionStatus();
    await finalizeParcelSelection();
  }

  if (initialSelection) {
    map.once('load', () => {
      applyInitialSelection(initialSelection);
    });
  }

  return map;
}

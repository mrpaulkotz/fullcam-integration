import mapboxgl from 'mapbox-gl';
import MapboxDraw from '@mapbox/mapbox-gl-draw';
import { polygon, featureCollection, point } from '@turf/helpers';
// @ts-ignore - Type definitions exist but module resolution fails
import booleanPointInPolygon from '@turf/boolean-point-in-polygon';
import { calculatePolygonArea, calculateCentroid } from './calculations';
import { 
  getAustralianState, 
  getNearestRainfallSite, 
  getNearestMaxTempSite,
  fetchSiloWeatherData,
  classifyClimate
} from './weather';

// Mapbox access token
mapboxgl.accessToken = 'pk.eyJ1IjoicGtvdHp6bmVhZ2NyYyIsImEiOiJjbWlxdDM4bGIwZTB3M2ZweTFveWIxZ3NwIn0.EGn8FxX3RLRQMOM5cN2QTA';

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

export function initializeMap(): mapboxgl.Map {
  const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/streets-v12',
    center: [133.75953414518108, -25.806755647793132],
    zoom: 3
  });

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
  });

  map.addControl(draw);

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

  // Function to get SA4_NAME21 from abs-sa2-layer at a location
  function getSA4Name(lng: number, lat: number): string | null {
    try {
      // Check if layer exists
      if (!map.getLayer('abs-sa2-layer')) {
        console.log('abs-sa2-layer not found');
        return null;
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
            
            if (isInside && feature.properties && feature.properties['SA4_NAME21']) {
              console.log('Found SA4 region:', feature.properties['SA4_NAME21']);
              return feature.properties['SA4_NAME21'];
            }
          } catch (e) {
            // Skip invalid geometries
            continue;
          }
        }
      }
      
      console.log('No SA4 region found - may need to zoom in for data to load');
    } catch (error) {
      console.error('Error querying SA4 name:', error);
    }
    return null;
  }

  async function updateArea(e: any) {
    const data = draw.getAll();
    const selectedFeatures = e.features || [];
    const selectedYear = (document.getElementById('year-select') as HTMLSelectElement).value;

    if (selectedFeatures.length > 0) {
      const feature = selectedFeatures[0];

      // Check if it's a point (marker)
      if (feature.geometry.type === 'Point') {
        const [lng, lat] = feature.geometry.coordinates;
        
        // Show loading message
        document.getElementById('coordinates')!.innerHTML = 'Loading weather and elevation data...';
        
        const state = await getAustralianState(lng, lat);
        const weatherData = await fetchSiloWeatherData(lat, lng, selectedYear);
        const elevation = await getElevation(lng, lat);
        const nearestRainfallSite = getNearestRainfallSite(map, lng, lat);
        const nearestMaxTempSite = getNearestMaxTempSite(map, lng, lat);
        const sa4Name = getSA4Name(lng, lat);

        console.log('Marker coordinates:', { latitude: lat, longitude: lng, state, elevation, weatherData, sa4Name });

        let elevationInfo = '';
        if (elevation !== null) {
          elevationInfo = `<br>Elevation: ${elevation} m`;
        }

        let weatherInfo = '';
        if (weatherData) {
          const climateClass = classifyClimate(weatherData, elevation);
          weatherInfo = `<br><br><strong>SILO Weather Data (${selectedYear}):</strong><br>` +
            `Total annual rainfall: ${weatherData.rainfall} mm<br>` +
            `Average temperature: ${weatherData.avgTemp}°C<br>` +
            `Average maximum temperature: ${weatherData.maxTemp}°C<br>` +
            `Average minimum temperature: ${weatherData.minTemp}°C<br>` +
            `Frost days (min temp < 0°C): ${weatherData.frostDays}<br>` +
            `Total Morton potential ET: ${weatherData.mpot} mm<br>` +
            `Rainfall/ET ratio: ${(weatherData.rainfall / weatherData.mpot).toFixed(2)}<br>` +
            `<strong>Climate classification: ${climateClass}</strong>`;
        } else {
          weatherInfo = `<br><br>Unable to fetch weather data for ${selectedYear}`;
        }

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

        document.getElementById('coordinates')!.innerHTML =
          `Marker selected<br>Latitude: ${lat.toFixed(6)}<br>Longitude: ${lng.toFixed(6)}${elevationInfo}<br>State: ${state}${sa4Info}${weatherInfo}${RainfallSiteInfo}${MaxTempSiteInfo}`;
      }
      // Check if it's a polygon
      else if (feature.geometry.type === 'Polygon') {
        const areaInSquareMeters = calculatePolygonArea(feature.geometry.coordinates);
        const areaInHectares = areaInSquareMeters / 10000;
        const centroid = calculateCentroid(feature.geometry.coordinates);
        
        // Show loading message
        document.getElementById('coordinates')!.innerHTML = 'Calculating polygon data...';
        
        const state = await getAustralianState(centroid.lng, centroid.lat);
        const weatherData = await fetchSiloWeatherData(centroid.lat, centroid.lng, selectedYear);
        const elevation = await getElevation(centroid.lng, centroid.lat);
        const nearestRainfallSite = getNearestRainfallSite(map, centroid.lng, centroid.lat);
        const nearestMaxTempSite = getNearestMaxTempSite(map, centroid.lng, centroid.lat);
        const sa4Name = getSA4Name(centroid.lng, centroid.lat);

        console.log('Polygon centroid:', { latitude: centroid.lat, longitude: centroid.lng, state, elevation, weatherData, sa4Name });

        let elevationInfo = '';
        if (elevation !== null) {
          elevationInfo = `<br>Elevation (centroid): ${elevation} m`;
        }

        let weatherInfo = '';
        if (weatherData) {
          const climateClass = classifyClimate(weatherData, elevation);
          weatherInfo = `<br><br><strong>SILO Weather Data (${selectedYear}):</strong><br>` +
            `Total annual rainfall: ${weatherData.rainfall} mm<br>` +
            `Average temperature: ${weatherData.avgTemp}°C<br>` +
            `Average maximum temperature: ${weatherData.maxTemp}°C<br>` +
            `Average minimum temperature: ${weatherData.minTemp}°C<br>` +
            `Frost days (min temp < 0°C): ${weatherData.frostDays}<br>` +
            `Total Morton potential ET: ${weatherData.mpot} mm<br>` +
            `Rainfall/ET ratio: ${(weatherData.rainfall / weatherData.mpot).toFixed(2)}<br>` +
            `<strong>Climate classification: ${climateClass}</strong>`;
        } else {
          weatherInfo = `<br><br>Unable to fetch weather data for ${selectedYear}`;
        }

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

        document.getElementById('coordinates')!.innerHTML =
          `Polygon selected<br>Area: ${areaInHectares.toFixed(2)} hectares<br>(${areaInSquareMeters.toFixed(2)} m²)<br>Centroid:<br>Latitude: ${centroid.lat.toFixed(6)}<br>Longitude: ${centroid.lng.toFixed(6)}${elevationInfo}<br>State: ${state}${sa4Info}${weatherInfo}${RainfallSiteInfo}${MaxTempSiteInfo}`;
      }
    } else if (data.features.length === 0) {
      document.getElementById('coordinates')!.innerHTML = 'Draw on the map';
    } else {
      document.getElementById('coordinates')!.innerHTML =
        `Features: ${data.features.length}<br>Select a feature to view details`;
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

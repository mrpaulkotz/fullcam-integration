import mapboxgl from 'mapbox-gl';
import type { WeatherSite } from './types';
import { calculateDistance } from './calculations';

/**
 * Interface for SILO weather data response
 */
export interface SiloWeatherData {
  rainfall: number;
  maxTemp: number;
  minTemp: number;
  avgTemp: number; // Average temperature (mean of max and min)
  radiation: number;
  evaporation: number;
  mpot: number; // Morton potential evapotranspiration over land
  frostDays: number; // Number of days where minimum temperature was below 0°C
}

/**
 * Classify climate based on weather data and elevation
 * @param weatherData SILO weather data for a given year
 * @param elevation Elevation in meters (can be null)
 * @returns Climate classification string
 */
export function classifyClimate(weatherData: SiloWeatherData, elevation: number | null): string {
  const { avgTemp, rainfall, frostDays, mpot } = weatherData;
  
  // Calculate rainfall to potential evapotranspiration ratio
  const rainfallToETRatio = mpot > 0 ? rainfall / mpot : 0;

  // Tropical montane
  if (avgTemp >= 18.001 && frostDays < 7 && elevation !== null && elevation > 1000) {
    return 'Tropical montane';
  }
  
  // Tropical wet
  if (avgTemp >= 18.001 && rainfall > 2000 && frostDays < 7) {
    return 'Tropical wet';
  }
  
  // Tropical moist
  if (avgTemp >= 18.001 && rainfall >= 1000 && rainfall <= 2000 && frostDays < 7) {
    return 'Tropical moist';
  }
  
  // Tropical dry
  if (avgTemp >= 18.001 && rainfall < 1000 && frostDays < 7) {
    return 'Tropical dry';
  }
  
  // Warm temperate moist
  if (avgTemp >= 11 && avgTemp <= 18 && frostDays > 7 && rainfallToETRatio > 1) {
    return 'Warm temperate moist';
  }
  
  // Warm temperate dry
  if (avgTemp >= 11 && avgTemp <= 18 && frostDays > 7 && rainfallToETRatio <= 1) {
    return 'Warm temperate dry';
  }
  
  // Cool temperate moist
  if (avgTemp <= 10.999 && frostDays > 7 && rainfallToETRatio > 1) {
    return 'Cool temperate moist';
  }
  
  // Cool temperate dry
  if (avgTemp <= 10.999 && frostDays > 7 && rainfallToETRatio <= 1) {
    return 'Cool temperate dry';
  }

  // Warm temperate moist - low frost
  if (avgTemp >= 11 && avgTemp <= 18 && frostDays <= 7 && rainfallToETRatio > 1) {
    return 'Warm temperate moist - low frost';
  }
  
  // Warm temperate dry - low frost
  if (avgTemp >= 11 && avgTemp <= 18 && frostDays <= 7 && rainfallToETRatio <= 1) {
    return 'Warm temperate dry - low frost';
  }
  
  // Warm temperate moist - high temp
  if (avgTemp >= 18.001 && frostDays > 7 && rainfallToETRatio > 1) {
    return 'Warm temperate moist - high temp';
  }
  if (avgTemp >= 18.001 && frostDays > 7 && rainfallToETRatio <= 1) {
    return 'Warm temperate dry - high temp';
  }

    // Cool temperate moist - low frost
  if (avgTemp <= 10.999 && frostDays <= 7 && rainfallToETRatio > 1) {
    return 'Cool temperate moist - low frost';
  }
  
  // Cool temperate dry - low frost
  if (avgTemp <= 10.999 && frostDays <= 7 && rainfallToETRatio <= 1) {
    return 'Cool temperate dry - low frost';
  }
  
  // Default case if none of the conditions match
  return 'Unclassified';
}

/**
 * Get Australian state using Mapbox Geocoding API
 */
export async function getAustralianState(lng: number, lat: number): Promise<string> {
  try {
    const response = await fetch(
      `https://api.mapbox.com/search/geocode/v6/reverse?longitude=${lng}&latitude=${lat}&access_token=${mapboxgl.accessToken}`
    );
    const data = await response.json();

    if (data.features && data.features.length > 0) {
      const feature = data.features[0];
      // Look for region (state/territory) in the context
      if (feature.properties && feature.properties.context) {
        const region = feature.properties.context.region;
        if (region && region.name) {
          return region.name;
        }
      }
    }
    return 'Unknown';
  } catch (error) {
    console.error('Error fetching geocoding data:', error);
    return 'Error';
  }
}

/**
 * Test function to calculate rainfall from local XML file
 */
export async function testRainfallCalculation(): Promise<void> {
  try {
    const response = await fetch('/src/rainfall-test-lat20.55-lon147.84.xml');
    const text = await response.text();
    
    const lines = text.trim().split('\n');
    let totalRainfall = 0;
    let dataLineCount = 0;
    
    for (const line of lines) {
      // Skip comment lines, headers, and empty lines
      const trimmed = line.trim();
      if (line.startsWith('"') || trimmed.startsWith('Date') || trimmed.startsWith('(') || trimmed === '') continue;
      
      const parts = trimmed.split(/\s+/);
      if (parts.length < 13) continue;
      
      dataLineCount++;
      const rain = parseFloat(parts[7]);
      
      if (dataLineCount <= 5) {
        console.log(`Test Line ${dataLineCount}: rain[7]=${parts[7]} (${rain})`);
      }
      
      if (!isNaN(rain) && rain >= 0 && rain < 9999) {
        totalRainfall += rain;
      }
    }
    
    console.log(`TEST RESULT: ${dataLineCount} lines, Total Rainfall = ${totalRainfall.toFixed(1)}mm (Expected: 621.8mm)`);
  } catch (error) {
    console.error('Test failed:', error);
  }
}

/**
 * Fetch weather data from SILO DataDrill API
 */
export async function fetchSiloWeatherData(
  lat: number,
  lon: number,
  year: string
): Promise<SiloWeatherData | null> {
  try {
    const startDate = `${year}0101`;
    const endDate = `${year}1231`;
    
    const url = `https://www.longpaddock.qld.gov.au/cgi-bin/silo/DataDrillDataset.php?` +
      `start=${startDate}&finish=${endDate}&lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}&` +
      `format=alldata&username=pkotz@zneagcrc.com.au&password=apirequest`;

    const response = await fetch(url);
    
    if (!response.ok) {
      throw new Error(`SILO API request failed: ${response.status}`);
    }

    const text = await response.text();
    
    // Parse SILO data format (text/csv-like format)
    const lines = text.trim().split('\n');
    
    let totalRainfall = 0;
    let maxTempSum = 0;
    let maxTempCount = 0;
    let minTempSum = 0;
    let minTempCount = 0;
    let radiationSum = 0;
    let radiationCount = 0;
    let evaporationSum = 0;
    let evaporationCount = 0;
    let mpotSum = 0;
    let mpotCount = 0;
    let frostDays = 0;
    let dataLineCount = 0;

    // Skip header lines (usually start with comments or parentheses)
    for (const line of lines) {
      const trimmed = line.trim();
      if (line.startsWith('#') || trimmed.startsWith('(') || trimmed === '' || trimmed.startsWith('Date')) continue;
      
      const parts = trimmed.split(/\s+/);
      if (parts.length < 13) continue; // Ensure we have enough columns

      dataLineCount++;
      
      // SILO format columns (alldata):
      // 0=Date, 1=Day, 2=Date2, 3=T.Max, 4=Smx, 5=T.Min, 6=Smn, 7=Rain, 8=Srn, 9=Evap, 10=Sev, 11=Radn, 12=Ssl
      // 13=VP, 14=Svp, 15=RHmaxT, 16=RHminT, 17=FAO56, 18=Mlake, 19=Mpot, 20=Mact, 21=Mwet, 22=Span, 23=Ssp, 24=EvSp, 25=Ses, 26=MSLPres, 27=Sp
      const maxTemp = parseFloat(parts[3]); // T.Max column
      const minTemp = parseFloat(parts[5]); // T.Min column
      const rain = parseFloat(parts[7]); // Rain column
      const evap = parseFloat(parts[9]); // Evap column
      const radiation = parseFloat(parts[11]); // Radn column
      const mpot = parseFloat(parts[19]); // Mpot column (Morton potential evapotranspiration)

      // Log first few lines for debugging
      if (dataLineCount <= 3) {
        console.log(`Line ${dataLineCount}: parts=${parts.length}, rain[7]=${parts[7]} (${rain}), maxTemp[3]=${parts[3]} (${maxTemp})`);
      }

      if (!isNaN(rain) && rain >= 0 && rain < 9999) {
        totalRainfall += rain;
      }
      if (!isNaN(maxTemp) && maxTemp > -999 && maxTemp < 999) {
        maxTempSum += maxTemp;
        maxTempCount++;
      }
      if (!isNaN(minTemp) && minTemp > -999 && minTemp < 999) {
        minTempSum += minTemp;
        minTempCount++;
        // Count frost days (min temp below 0°C)
        if (minTemp < 0) {
          frostDays++;
        }
      }
      if (!isNaN(radiation) && radiation >= 0 && radiation < 999) {
        radiationSum += radiation;
        radiationCount++;
      }
      if (!isNaN(evap) && evap >= 0 && evap < 999) {
        evaporationSum += evap;
        evaporationCount++;
      }
      if (!isNaN(mpot) && mpot >= 0 && mpot < 9999) {
        mpotSum += mpot;
        mpotCount++;
      }
    }

    console.log(`SILO Data Summary: ${dataLineCount} lines processed, total rainfall: ${totalRainfall.toFixed(1)}mm`);

    const avgMaxTemp = maxTempCount > 0 ? maxTempSum / maxTempCount : 0;
    const avgMinTemp = minTempCount > 0 ? minTempSum / minTempCount : 0;
    const avgTemp = (avgMaxTemp + avgMinTemp) / 2;

    return {
      rainfall: parseFloat(totalRainfall.toFixed(1)),
      maxTemp: parseFloat(avgMaxTemp.toFixed(1)),
      minTemp: parseFloat(avgMinTemp.toFixed(1)),
      avgTemp: parseFloat(avgTemp.toFixed(1)),
      radiation: radiationCount > 0 ? parseFloat((radiationSum / radiationCount).toFixed(1)) : 0,
      evaporation: parseFloat(evaporationSum.toFixed(1)),
      mpot: parseFloat(mpotSum.toFixed(1)), // Total annual Morton potential evapotranspiration
      frostDays: frostDays
    };

  } catch (error) {
    console.error('Error fetching SILO weather data:', error);
    return null;
  }
}

/**
 * Find nearest rainfall monitoring site
 */
export function getNearestRainfallSite(map: mapboxgl.Map, lng: number, lat: number): WeatherSite | null {
  const features = map.querySourceFeatures('weather-stations-rainfall', {
    sourceLayer: 'weather_stations_rainfall-0gek19'
  });

  if (features.length === 0) {
    console.log('No rainfall monitoring sites found');
    return null;
  }

  let nearestRainfallSite: WeatherSite | null = null;
  let minDistance = Infinity;

  features.forEach((feature: any) => {
    if (feature.geometry.type === 'Point') {
      const [siteLng, siteLat] = feature.geometry.coordinates;
      const distance = calculateDistance(lng, lat, siteLng, siteLat);

      if (distance < minDistance) {
        minDistance = distance;
        nearestRainfallSite = {
          properties: feature.properties || {},
          coordinates: feature.geometry.coordinates as [number, number],
          distance: distance.toFixed(2)
        };
      }
    }
  });

  return nearestRainfallSite;
}

/**
 * Find nearest max temp monitoring site
 */
export function getNearestMaxTempSite(map: mapboxgl.Map, lng: number, lat: number): WeatherSite | null {
  const features = map.querySourceFeatures('weather-stations-max-temp', {
    sourceLayer: 'weather_stations_max_temp-6sezsw'
  });

  if (features.length === 0) {
    console.log('No max temp monitoring sites found');
    return null;
  }

  let nearestMaxTempSite: WeatherSite | null = null;
  let minDistance = Infinity;

  features.forEach((feature: any) => {
    if (feature.geometry.type === 'Point') {
      const [siteLng, siteLat] = feature.geometry.coordinates;
      const distance = calculateDistance(lng, lat, siteLng, siteLat);

      if (distance < minDistance) {
        minDistance = distance;
        nearestMaxTempSite = {
          properties: feature.properties || {},
          coordinates: feature.geometry.coordinates as [number, number],
          distance: distance.toFixed(2)
        };
      }
    }
  });

  return nearestMaxTempSite;
}

/**
 * Spatial Data Updater
 * Handles updating spatial data for FullCAM plots via API
 */

import { generateEnviroPlantingTemplate, type SiteCoordinates } from './fullcam-templates/template-enviro-plantings';

// Use environment variable or default to localhost for development
const API_BASE_URL = import.meta.env.VITE_API_PROXY_URL || 'http://localhost:3001';
const IS_PRODUCTION = !window.location.hostname.includes('localhost');

interface SpatialUpdateRequest {
  plotContent: string;
  filename?: string;
  subscriptionKey: string;
}

interface SpatialUpdateResponse {
  success: boolean;
  data?: any;
  error?: string;
}

interface SimulationResponse {
  success: boolean;
  data?: any;
  error?: string;
}

/**
 * Generates a .plo file for simulation using spatial update results
 */
function generateSimulationPlotContent(spatialData: any, originalCoords: SiteCoordinates, dates: any, details: any): string {
  // Merge spatial data with original template structure
  const coords: SiteCoordinates = {
    siteLatitude: originalCoords.siteLatitude,
    siteLongitude: originalCoords.siteLongitude
  };
  
  // Generate base template and merge with spatial data
  const baseTemplate = generateEnviroPlantingTemplate(coords, dates, details);
  
  // If spatial data contains updated values, they would be merged here
  // For now, return the base template (can be enhanced based on actual spatial data structure)
  return baseTemplate;
}

/**
 * Submits plot file to FullCAM simulator API
 */
async function runPlotSimulation(
  plotContent: string,
  subscriptionKey: string
): Promise<SimulationResponse> {
  try {
    if (IS_PRODUCTION) {
      throw new Error('API proxy not available in production. This feature requires a local development server.');
    }
    
    console.log('=== Running Plot Simulation ===');
    console.log('Plot content length:', plotContent.length);
    console.log('Subscription key length:', subscriptionKey.length);

    const response = await fetch(`${API_BASE_URL}/api/run-simulation`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plotContent,
        filename: 'plantingPlotfileForSimulation.plo',
        subscriptionKey: subscriptionKey,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Simulation proxy error:', errorText);
      throw new Error(`Simulation failed: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    // Unescape response data
    if (result.data && typeof result.data === 'string') {
      result.data = unescapeJsonString(result.data);
    } else if (result.data && typeof result.data === 'object') {
      result.data = unescapeJsonObject(result.data);
    }

    console.log('Plot simulation completed successfully');
    return result;
  } catch (error) {
    console.error('Plot simulation error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Updates spatial data for a site location via FullCAM API
 * @param latitude Site latitude
 * @param longitude Site longitude
 * @param simulationStartYear Simulation start year (default: 2000)
 * @param simulationEndYear Simulation end year (default: 2075)
 * @param plantingDate Date of environmental planting (YYYYMMDD)
 * @param plantingName Name of the environmental planting
 * @param subscriptionKey API subscription key (default: c7ce17dce569418b8d3bf7f5a3cd14d3)
 * @param runSimulation Whether to run the plot simulation after spatial update (default: false)
 * @returns API response (spatial update or simulation result)
 */
export async function updateSpatialData(
  latitude: number,
  longitude: number,
  simulationStartYear: number = 2000,
  simulationEndYear: number = 2075,
  plantingDate: number,
  plantingName: string,
  subscriptionKey: string = 'c7ce17dce569418b8d3bf7f5a3cd14d3',
  runSimulation: boolean = false
): Promise<SpatialUpdateResponse | SimulationResponse> {
  try {
    // 1. Create coordinates and generate template
    const coords: SiteCoordinates = {
      siteLatitude: latitude,
      siteLongitude: longitude
    };
    const dates = {
      simulationStartYear: simulationStartYear,
      simulationEndYear: simulationEndYear
    };
    
    const details = {
      plantingDate: plantingDate,
      plantingName: plantingName
    };

    const plotContent = generateEnviroPlantingTemplate(coords, dates, details);
    
    console.log('Generated .plo file for spatial update');
    console.log('Coordinates:', coords);
    console.log('Simulation period:', `${simulationStartYear} - ${simulationEndYear}`);
    
    // 2. Send to proxy server (which will create the .plo file and post to API)
    const response = await fetch('http://localhost:3001/api/update-spatial', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        plotContent,
        filename: 'siteForSpatialUpdate.plo',
        subscriptionKey: subscriptionKey,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      console.error('Proxy error:', errorText);
      throw new Error(`Proxy failed: ${response.status} - ${errorText}`);
    }
    
    const result = await response.json();
    
    // 5. Unescape characters in response
    if (result.data && typeof result.data === 'string') {
      result.data = unescapeJsonString(result.data);
    } else if (result.data && typeof result.data === 'object') {
      result.data = unescapeJsonObject(result.data);
    }
    
    console.log('Spatial data updated successfully');

    // 6. If runSimulation flag is true, generate simulation plot and run it
    if (runSimulation && result.success) {
      console.log('Proceeding to run plot simulation...');
      
      const simulationPlotContent = generateSimulationPlotContent(
        result.data,
        coords,
        dates,
        details
      );
      
      return await runPlotSimulation(simulationPlotContent, subscriptionKey);
    }
    
    return result;
  } catch (error) {
    console.error('Spatial data update error:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error occurred',
    };
  }
}

/**
 * Unescapes JSON string (converts \" to ", \n to newlines, etc.)
 */
function unescapeJsonString(str: string): string {
  return str
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * Recursively unescapes JSON object
 */
function unescapeJsonObject(obj: any): any {
  if (typeof obj === 'string') {
    return unescapeJsonString(obj);
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => unescapeJsonObject(item));
  }
  
  if (obj !== null && typeof obj === 'object') {
    const result: any = {};
    for (const key in obj) {
      if (obj.hasOwnProperty(key)) {
        result[key] = unescapeJsonObject(obj[key]);
      }
    }
    return result;
  }
  
  return obj;
}

export class SpatialDataUpdater {
  private apiBaseUrl: string;
  private subscriptionKey: string;

  constructor(apiBaseUrl: string = API_BASE_URL, subscriptionKey: string = '') {
    this.apiBaseUrl = apiBaseUrl;
    this.subscriptionKey = subscriptionKey;
  }

  /**
   * Set the subscription key for API authentication
   */
  setSubscriptionKey(key: string): void {
    this.subscriptionKey = key.trim();
    console.log('Subscription key set, length:', this.subscriptionKey.length);
  }

  /**
   * Generate plot content XML for spatial data update
   */
  private generatePlotContent(coordinates: [number, number][], metadata?: any): string {
    const [lng, lat] = coordinates[0] || [0, 0];
    
    return `<?xml version="1.0" encoding="UTF-8"?>
<Plot>
  <PlotID>SpatialUpdate_${Date.now()}</PlotID>
  <Location>
    <Longitude>${lng}</Longitude>
    <Latitude>${lat}</Latitude>
  </Location>
  <SpatialData>
    <UpdateRequest>true</UpdateRequest>
    <Coordinates>
      ${coordinates.map(([lng, lat]) => 
        `<Point><Longitude>${lng}</Longitude><Latitude>${lat}</Latitude></Point>`
      ).join('\n      ')}
    </Coordinates>
    ${metadata ? `<Metadata>${JSON.stringify(metadata)}</Metadata>` : ''}
  </SpatialData>
  <Timestamp>${new Date().toISOString()}</Timestamp>
</Plot>`;
  }

  /**
   * Update spatial data for a single point
   */
  async updatePointSpatialData(
    lng: number, 
    lat: number, 
    metadata?: any
  ): Promise<SpatialUpdateResponse> {
    if (!this.subscriptionKey) {
      console.error('No subscription key set');
      return {
        success: false,
        error: 'Subscription key is required. Please set it first.'
      };
    }

    try {
      const plotContent = this.generatePlotContent([[lng, lat]], metadata);
      
      console.log('Updating spatial data for point:', { lng, lat });
      console.log('Using subscription key length:', this.subscriptionKey.length);
      
      return await this.submitSpatialUpdate(plotContent, 'point_spatial_update.plo');
    } catch (error) {
      console.error('Error updating point spatial data:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update spatial data for a polygon
   */
  async updatePolygonSpatialData(
    coordinates: [number, number][], 
    metadata?: any
  ): Promise<SpatialUpdateResponse> {
    if (!this.subscriptionKey) {
      console.error('No subscription key set');
      return {
        success: false,
        error: 'Subscription key is required. Please set it first.'
      };
    }

    try {
      const plotContent = this.generatePlotContent(coordinates, metadata);
      
      console.log('Updating spatial data for polygon with', coordinates.length, 'points');
      console.log('Using subscription key length:', this.subscriptionKey.length);
      
      return await this.submitSpatialUpdate(plotContent, 'polygon_spatial_update.plo');
    } catch (error) {
      console.error('Error updating polygon spatial data:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Submit spatial update request to API proxy
   */
  private async submitSpatialUpdate(
    plotContent: string, 
    filename: string
  ): Promise<SpatialUpdateResponse> {
    // CRITICAL: Ensure subscription key is included in the request body
    const request: SpatialUpdateRequest = {
      plotContent,
      filename,
      subscriptionKey: this.subscriptionKey
    };

    console.log('=== Submitting Spatial Update ===');
    console.log('API URL:', `${this.apiBaseUrl}/api/update-spatial`);
    console.log('Filename:', filename);
    console.log('Subscription key included:', !!this.subscriptionKey);
    console.log('Subscription key length:', this.subscriptionKey?.length || 0);
    console.log('Plot content length:', plotContent.length);

    try {
      const response = await fetch(`${this.apiBaseUrl}/api/update-spatial`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request)
      });

      console.log('Proxy response status:', response.status);

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Proxy error response:', errorText);
        throw new Error(`Proxy request failed: ${response.status} - ${errorText}`);
      }

      const result = await response.json();
      
      console.log('=== Spatial Update Response ===');
      console.log('Success:', result.success);
      console.log('Data:', result.data);

      return result;
    } catch (error) {
      console.error('=== Spatial Update Error ===');
      console.error(error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Network error'
      };
    }
  }

  /**
   * Check if the API proxy is available
   */
  async checkApiHealth(): Promise<boolean> {
    try {
      console.log('Checking API health at:', `${this.apiBaseUrl}/health`);
      const response = await fetch(`${this.apiBaseUrl}/health`);
      const isHealthy = response.ok;
      console.log('API health check result:', isHealthy);
      return isHealthy;
    } catch (error) {
      console.error('API health check failed:', error);
      return false;
    }
  }

  /**
   * Batch update multiple spatial points
   */
  async batchUpdateSpatialData(
    points: Array<{ lng: number; lat: number; metadata?: any }>
  ): Promise<SpatialUpdateResponse[]> {
    if (!this.subscriptionKey) {
      console.error('No subscription key set for batch update');
      return [{
        success: false,
        error: 'Subscription key is required. Please set it first.'
      }];
    }

    const results: SpatialUpdateResponse[] = [];
    
    console.log(`Starting batch update for ${points.length} points`);
    
    for (let i = 0; i < points.length; i++) {
      const point = points[i];
      console.log(`Processing point ${i + 1}/${points.length}`);
      
      const result = await this.updatePointSpatialData(
        point.lng, 
        point.lat, 
        point.metadata
      );
      results.push(result);
      
      // Add small delay between requests to avoid rate limiting
      if (i < points.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    
    console.log(`Batch update complete. Successful: ${results.filter(r => r.success).length}/${results.length}`);
    
    return results;
  }

  /**
   * Run plot simulation with generated plot file
   */
  async runSimulation(
    coordinates: [number, number],
    simulationStartYear: number = 2000,
    simulationEndYear: number = 2075,
    plantingDate: number,
    plantingName: string,
    spatialData?: any
  ): Promise<SimulationResponse> {
    if (!this.subscriptionKey) {
      console.error('No subscription key set');
      return {
        success: false,
        error: 'Subscription key is required. Please set it first.'
      };
    }

    try {
      const [lng, lat] = coordinates;
      const coords: SiteCoordinates = {
        siteLatitude: lat,
        siteLongitude: lng
      };

      const dates = {
        simulationStartYear,
        simulationEndYear
      };

      const details = {
        plantingDate,
        plantingName
      };

      // Generate plot content for simulation
      const plotContent = generateSimulationPlotContent(spatialData, coords, dates, details);

      console.log('Running plot simulation for coordinates:', coordinates);
      console.log('Simulation period:', `${simulationStartYear} - ${simulationEndYear}`);

      return await runPlotSimulation(plotContent, this.subscriptionKey);
    } catch (error) {
      console.error('Error running simulation:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update spatial data and optionally run simulation
   */
  async updateAndSimulate(
    lng: number,
    lat: number,
    simulationStartYear: number = 2000,
    simulationEndYear: number = 2075,
    plantingDate: number,
    plantingName: string
  ): Promise<{ spatialUpdate: SpatialUpdateResponse; simulation?: SimulationResponse }> {
    if (!this.subscriptionKey) {
      return {
        spatialUpdate: {
          success: false,
          error: 'Subscription key is required. Please set it first.'
        }
      };
    }

    // First update spatial data
    const spatialUpdate = await this.updatePointSpatialData(lng, lat);

    if (!spatialUpdate.success) {
      return { spatialUpdate };
    }

    // Then run simulation with the results
    const simulation = await this.runSimulation(
      [lng, lat],
      simulationStartYear,
      simulationEndYear,
      plantingDate,
      plantingName,
      spatialUpdate.data
    );

    return { spatialUpdate, simulation };
  }
}

/**
 * Parses CSV simulation response and calculates carbon sequestration
 * @param simulationResponse The raw simulation response containing CSV data
 * @param startDate Decimal year start date (e.g., 2024.0 for Jan 2024)
 * @param endDate Decimal year end date (e.g., 2024.917 for Dec 2024)
 * @returns Difference in carbon mass of trees (tC/ha) between start and end dates
 */
export function calculateCarbonSequestration(
  simulationResponse: SimulationResponse,
  startDate: number,
  endDate: number
): { success: boolean; totalCarbon?: number; error?: string; dataPoints?: number; startCarbon?: number; endCarbon?: number } {
  try {
    if (!simulationResponse.success || !simulationResponse.data) {
      return {
        success: false,
        error: 'Invalid simulation response or no data available'
      };
    }

    const csvData = typeof simulationResponse.data === 'string' 
      ? simulationResponse.data 
      : JSON.stringify(simulationResponse.data);

    // Parse CSV data
    const lines = csvData.split('\n').filter(line => line.trim());
    
    if (lines.length < 2) {
      return {
        success: false,
        error: 'No data rows found in simulation response'
      };
    }

    // Get header row and find column indices
    const headers = lines[0].split(',').map(h => h.trim());
    const decYearIndex = headers.findIndex(h => h.includes('Dec. Year'));
    const carbonIndex = headers.findIndex(h => h.includes('C mass of trees') && h.includes('tC/ha'));

    if (decYearIndex === -1) {
      return {
        success: false,
        error: 'Could not find "Dec. Year" column in CSV data'
      };
    }

    if (carbonIndex === -1) {
      return {
        success: false,
        error: 'Could not find "C mass of trees (tC/ha)" column in CSV data'
      };
    }

    console.log('Column indices - Dec. Year:', decYearIndex, 'Carbon:', carbonIndex);

    // Find carbon values at start and end dates (or closest available)
    let startCarbon: number | null = null;
    let endCarbon: number | null = null;
    let closestStartDiff = Infinity;
    let closestEndDiff = Infinity;

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim());
      
      const decYear = parseFloat(values[decYearIndex]);
      const carbonValue = parseFloat(values[carbonIndex]);

      if (isNaN(decYear) || isNaN(carbonValue)) {
        continue;
      }

      // Find closest value to start date
      const startDiff = Math.abs(decYear - startDate);
      if (startDiff < closestStartDiff) {
        closestStartDiff = startDiff;
        startCarbon = carbonValue;
      }

      // Find closest value to end date
      const endDiff = Math.abs(decYear - endDate);
      if (endDiff < closestEndDiff) {
        closestEndDiff = endDiff;
        endCarbon = carbonValue;
      }
    }

    if (startCarbon === null || endCarbon === null) {
      return {
        success: false,
        error: 'Could not find carbon values for the specified date range'
      };
    }

    // Calculate the difference (sequestration = end - start)
    const totalCarbon = endCarbon - startCarbon;

    console.log(`Carbon sequestration calculation complete:`);
    console.log(`  Date range: ${startDate} - ${endDate}`);
    console.log(`  Start carbon: ${startCarbon.toFixed(10)} tC/ha`);
    console.log(`  End carbon: ${endCarbon.toFixed(10)} tC/ha`);
    console.log(`  Carbon sequestered: ${totalCarbon.toFixed(10)} tC/ha`);

    return {
      success: true,
      totalCarbon: parseFloat(totalCarbon.toFixed(10)),
      startCarbon: parseFloat(startCarbon.toFixed(10)),
      endCarbon: parseFloat(endCarbon.toFixed(10)),
      dataPoints: 2 // Start and end points
    };

  } catch (error) {
    console.error('Error calculating carbon sequestration:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Converts a date to decimal year format
 * @param year Full year (e.g., 2024)
 * @param month Month (1-12)
 * @returns Decimal year value (e.g., 2024.083 for Feb 2024)
 */
export function dateToDecimalYear(year: number, month: number): number {
  if (month < 1 || month > 12) {
    throw new Error('Month must be between 1 and 12');
  }
  
  // Calculate approximate decimal value (month-1)/12
  const decimalPart = (month - 1) / 12;
  return parseFloat((year + decimalPart).toFixed(3));
}

/**
 * Calculates average annual carbon sequestration rate
 * @param simulationResponse The raw simulation response containing CSV data
 * @param startYear Start year
 * @param startMonth Start month (1-12)
 * @param endYear End year
 * @param endMonth End month (1-12)
 * @returns Average carbon sequestration per year and total
 */
export function calculateAverageAnnualSequestration(
  simulationResponse: SimulationResponse,
  startYear: number,
  startMonth: number,
  endYear: number,
  endMonth: number
): { 
  success: boolean; 
  totalCarbon?: number; 
  averagePerYear?: number;
  years?: number;
  error?: string 
} {
  try {
    const startDate = dateToDecimalYear(startYear, startMonth);
    const endDate = dateToDecimalYear(endYear, endMonth);
    
    const result = calculateCarbonSequestration(simulationResponse, startDate, endDate);
    
    if (!result.success || result.totalCarbon === undefined) {
      return { success: false, error: result.error };
    }

    const years = endDate - startDate;
    const averagePerYear = years > 0 ? result.totalCarbon / years : 0;

    return {
      success: true,
      totalCarbon: result.totalCarbon,
      averagePerYear: parseFloat(averagePerYear.toFixed(10)),
      years: parseFloat(years.toFixed(2))
    };

  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    };
  }
}

/**
 * Calculates total carbon sequestration for a given area
 * @param carbonPerHectare Carbon sequestration per hectare (tC/ha)
 * @param areaInHectares Area in hectares
 * @returns Total carbon sequestration (tC)
 */
export function calculateTotalCarbonForArea(
  carbonPerHectare: number,
  areaInHectares: number
): number {
  return parseFloat((carbonPerHectare * areaInHectares).toFixed(10));
}

/**
 * Calculates comprehensive carbon metrics for a given area
 * @param carbonResult Result from calculateCarbonSequestration
 * @param areaInHectares Area in hectares
 * @param years Number of years in the analysis period
 * @returns Object containing all carbon metrics for the area
 */
export function calculateAreaCarbonMetrics(
  carbonResult: { totalCarbon: number; startCarbon?: number; endCarbon?: number },
  areaInHectares: number,
  years: number
): {
  totalCarbonPerHectare: number;
  totalCarbonForArea: number;
  averagePerYearPerHectare: number;
  averagePerYearForArea: number;
} {
  const averagePerYearPerHectare = carbonResult.totalCarbon / years;
  
  return {
    totalCarbonPerHectare: parseFloat(carbonResult.totalCarbon.toFixed(10)),
    totalCarbonForArea: calculateTotalCarbonForArea(carbonResult.totalCarbon, areaInHectares),
    averagePerYearPerHectare: parseFloat(averagePerYearPerHectare.toFixed(10)),
    averagePerYearForArea: calculateTotalCarbonForArea(averagePerYearPerHectare, areaInHectares)
  };
}
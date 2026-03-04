/**
 * AWS Lambda handler for FullCAM API proxy
 * Handles CORS and proxies requests to the FullCAM API
 */

import FormDataNode = require('form-data');

// AWS Lambda runtime provides these globally
declare const Buffer: any;
declare const fetch: any;
declare const console: any;

interface ProxyEvent {
  httpMethod: string;
  path: string;
  body: string;
  headers: Record<string, string>;
}

interface ProxyResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

const SIMULATION_API_URL = 'https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1/2024/fullcam-simulator/run-plotsimulation';
const SPATIAL_UPDATE_API_URL = 'https://api.climatechange.gov.au/climate/carbon-accounting/2024/data/v1/2024/data-builder/update-spatialdata';

function resolveProxyTarget(path: string): { apiUrl: string; defaultFilename: string; routeName: 'run-simulation' | 'update-spatial' } {
  if (path.includes('/api/update-spatial')) {
    return {
      apiUrl: SPATIAL_UPDATE_API_URL,
      defaultFilename: 'siteForSpatialUpdate.plo',
      routeName: 'update-spatial',
    };
  }

  return {
    apiUrl: SIMULATION_API_URL,
    defaultFilename: 'plantingPlotfileForSimulation.plo',
    routeName: 'run-simulation',
  };
}

export const handler = async (event: ProxyEvent): Promise<ProxyResponse> => {
  // Handle CORS preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: CORS_HEADERS,
      body: '',
    };
  }

  try {
    const target = resolveProxyTarget(event.path || '');
    console.log('Lambda proxy route:', target.routeName, 'Path:', event.path);

    const body = JSON.parse(event.body);
    const { plotContent, filename, subscriptionKey } = body;

    if (!plotContent) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Plot content is required',
        }),
      };
    }

    if (!subscriptionKey) {
      return {
        statusCode: 400,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: 'Subscription key is required',
        }),
      };
    }

    const formData = new FormDataNode();
    const buffer = Buffer.from(plotContent, 'utf-8');
    formData.append('file', buffer, {
      filename: filename || target.defaultFilename,
      contentType: 'application/xml',
    });

    // Get FormData as buffer
    const formBuffer = formData.getBuffer();

    const response = await fetch(target.apiUrl, {
      method: 'POST',
      headers: {
        ...formData.getHeaders(),
        'Ocp-Apim-Subscription-Key': subscriptionKey,
        'Content-Length': formBuffer.length.toString(),
      },
      body: formBuffer,
    });

    const contentType = response.headers.get('content-type');

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `API request failed: ${response.status} - ${errorText}`,
          route: target.routeName,
        }),
      };
    }

    if (
      contentType?.includes('application/xml') ||
      contentType?.includes('text/xml') ||
      contentType?.includes('text/plain') ||
      contentType?.includes('text/csv')
    ) {
      const textData = await response.text();
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          data: textData,
          dataType: contentType?.includes('text/csv') ? 'csv' : 'text',
          contentType,
          route: target.routeName,
        }),
      };
    } else {
      const data = await response.json();
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          data,
          dataType: 'json',
          contentType,
          route: target.routeName,
        }),
      };
    }
  } catch (error) {
    console.error('Lambda error:', error);
    return {
      statusCode: 500,
      headers: CORS_HEADERS,
      body: JSON.stringify({
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }),
    };
  }
};

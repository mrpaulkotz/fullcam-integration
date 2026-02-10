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
      filename: filename || 'plot.plo',
      contentType: 'application/xml',
    });

    const response = await fetch(
      'https://api.climatechange.gov.au/climate/carbon-accounting/2024/plot/v1/2024/fullcam-simulator/run-plotsimulation',
      {
        method: 'POST',
        headers: {
          ...formData.getHeaders(),
          'Ocp-Apim-Subscription-Key': subscriptionKey,
        },
        body: formData as any,
      }
    );

    const contentType = response.headers.get('content-type');

    if (!response.ok) {
      const errorText = await response.text();
      return {
        statusCode: response.status,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: false,
          error: `API request failed: ${response.status} - ${errorText}`,
        }),
      };
    }

    if (contentType?.includes('text/csv') || contentType?.includes('text/plain')) {
      const csvData = await response.text();
      return {
        statusCode: 200,
        headers: CORS_HEADERS,
        body: JSON.stringify({
          success: true,
          data: csvData,
          dataType: 'csv',
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
